#!/usr/bin/env bash
# End-to-end smoke check of the v2 game against a running stack (docs/backend-contract.md). Start the
# stack first (or let `npm run smoke` do it all, scripts/smoke-stack.sh):
#
#   V2_TICK_MS=200 docker compose up -d --build     # V2_BRAIN=greedy, AUTH_MODE=dev by default
#   scripts/smoke.sh
#
# Checks: the web app (GET / serves the S01 sign-in screen and its bundle names API_URL; with
# WEB_BROWSER=1 also a headless Chromium sign-in that lands on Home with 60 free credits and the
# Practice tile), /health, dev sign-in, the new-account defaults on /me (Rook/Wren/Moss, Elo 1200,
# 60 free credits), the judge path over WebSocket (scripts/ws-v2.cjs: practice
# against the greedy bot on DEFAULT_PRACTICE, accept, lock in, v2_end with a log hash), the stored
# match (GET /v2/matches/:id ended, practice, same log hash), its messages, and /credits unchanged
# (practice is free on the greedy brain). Unless SKIP_PVP=1: two clients play a ranked match, Elo
# moves ±16 (0 on a draw) and both players stand in /seasons/current.
#
# Needs bash, curl, node >= 20 and the repo's node_modules (`npm ci`) for `ws`.
#
# Env: API_URL (http://localhost:4000), WS_URL (ws://localhost:4001/ws), WEB_URL (http://localhost:3000),
#      PRACTICE_TIMEOUT (300 s), PVP_TIMEOUT (600 s: accept + lock-in + 150 ticks of 2 s + slack),
#      SKIP_PVP=1 to stop after the practice checks, SKIP_WEB=1 to skip the web checks (backend only),
#      WEB_BROWSER=1 for the headless browser check (needs the repo's `playwright` package and an
#      installed Chromium; PW_CHROMIUM=/path/to/chrome picks the binary).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_URL="${API_URL:-http://localhost:4000}"
API_URL="${API_URL%/}"
WS_URL="${WS_URL:-ws://localhost:4001/ws}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
WEB_URL="${WEB_URL%/}"
PRACTICE_TIMEOUT="${PRACTICE_TIMEOUT:-300}"
PVP_TIMEOUT="${PVP_TIMEOUT:-600}"
WS_V2="$ROOT/scripts/ws-v2.cjs"
export WS_URL WEB_URL
export WS_MODULE="$ROOT/node_modules/ws"

# DEFAULT_PRACTICE and BOT_HANDLE in @skirm/engine/v2 (packages/engine/src/v2/practice.ts).
PRACTICE_MAP=copper-hollow
PRACTICE_DIFFICULTY=easy
BOT_HANDLE='Greedy bot'

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

