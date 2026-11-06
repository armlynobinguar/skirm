# skirm walkthrough

"Do X, see Y" for the local stack, then the same over the API. Start the stack first with `docker compose up --build` (see the [README](../README.md#quick-start)). It runs the offline greedy brain (`V2_BRAIN=greedy`), so no model key is needed and practice is free. Matches tick every 2 s, so one lasts up to 5 minutes; `V2_TICK_MS=200 docker compose up --build` makes them about ten times faster (keep the default for step 4, spectating, so there is time to open a second window).

The `data-testid` values in brackets are stable selectors for agents driving a browser. Outcomes are stated loosely where the agents decide them: the greedy brain plays the same way every time, but the map and seat decide who wins.

## Browser walkthrough

### 1. Sign in → Home

1. Open http://localhost:3000. You see the sign-in screen [`screen-s01`].
2. Type a handle, for example `judge1`, in **Handle**, then click **Sign in** [`s01-signin`].
3. **See:**
   - Home (the Command deck) at `/play` [`screen-s02`, `s02-deck`], with your handle on the account badge in the top bar [`account-badge`]; click it to open the account card [`topbar-account`].
   - Credits **0** and **60 free** [`topbar-credits`, `topbar-allowance`].
   - Seven tiles: **Skirmish** (ranked) [`s02-tile-ranked`], **Map atlas** [`s02-tile-atlas`], **Crew** [`s02-tile-crew`], **Skills** (the Exchange) [`s02-tile-skills`], **Ladder** [`s02-tile-ladder`], **Practice · Vs Greedy bot** [`s02-tile-practice`] and **Daily** (today's seed) [`s02-tile-daily`].

Every new account starts with the same crew: **Rook**, **Wren** and **Moss**, each with a role, vision 3, comms 3 and the Standard talk tier. Rook carries the account-bound starter skill **Flood Warden**. Your own Elo starts at 1,200.

#### Roles

Set an agent's role in the agent editor (**Role** [`agent-role-picker`], one button per role [`agent-role-<Role>`]) or with `PATCH /agents/:id { role }`. A role change is refused while the agent has a skill equipped that is not for that role. The engine's exact rules live in `packages/engine/src/v2/match.ts` (the original six) and `roles.ts` (the four newer ones).

| Role | What it does |
| --- | --- |
| Builder | The only role that uses `add_solid` verbs: places a block on an adjacent open tile (the crew's block supply). |
| Digger | The only role that uses `remove_solid` verbs (rubble, blocks, crates, trees); walking into dirt clears it in one move instead of three. |
| Firefighter | The only role that uses `extinguish` verbs on adjacent fire. |
| Scout | The only role that uses `area_repel`: stuns rivals within 2 tiles for 3 ticks, every 15 ticks. |
| Runner | Takes and delivers; carries 2 items. |
| Hauler | Takes and delivers; carries 3 items. |
| **Medic** | `tend <agent>` on a crewmate within 1 tile (a knocked-down agent does not hold its tile, so the Medic may stand on it). A knock-down with 2 or more ticks left loses 2 of them, never going under 1: the crewmate still gets up at its start, 2 ticks sooner (4 → 2). A stun is cleared and the crewmate acts next tick. Then the Medic waits 5 ticks. Never itself, never a rival. Carries 2. |
| **Engineer** | Pulls a valve (switch) from up to 2 tiles away instead of only next to it (the nearest in reach, map order on a tie); the switch's shared 26-tick reset is unchanged. Has 2 bridges of its own: `use bridge <dir>` lays one on adjacent water exactly like a supply-drop bridge, without using its tool slot; a bridge it carries from a drop goes down first. Bridges never break, so there is nothing to repair. Carries 2. |
| **Saboteur** | `plant <dir>` puts a decoy on adjacent open floor (not grass, ice, an item, the delivery point, a start tile, a tool or placed gear, and nobody standing there). 2 per match, and each one uses one of the crew's bluffs: bluffs told plus decoys planted never pass the crew's bluff cap (3 by default). The rival crew sees the decoy as an item whenever the tile is in its sight (fog applies, and it remembers it like any tile); the planting crew sees floor, and its frames list its decoys. A rival that ends a move on it with room to carry springs it: nothing is picked up, the decoy is gone and the rival loses its next action. The planting crew walks over its own decoys; a decoy whose tile stops being open floor (a hazard, a flood, a block, a dropped item) is gone. Bluffs are only ever about real middle items, never a decoy. Carries 2. |
| **Courier** | Carries 1 item. A move whose first tile is open ground (floor or grass; not ice, water or a bridge, an item, a decoy it takes for an item, the delivery point or a tool) goes one more tile the same way when that tile is floor, grass, an item or the delivery point, inside the walls and free of agents. Rubble, walls and hazards stop the second tile. It resolves after every other move and ice slide; pickups and deliveries happen where it ends. |

**Ranked** plays the original six only while `DEFAULTS.roles.rankedNewRoles` is `false` (the default): queueing ranked, changing the crew at ranked lock-in, or starting a ranked match with a Medic, Engineer, Saboteur or Courier is refused with `role_unranked`, and the engine itself refuses to create such a ranked match. Everything else (casual, practice, lobbies, tournaments, the campaign, daily and puzzles where you pick the crew) plays all ten. The registry contract stores agent ids and talk tiers, never roles, so it needs no change.

**Balance.** The Medic halves a knock-down and takes 2 ticks off a Scout's 3-tick stun, at most every 5 ticks and only next to the crewmate, so it spends its own moves to save its crew's. The Engineer's reach is one tile more and its bridges only matter on water maps. The Saboteur's decoys come out of the bluff budget, cost an action each and cost the victim one action plus the walk. The Courier covers up to twice the ground but brings home half a Runner's load per trip and stops at every item, so it is best on scattered items and steals. In greedy-vs-greedy sweeps over all ten maps (easy and normal, both sides) a crew that swaps one Runner for the new role scores within a Hauler's margin of an all-Runner crew.

**Replays.** Old matches only have the original six, and their rules did not change: an original-role match plays, logs and hashes exactly as before (`packages/engine/test/v2-role-parity.test.ts` and `packages/decision-engine/test/v2-role-parity.test.ts` pin scripted and greedy matches on every map, taken before the new roles), so `/verify` recomputes every stored match the same.

### 2. Practice vs Greedy bot (the judge path)

1. Click the **Practice** tile [`s02-tile-practice`]. **See** the crew screen at `/maps/copper-hollow/crew?d=easy&opponent=bot` [`screen-s04`]:
   - **Vs Greedy bot** is on [`s04-opponent`, radio "Vs Greedy bot" checked], and Copper Hollow is marked **quick** [`s04-quick`].
   - Rook is in the crew [`s04-card-<agentId>`].
2. Click **Start practice ▸** [`s04-queue`]. There is no matchmaking: the match screen opens at once at `/matches/mat_…`, marked **vs Greedy bot** [`v2-practice`] and **Free practice** [`v2-free`].
3. Click **Accept** [`v2-accept`]. The bot accepts and locks in by itself. **See** the lock-in [`v2-lockin`], with the hold reading **Free practice · nothing is held or charged** [`v2-hold`].
4. Click **Lock in ▸** [`v2-lock`]. **See** the live arena [`v2-live`]: both crews on the shared map, the clock, the score and the comms feed. Press **Enter** to skip the intro.
5. **See** the end: the verdict **Victory**, **Defeat** or **Draw** [`v2-verdict`] (on Copper Hollow, Easy the greedy crews usually finish 3–0 inside 60 ticks, mostly for your side), the match log hash, 64 hex characters [`v2-hash`], and the comms transcript [`v2-transcript`]. The NEAR line reads **Casual match · not written to the registry** [`v2-registry`].
6. **See** the account card (click the account badge) still at **0** and **60 free** [`topbar-allowance`]: practice on the greedy brain holds and charges nothing.

### 3. Ranked in two browsers

Use two separate browser profiles (a normal and a private window), signed in as `alice` and `bob`. A 1-agent ranked crew holds 30 credits, which the free 60 covers.

1. Both windows: click **Skirmish** [`s02-tile-ranked`] or **PvP** [`nav-pvp`]. **See** the hub [`screen-s11`]: Rook picked [`s11-agent-rook`], Elo **1,200** [`s11-elo`], **Holds 30 credits** [`s11-cost`], the season panel [`s11-season`] and the ladder [`s11-ladder`].
2. Window A: click **Find match** [`s11-find-match`]. **See** "Finding a match", the search time and the Elo range [`s11-queue`]. Window B: click **Find match**.
3. **See** the VS takeover in both windows [`s11-vs`]; the rival is still hidden. Click **Accept** [`s11-vs-accept`] in both. Both windows open the same `/matches/mat_…`.
4. **See** the lock-in [`v2-lockin`] reading **Ranked plays every agent at Standard**; the rival is still unnamed. Click **Lock in ▸** [`v2-lock`] in both.
5. **See** the live match [`v2-live`] with the rival's handle and the clock [`v2-clock`] running.
6. At the end [`v2-ended`]: one window reads **Victory** and the other **Defeat**, or both **Draw** [`v2-verdict`], with the same log hash [`v2-hash`]. The report [`v2-tally`] shows the Elo change [`v2-elo`], the MVP and the credits **used of 30 held · the rest back** [`v2-credits`]. The NEAR line [`v2-registry`] reads **Recorded on this server only (NEAR is off here)**, because NEAR is a no-op locally.
7. Click **Queue again** [`v2-again`]. **See** the hub with Elo **1,224** for the winner and **1,176** for the loser (1,200 on a draw) [`s11-elo`].
8. Click **Leaderboards** [`nav-leaderboards`] [`screen-s14`]. **See** both players in the season standings [`s14-season`, `s14-season-row-<rank>`] (25 points for a win, 5 for a loss, 12 each for a draw) and in the all-time ladder [`s14-alltime`]. The pool reads **local** [`s14-pool-local`] until the seasons contract is deployed.

### 4. Spectate

1. Start a match (practice or ranked) in one window at the default 2 s ticks.
2. In another signed-in window, open **PvP** [`screen-s11`]. **See** it under **Live now** [`s11-live`, `s11-live-<matchId>`], with a **Practice** badge for a practice match [`s11-live-practice-<matchId>`].
3. Click **Watch**. **See** the whole board at `/matches/<matchId>` [`v2-live`]: both crews, their cards and talk, named by letter and handle (the bot as Greedy bot). Any window can open that URL, signed in or not.
4. At the end a spectator sees the result by crew [`v2-ended`], not a verdict of their own.

### 5. Exchange proof and trials

1. Click **Skills** [`s02-tile-skills`] or **Market** [`nav-market`]. **See** the Exchange [`screen-s09`] with the official skills seeded at startup (Gate Keeper, Firebreak, Lava Dam, Sandbag Line, Tunnel Rat, Ember Guard, Supply Runner), each card with its proof line [`s09-proof`], filters [`s09-filters`] and sort [`s09-sort`].
2. Open any official skill [`s09-card-<skillId>`]. **See** the drawer [`screen-s10`]:
   - **Benchmark at mint** [`s10-benchmark`]. On the greedy brain it reads **Benchmarks need a model key; this server runs the offline bot brain. No score until it runs with one.** [`s10-benchmark-needs-model`]. With a model key it shows wins, deliveries and a score [`s10-benchmark-score`].
   - **Manipulation**, the hijack gauntlet [`s10-gauntlet`]: leak and manipulation rates, or the same needs-model line.
   - Ranked stats per map [`s10-ranked`] and head-to-head counters [`s10-counters`], empty until ranked matches use the skill.
   - The pinned version hash [`s10-hash`]: the prompt's sha256, so a version cannot change after mint.
3. Under **Try before you buy** [`s10-trials`], **3 OF 3 LEFT**: pick an agent [`s10-trial-agent`] and click **Run a trial** [`s10-trial-start`]. **See** the trial in the list [`s10-trial-list`, `s10-trial-<trialId>`]. On the greedy brain it ends with the needs-model line and **This trial did not count**, so the count stays at 3.
4. To mint your own: **My skills** [`nav-skills`] → **New skill**, fill in **Name** [`s08-name`] and **Prompt** [`s08-prompt`], click **Save draft** [`s08-save`] (the version reads **v1** [`s08-version-label`]). The benchmark line reads **Runs at mint** [`s08-benchmark`]. **Mint** [`s08-mint`] needs a linked NEAR account (dev mode trusts any id typed in the Connect wallet dialog [`m01-connect-wallet`]); minting is never gated on a test.

### 6. Cosmetics

1. Top up first (step 7), because premium looks use paid credits only, never the free allowance.
2. Open **Profile** (`/account`, or click your handle [`topbar-account`]) [`screen-s16`]. Click **Customize** on Rook [`s16-agent-look-<agentId>`]; the **Look** tab [`s16-customize-look`] opens.
3. Pick the ninth outfit swatch, **Gold outfit**, priced **100** [`look-outfit-8`, `look-outfit-8-price`]. **See** "Gold outfit is premium: 100 paid credits" [`look-premium`], and **Save look** [`look-save`] stays disabled.
4. Click **Buy · 100 credits** [`look-buy-outfit_gold`], then **Save look**. **See** the paid balance drop by 100 [`topbar-credits`] and a cosmetic row on the credits ledger. Without paid credits the buy says **Not enough paid credits: need 100, have 0** with a **Top up credits** link [`look-buy-error`, `look-buy-topup`].

### 7. Credits and profile

1. Open the account badge and click the credits [`topbar-credits`] or open `/account/credits` [`screen-s15`]. **See** available **0** [`s15-balance-available`], held **0** [`s15-balance-held`] and the allowance **60 / 60** with its reset time [`s15-allowance`, `s15-allowance-reset`] on a fresh account (less after a ranked match).
2. In the top-up panel [`s15-topup`], pick **0.5 NEAR** and click **Top up 0.5 NEAR**. The dialog [`m02-confirm-transaction`] reads **Top up 500 credits** [`m02-item`] and **0.5 NEAR** [`m02-price`]. Click **Confirm in wallet · …** [`m02-confirm`] (dev mode signs nothing), then **Done** [`m02-done-close`].
3. **See** available **500** [`s15-balance-available`] and a **Top-up** row, "0.5 NEAR at 1,000 credits per NEAR", **+500** in the ledger [`s15-ledger`]. A ranked match adds hold, charge and refund rows that link to its result.
4. Open **Profile** [`screen-s16`]. **See** Rook, Wren and Moss [`s16-agent-name`], your rank: Elo [`s16-rank-elo`], title [`s16-rank-title`] and record [`s16-rank-record`], your recent matches [`s16-matches`, `s16-match-<matchId>`] with practice ones marked, and the NEAR account panel [`s16-near-none`, `s16-connect-wallet`].

---

## API-only path (for agents)

The same flow as `scripts/smoke.sh`, with `curl`, `jq` and the repo's WebSocket client. In dev mode the `x-dev-user` header is the session. Run `npm ci` at the repo root first (for `ws`).

```sh
API=http://localhost:4000
H='x-dev-user: agent-judge-1'

curl -s $API/health                                          # {"ok":true}
curl -s -X POST -H "$H" $API/auth/session | jq .account      # creates the account with the starter defaults
curl -s -H "$H" $API/me | jq '{rank, credits, agents: [.agents[] | {name, tier, skills: [.skills[].name]}]}'
# rank.elo 1200, credits.allowanceLeft 60, balance 0; Rook [Flood Warden], Wren, Moss, all standard

# Practice vs the greedy bot on DEFAULT_PRACTICE (Copper Hollow, Easy): queue, accept, lock in, wait for v2_end
CREW=$(curl -s -H "$H" $API/agents | jq -c '[.[] | select(.name=="Rook") | {agentId: .id, tier}]')
node scripts/ws-v2.cjs "[{\"devUser\":\"agent-judge-1\",\"crew\":$CREW,\"opponent\":\"bot\"}]" 300 practice.json
jq '.clients[0] | {found: .found | {matchId, practice, free, rivalHandle, mapId}, frames, end: .end | {result, logHash}}' practice.json
# found.practice true, free true, rivalHandle "Greedy bot", mapId "copper-hollow"; end.logHash: 64 hex

M=$(jq -r '.clients[0].found.matchId' practice.json)
curl -s -H "$H" $API/v2/matches/$M | jq '{status, practice, ranked, logHash, winner, score, registry}'
# status "ended", practice true, ranked false, the same logHash, registry {status: "none"}
curl -s $API/v2/matches/$M/messages | jq '.messages[:3]'     # the lines realtime saw delivered (public once ended)
curl -s -H "$H" $API/credits | jq '{balance, held, allowanceLeft}'   # 0, 0, 60: practice was free

# Ranked: two clients pair with each other (each holds 30 from its free allowance)
for u in agent-a agent-b; do curl -s -X POST -H "x-dev-user: $u" $API/auth/session >/dev/null; done
CA=$(curl -s -H 'x-dev-user: agent-a' $API/agents | jq -c '[.[] | select(.name=="Rook") | {agentId: .id, tier}]')
CB=$(curl -s -H 'x-dev-user: agent-b' $API/agents | jq -c '[.[] | select(.name=="Rook") | {agentId: .id, tier}]')
node scripts/ws-v2.cjs "[{\"devUser\":\"agent-a\",\"crew\":$CA,\"ranked\":true},{\"devUser\":\"agent-b\",\"crew\":$CB,\"ranked\":true}]" 600 ranked.json
R=$(jq -r '.clients[0].found.matchId' ranked.json)
curl -s $API/v2/matches/$R | jq '{winner, elo}'              # Elo deltas +24 / -24 in placements (0 / 0 on a draw)
curl -s -H 'x-dev-user: agent-a' $API/seasons/current | jq '{season: .season | {number, status, poolSource}, you}'
curl -s "$API/leaderboards/players?limit=5" | jq .rows

# The Exchange: proof and a trial
S=$(curl -s -H "$H" $API/market | jq -r '.[0].skill.id')
curl -s -H "$H" $API/market/$S | jq '{benchmark: .benchmark | {status, needsModel, score}, trials}'
AG=$(echo "$CREW" | jq -r '.[0].agentId')
curl -s -X POST -H "$H" -H 'content-type: application/json' -d "{\"agentId\":\"$AG\"}" $API/market/$S/trial   # 202 {trialId, status}
curl -s -H "$H" $API/market/$S/trials | jq '.[0] | {status, needsModel}'   # needs_model on the greedy brain; it does not count

# Credits and cosmetics
curl -s -X POST -H "$H" -H 'content-type: application/json' \
  -d '{"txHash":"dev:500000000000000000000000"}' $API/credits/deposits      # {"credited":500,"balance":500,...}
curl -s -H "$H" $API/cosmetics | jq '.items[] | {id, name, priceCredits}'
curl -s -X POST -H "$H" $API/cosmetics/outfit_gold/buy                       # {"owned":["outfit_gold"]}, 100 paid credits
```

`scripts/ws-v2.cjs SPEC [TIMEOUT_S] [OUT_FILE]` signs each client in, sends `v2_queue`, accepts its `v2_found`, locks in on `v2_lockin` and waits for `v2_end`; its header documents the spec and the result. By hand, over `ws://localhost:4001/ws`:

- Practice: `{"type":"auth","devUser":"agent-judge-1"}`, then `{"type":"v2_queue","crew":[{"agentId":"agt_…","tier":"standard"}],"ranked":false,"opponent":"bot"}`. Answer `v2_found` with `{"type":"v2_accept","matchId":"mat_…"}` and `v2_lockin` with `{"type":"v2_lock_in","matchId":"mat_…","tiers":["standard"]}`; frames follow until `v2_end`.
- Spectate: `{"type":"v2_watch","matchId":"mat_…"}` from any socket, no sign-in needed. `GET /v2/matches/live` lists what is playing.

Every route and message is in [backend-contract.md](backend-contract.md).

**The whole check in one script.** It needs Node 20+ and `npm ci` at the repo root:

```sh
scripts/smoke.sh                  # WEB_BROWSER=1 adds a headless-Chromium sign-in; SKIP_PVP=1 skips the ranked match
```

It prints PASS or FAIL per check:
1. The web app serves the sign-in screen and its bundle points at the api (with `WEB_BROWSER=1`: sign-in lands on Home with **60 free** and the Practice tile).
2. Health, dev sign-in and the new-account defaults (Rook, Wren, Moss; Elo 1,200; 60 free credits).
3. Practice vs Greedy bot over WebSocket: found, accepted, locked in, `v2_end` with a log hash.
4. The stored match: ended, practice, the same log hash, no Elo, no registry write; its messages.
5. Credits unchanged: practice is free on the greedy brain.
6. Two clients play a ranked match: Elo ±24 (placement K-factor; 0 on a draw) and both players in `/seasons/current`.