PASSED=0
FAILED=0
pass() { PASSED=$((PASSED + 1)); printf 'PASS  %s\n' "$1"; }
fail() {
  FAILED=$((FAILED + 1))
  printf 'FAIL  %s\n' "$1"
  if [[ $# -gt 1 && -n "$2" ]]; then printf '      %s\n' "$2"; fi
}
summary() {
  echo
  echo "smoke: $PASSED passed, $FAILED failed"
  if [[ $FAILED -gt 0 ]]; then exit 1; fi
  exit 0
}
# A failed check that later checks depend on.
fatal() { fail "$@"; echo "      (stopping: later checks depend on this)"; summary; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "smoke: '$1' is required" >&2; exit 2; }; }
need curl
need node
[[ -d "$WS_MODULE" ]] || { echo "smoke: $WS_MODULE is missing; run npm ci at the repo root" >&2; exit 2; }

# --- helpers -----------------------------------------------------------------------------------

# req METHOD PATH [JSON_BODY] [DEV_USER] -> body in $TMP/body, status in $STATUS
STATUS=0
req() {
  local method="$1" path="$2" body="${3:-}" user="${4:-}"
  local args=(-sS -o "$TMP/body" -w '%{http_code}' -X "$method" --max-time 30
    -H 'accept: application/json')
  [[ -n "$user" ]] && args+=(-H "x-dev-user: $user")
  [[ -n "$body" ]] && args+=(-H 'content-type: application/json' --data-binary "$body")
  if ! STATUS="$(curl "${args[@]}" "$API_URL$path")"; then STATUS=0; fi
  return 0
}

# js FILE 'expression over o' -> prints the value (strings raw, everything else as JSON); prints
# nothing (and never fails) when the file is not JSON or the expression throws.
# The expression may also be a block that returns a value, e.g. '(() => {...})()'.
js() {
  node -e '
    const fs = require("fs");
    let o;
    try { o = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { o = undefined; }
    let v;
    try { v = (0, eval)("(o) => (" + process.argv[2] + ")")(o); }
    catch (e) { process.stderr.write("smoke: js: " + e.message + "\n"); v = undefined; }
    if (v === undefined || v === null) process.stdout.write("");
    else process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
  ' "$1" "$2"
}

# checks FILE 'expression returning string[] of problems' NAME -> PASS when the list is empty
checks() {
  local file="$1" expr="$2" name="$3" out
  out="$(js "$file" "$expr" 2>&1)"
  if [[ "$out" == "[]" ]]; then pass "$name"; return 0; fi
  fail "$name" "${out:-unexpected response: $(head -c 300 "$file" 2>/dev/null | tr '\n' ' ')}"
  return 1
}

body_snippet() { head -c 400 "$TMP/body" 2>/dev/null | tr '\n' ' '; }
rand() { node -e 'process.stdout.write(require("crypto").randomBytes(4).toString("hex"))'; }

# signin USER: POST /auth/session, then saves /agents to $TMP/agents-USER.json
signin() {
  req POST /auth/session '{}' "$1"
  [[ "$STATUS" =~ ^20[01]$ && -n "$(js "$TMP/body" 'o && o.account && o.account.id')" ]] || return 1
  req GET /agents '' "$1"
  [[ "$STATUS" == 200 ]] || return 1
  cp "$TMP/body" "$TMP/agents-$1.json"
}

# crew_of USER NAME -> [{agentId, tier}] with that starter agent at its own talk tier
crew_of() {
  js "$TMP/agents-$1.json" "(() => {
    const a = (Array.isArray(o) ? o : []).find((x) => x.name === '$2');
    return a ? [{ agentId: a.id, tier: a.tier || 'standard' }] : undefined;
  })()"
}

# --- 0. web app --------------------------------------------------------------------------------

cat >"$TMP/web-browser.cjs" <<'EOF'
// Headless Chromium: S01 dev sign-in, then Home (S02) with 60 free credits and the Practice tile.
// argv: outFile
const fs = require('fs');
const { chromium } = require(process.env.PW_MODULE);
const [outFile] = process.argv.slice(2);
const out = { steps: [], error: null };
(async () => {
  let browser;
  try {
    const exe = process.env.PW_CHROMIUM;
    browser = await chromium.launch(exe ? { executablePath: exe } : {});
    const page = await browser.newPage();
    const handle = 'smoke-web-' + Math.random().toString(36).slice(2, 8);
    await page.goto(process.env.WEB_URL + '/');
    await page.getByTestId('screen-s01').waitFor();
    out.steps.push('S01 sign-in screen');
    // A fill before hydration is lost (the button stays disabled), so fill until it takes.
    const deadline = Date.now() + 30000;
    for (;;) {
      await page.getByLabel('Handle').fill(handle);
      if (await page.getByTestId('s01-signin').isEnabled()) break;
      if (Date.now() > deadline) throw new Error('sign-in button never enabled');
      await page.waitForTimeout(250);
    }
    await page.getByTestId('s01-signin').click();
    await page.waitForURL(/\/play$/, { timeout: 15000 });
    await page.getByTestId('screen-s02').waitFor({ timeout: 15000 });
    const dock = page.getByTestId('account-dock');
    await dock.getByTestId('account-badge').filter({ hasText: handle }).click({ timeout: 15000 });
    await dock.getByTestId('topbar-account').filter({ hasText: handle }).waitFor({ timeout: 15000 });
    out.steps.push(`Home as ${handle}`);
    await dock.getByTestId('topbar-allowance').filter({ hasText: '60 free' }).waitFor({ timeout: 15000 });
    out.steps.push('60 free credits');
    const tile = page.getByTestId('s02-tile-practice');
    await tile.filter({ hasText: 'Vs Greedy bot' }).waitFor({ timeout: 15000 });
    const href = await tile.getAttribute('href');
    if (!/\/maps\/copper-hollow\/crew\?d=easy&opponent=bot$/.test(href || ''))
      throw new Error(`Practice tile links to ${href}, want /maps/copper-hollow/crew?d=easy&opponent=bot`);
    out.steps.push('Practice tile vs Greedy bot');
  } catch (e) {
    out.error = String((e && e.message) || e).split('\n')[0];
  } finally {
    if (browser) await browser.close();
    fs.writeFileSync(outFile, JSON.stringify(out));
  }
})();
EOF

if [[ "${SKIP_WEB:-}" == 1 ]]; then
  echo "SKIP  web app (SKIP_WEB=1)"
else
  echo "smoke: web $WEB_URL"
  WEB_STATUS="$(curl -sS -o "$TMP/web.html" -w '%{http_code}' --max-time 30 "$WEB_URL/" 2>/dev/null)" || WEB_STATUS=0
  if [[ "$WEB_STATUS" == 200 ]] && grep -q 'data-testid="screen-s01"' "$TMP/web.html" \
    && grep -q 'data-testid="s01-signin"' "$TMP/web.html"; then
    pass "GET $WEB_URL/ -> 200 with the S01 sign-in screen (screen-s01, s01-signin)"
  else
    fail "GET $WEB_URL/ -> 200 with the S01 sign-in screen" "status $WEB_STATUS: $(head -c 300 "$TMP/web.html" 2>/dev/null | tr '\n' ' ')"
  fi
  # NEXT_PUBLIC_API_URL is inlined at build time, so one of the page's scripts must name API_URL.
  WEB_API_HIT=""
  for src in $(grep -oE '/_next/static/[^"]+\.js' "$TMP/web.html" 2>/dev/null | sort -u); do
    if curl -sS --max-time 15 "$WEB_URL$src" 2>/dev/null | grep -qF "$API_URL"; then WEB_API_HIT="$src"; break; fi
  done
  if [[ -n "$WEB_API_HIT" ]]; then
    pass "web bundle talks to $API_URL ($WEB_API_HIT)"
  else
    fail "web bundle talks to $API_URL" "no script on / names it; rebuild web with NEXT_PUBLIC_API_URL=$API_URL (compose: PUBLIC_API_URL)"
  fi
  if [[ "${WEB_BROWSER:-}" == 1 ]]; then
    export PW_MODULE="$ROOT/node_modules/playwright"
    node "$TMP/web-browser.cjs" "$TMP/web-browser.json" || true
    checks "$TMP/web-browser.json" '(() => o.error ? [`${o.error} (after: ${o.steps.join(", ") || "nothing"})`] : [])()' \
      "browser sign-in: $(js "$TMP/web-browser.json" 'o.steps.join(" -> ")')" || true
  else
    echo "SKIP  headless browser sign-in (set WEB_BROWSER=1)"
  fi
fi

# --- 1. health ---------------------------------------------------------------------------------

echo "smoke: api $API_URL, ws $WS_URL"
req GET /health
if [[ "$STATUS" == 200 && "$(js "$TMP/body" 'o && o.ok')" == "true" ]]; then
  pass "GET /health -> { ok: true }"
else
  fatal "GET /health -> { ok: true }" "status $STATUS: $(body_snippet)"
fi

# --- 2. dev sign-in ----------------------------------------------------------------------------

JUDGE="smoke-$(rand)"
if signin "$JUDGE"; then
  pass "POST /auth/session (x-dev-user: $JUDGE) -> account, GET /agents"
else
  fatal "POST /auth/session (x-dev-user: $JUDGE) -> account, GET /agents" "status $STATUS: $(body_snippet)"
fi

# --- 3. new-account defaults -------------------------------------------------------------------

req GET /me '' "$JUDGE"
cp "$TMP/body" "$TMP/me.json"
if [[ "$STATUS" != 200 ]]; then fatal "GET /me" "status $STATUS: $(body_snippet)"; fi
checks "$TMP/me.json" '(() => {
  const p = [];
  const agents = Array.isArray(o.agents) ? o.agents : [];
  const names = agents.map((a) => a.name).sort().join(",");
  if (names !== "Moss,Rook,Wren") p.push(`agents ${names || "(none)"}, want Rook, Wren, Moss`);
  const rook = agents.find((a) => a.name === "Rook");
  if (rook) {
    const sk = (rook.skills || []).map((s) => s.name);
    if (sk.length !== 1 || sk[0] !== "Flood Warden") p.push(`Rook skills ${JSON.stringify(sk)}, want [Flood Warden]`);
  }
  const r = o.rank || {};
  if (r.elo !== 1200) p.push(`rank.elo ${r.elo}, want 1200`);
  if (r.rankedMatches !== 0) p.push(`rank.rankedMatches ${r.rankedMatches}, want 0`);
  const c = o.credits || {};
  if (c.allowanceLeft !== 60) p.push(`allowanceLeft ${c.allowanceLeft}, want 60`);
  if (c.balance !== 0) p.push(`balance ${c.balance}, want 0`);
  if (c.held !== 0) p.push(`held ${c.held}, want 0`);
  return p;
})()' "GET /me: Rook/Wren/Moss (Flood Warden on Rook), Elo 1200, 60 free credits" || true

# --- 4. practice vs the greedy bot over WebSocket (the judge path) -----------------------------

PRACTICE_CREW="$(crew_of "$JUDGE" Rook)"
[[ -n "$PRACTICE_CREW" ]] || fatal "practice crew: Rook from /agents" "$(head -c 300 "$TMP/agents-$JUDGE.json")"
printf '[{"devUser":"%s","crew":%s,"ranked":false,"opponent":"bot"}]' "$JUDGE" "$PRACTICE_CREW" >"$TMP/practice-spec.json"
echo "      practice: $JUDGE (Rook) vs $BOT_HANDLE on $PRACTICE_MAP ($PRACTICE_DIFFICULTY)"
node "$WS_V2" "$TMP/practice-spec.json" "$PRACTICE_TIMEOUT" "$TMP/practice.json" || true
[[ -f "$TMP/practice.json" ]] || fatal "practice over WS" "scripts/ws-v2.cjs wrote no result"

checks "$TMP/practice.json" "(() => {
  const p = [], c = o.clients[0], f = c.found;
  if (!c.opened) p.push('socket never opened');
  if (!f) return [...p, 'no v2_found (' + o.why + ')', ...c.errors];
  if (f.practice !== true) p.push('v2_found.practice ' + f.practice + ', want true');
  if (f.free !== true) p.push('v2_found.free ' + f.free + ', want true (greedy brain plays free)');
  if (f.ranked !== false) p.push('v2_found.ranked ' + f.ranked + ', want false');
  if (f.rivalHandle !== '$BOT_HANDLE') p.push('rivalHandle ' + JSON.stringify(f.rivalHandle) + \", want '$BOT_HANDLE'\");
  if (f.mapId !== '$PRACTICE_MAP') p.push('mapId ' + f.mapId + ', want $PRACTICE_MAP');
  if (f.difficulty !== '$PRACTICE_DIFFICULTY') p.push('difficulty ' + f.difficulty + ', want $PRACTICE_DIFFICULTY');
  if (!c.lockin) p.push('no v2_lockin after accepting');
  if (!c.start) p.push('no v2_start after locking in');
  return p;
})()" "practice: v2_found vs $BOT_HANDLE ($(js "$TMP/practice.json" 'o.clients[0].found ? o.clients[0].found.matchId + " on " + o.clients[0].found.mapId : "-"')), accepted, locked in, started" || true

MATCH_ID="$(js "$TMP/practice.json" 'o.clients[0].found && o.clients[0].found.matchId')"
LOG_HASH="$(js "$TMP/practice.json" 'o.clients[0].end && o.clients[0].end.logHash')"
if ! checks "$TMP/practice.json" '(() => {
  const p = [], c = o.clients[0], e = c.end;
  if (!e) return [`no v2_end (${o.why}) after ${c.frames} frames`, ...c.errors];
  if (!e.result) p.push(`void match (reason ${e.reason})`);
  if (!/^[0-9a-f]{64}$/.test(e.logHash || "")) p.push(`logHash ${JSON.stringify(e.logHash)}, want 64 hex`);
  if (c.frames < 1) p.push("no v2_frame before v2_end");
  if (e.debrief && e.debrief.eloDelta !== null) p.push(`debrief.eloDelta ${e.debrief.eloDelta}, want null (casual)`);
  return p;
})()' "practice: v2_end with a log hash ($(js "$TMP/practice.json" '(() => { const c = o.clients[0], e = c.end; return e ? `${e.result ? e.result.winner : "void"}, ${e.reason}, ${c.frames} frames to tick ${c.lastTick}, hash ${String(e.logHash).slice(0, 12)}…` : "-"; })()'))"; then
  [[ -n "$MATCH_ID" && -n "$LOG_HASH" ]] || summary
fi

# --- 5. the stored match -----------------------------------------------------------------------

req GET "/v2/matches/$MATCH_ID" '' "$JUDGE"
if [[ "$STATUS" == 200 ]]; then
  checks "$TMP/body" "(() => {
    const p = [];
    if (o.status !== 'ended') p.push('status ' + o.status + ', want ended');
    if (o.practice !== true) p.push('practice ' + o.practice + ', want true');
    if (o.ranked !== false) p.push('ranked ' + o.ranked + ', want false');
    if (o.logHash !== '$LOG_HASH') p.push('logHash ' + o.logHash + ' differs from v2_end');
    if (o.you !== 'A') p.push('you ' + o.you + ', want A');
    if (!o.teams || o.teams.B.handle !== '$BOT_HANDLE') p.push('team B ' + JSON.stringify(o.teams && o.teams.B.handle) + \", want '$BOT_HANDLE'\");
    if ((o.elo || []).length) p.push('elo deltas on a practice match');
    if (!o.registry || o.registry.status !== 'none') p.push('registry ' + JSON.stringify(o.registry) + ', want none (casual)');
    return p;
  })()" "GET /v2/matches/$MATCH_ID: ended, practice, same log hash, team B is $BOT_HANDLE, no Elo, no registry write" || true
else
  fail "GET /v2/matches/$MATCH_ID" "status $STATUS: $(body_snippet)"
fi

req GET "/v2/matches/$MATCH_ID/messages"
if [[ "$STATUS" == 200 && "$(js "$TMP/body" 'Array.isArray(o.messages)')" == true ]]; then
  pass "GET /v2/matches/$MATCH_ID/messages -> 200 ($(js "$TMP/body" 'o.messages.length') lines; public once ended)"
else
  fail "GET /v2/matches/$MATCH_ID/messages -> 200 { messages }" "status $STATUS: $(body_snippet)"
fi

# --- 6. free practice --------------------------------------------------------------------------

req GET /credits '' "$JUDGE"
if [[ "$STATUS" == 200 ]]; then
  checks "$TMP/body" "(() => {
    const p = [];
    if (o.balance !== 0) p.push('balance ' + o.balance + ', want 0');
    if (o.held !== 0) p.push('held ' + o.held + ', want 0');
    if (o.allowanceLeft !== 60) p.push('allowanceLeft ' + o.allowanceLeft + ', want 60');
    const rows = (o.rows || []).filter((r) => r.matchId === '$MATCH_ID');
    if (rows.length) p.push(rows.length + ' ledger rows for the practice match, want none');
    return p;
  })()" "GET /credits: balance 0, allowance 60, nothing held or charged (practice is free on the greedy brain)" || true
else
  fail "GET /credits" "status $STATUS: $(body_snippet)"
fi

# --- 7. ranked PvP: two clients, Elo and the season --------------------------------------------

if [[ "${SKIP_PVP:-}" == 1 ]]; then
  echo "SKIP  two-client ranked match (SKIP_PVP=1)"
  summary
fi

SUFFIX="$(rand)"
PVP_A="smoke-a-$SUFFIX"
PVP_B="smoke-b-$SUFFIX"
for u in "$PVP_A" "$PVP_B"; do
  signin "$u" || fatal "ranked: sign in $u" "status $STATUS: $(body_snippet)"
done
CREW_A="$(crew_of "$PVP_A" Rook)"
CREW_B="$(crew_of "$PVP_B" Rook)"
[[ -n "$CREW_A" && -n "$CREW_B" ]] || fatal "ranked: crews from /agents" "A=$CREW_A B=$CREW_B"
printf '[{"devUser":"%s","crew":%s,"ranked":true},{"devUser":"%s","crew":%s,"ranked":true}]' \
  "$PVP_A" "$CREW_A" "$PVP_B" "$CREW_B" >"$TMP/pvp-spec.json"

echo "      ranked: $PVP_A (Rook) vs $PVP_B (Rook); up to 150 ticks, so this can take a few minutes at 2 s ticks"
node "$WS_V2" "$TMP/pvp-spec.json" "$PVP_TIMEOUT" "$TMP/pvp.json" || true
[[ -f "$TMP/pvp.json" ]] || fatal "ranked over WS" "scripts/ws-v2.cjs wrote no result"

if ! checks "$TMP/pvp.json" '(() => {
  const p = [], [a, b] = o.clients;
  for (const c of o.clients) {
    if (!c.found) p.push(`${c.devUser}: no v2_found (${o.why})`);
    else if (c.found.ranked !== true) p.push(`${c.devUser}: v2_found.ranked ${c.found.ranked}`);
    if (!c.end) p.push(`${c.devUser}: no v2_end (${o.why})`);
    if (c.errors.length) p.push(`${c.devUser}: ${c.errors.join("; ")}`);
  }
  if (a.found && b.found) {
    if (a.found.matchId !== b.found.matchId) p.push(`different matchIds ${a.found.matchId} / ${b.found.matchId}`);
    if (a.found.team === b.found.team) p.push(`both crews are team ${a.found.team}`);
  }
  if (a.end && b.end) {
    if (!a.end.result) p.push(`void match (reason ${a.end.reason})`);
    if (a.end.logHash !== b.end.logHash) p.push("the two clients got different log hashes");
  }
  return p;
})()' "ranked: both found the same match, played it and got the same v2_end ($(js "$TMP/pvp.json" '(() => { const e = o.clients[0].end; return e && e.result ? `${e.result.winner}, ${e.reason}` : "-"; })()'))"; then
  summary
fi
PVP_MATCH="$(js "$TMP/pvp.json" 'o.clients[0].found.matchId')"
# The team each player got, and the winner ("A", "B" or "draw").
TEAM_A="$(js "$TMP/pvp.json" 'o.clients[0].found.team')"
WINNER="$(js "$TMP/pvp.json" 'o.clients[0].end.result.winner')"

req GET "/v2/matches/$PVP_MATCH"
cp "$TMP/body" "$TMP/pvp-match.json"
checks "$TMP/pvp-match.json" "(() => {
  const p = [], w = '$WINNER';
  if (o.status !== 'ended') p.push('status ' + o.status + ', want ended');
  if (o.ranked !== true) p.push('ranked ' + o.ranked + ', want true');
  const d = Object.fromEntries((o.elo || []).map((e) => [e.team, e.delta]));
  const want = w === 'draw' ? { A: 0, B: 0 } : w === 'A' ? { A: 16, B: -16 } : { A: -16, B: 16 };
  if (d.A !== want.A || d.B !== want.B) p.push('Elo deltas ' + JSON.stringify(d) + ', want ' + JSON.stringify(want) + ' (winner ' + w + ')');
  return p;
})()" "GET /v2/matches/$PVP_MATCH: ranked, ended, Elo $(js "$TMP/pvp-match.json" '(o.elo || []).map((e) => `${e.team} ${e.before} -> ${e.after}`).join(", ")') (winner $WINNER)" || true

# Each player's own Elo and season row: win 25 points, draw 12, loss 5 (SEASON.points).
for u in "$PVP_A" "$PVP_B"; do
  if [[ "$u" == "$PVP_A" ]]; then team="$TEAM_A"; else team="$([[ "$TEAM_A" == A ]] && echo B || echo A)"; fi
  if [[ "$WINNER" == draw ]]; then elo=1200 points=12; elif [[ "$WINNER" == "$team" ]]; then elo=1216 points=25; else elo=1184 points=5; fi
  req GET /me '' "$u"
  checks "$TMP/body" "(() => {
    const r = o.rank || {};
    return r.elo === $elo && r.rankedMatches === 1 ? [] : ['rank ' + JSON.stringify(r) + ', want elo $elo after 1 ranked match'];
  })()" "GET /me as $u (team $team): Elo 1200 -> $elo" || true
  req GET /seasons/current '' "$u"
  checks "$TMP/body" "(() => {
    const y = o.you;
    if (!o.season || o.season.status !== 'open') return ['no open season: ' + JSON.stringify(o.season)];
    if (!y) return ['$u is not in the standings of season ' + o.season.number];
    return y.matches === 1 && y.points === $points ? [] : ['standing ' + JSON.stringify(y) + ', want 1 match and $points points'];
  })()" "GET /seasons/current lists $u: $points points, rank $(js "$TMP/body" 'o.you && o.you.rank') in season $(js "$TMP/body" 'o.season && o.season.number')" || true
done

summary
