#!/usr/bin/env bash
# Code-only upgrade of the testnet contracts that are behind main: seasons and deposits (the failed
# transfer fix, 061618b: on_prize_transferred and on_withdrawn) and market (agent rentals, 62a685b:
# rent). No init call and no state migration: the contract state structs are unchanged since the
# 2026-11-01 deploy, and each upgrade only adds methods (checked below before anything is sent).
#
#   scripts/redeploy-testnet-code.sh            # downloads the wasm from the latest green main CI run
#   WASM_DIR=path/to/wasm scripts/redeploy-testnet-code.sh
#   DRY_RUN=1 scripts/redeploy-testnet-code.sh  # checks only, deploys nothing
#
# Needs: near-cli-rs (`near`), node >= 20, and for the download `gh` signed in to the repo. Each
# contract account's own full-access key must be in the keychain (~/.near-credentials/testnet/):
# whoever ran the 2026-11-01 deploy has them. The script never prints a key.
set -euo pipefail

NET_ID=testnet
CONTRACTS=(seasons deposits market)
PARENT="${PARENT:-playskirm.testnet}"
RPC="${RPC:-https://rpc.testnet.near.org}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log() { printf '[redeploy] %s\n' "$*"; }

command -v node >/dev/null || { log "node is required"; exit 1; }
if [[ -z "${DRY_RUN:-}" ]]; then command -v near >/dev/null || { log "near-cli-rs (near) is required"; exit 1; }; fi

# 1. The wasm: from WASM_DIR, or the contracts-wasm artifact of the latest successful main CI run.
if [[ -z "${WASM_DIR:-}" ]]; then
  WASM_DIR="$(mktemp -d)"
  RUN="$(gh run list --workflow ci.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')"
  [[ -n "$RUN" ]] || { log "no successful main CI run found"; exit 1; }
  log "downloading contracts-wasm from CI run $RUN"
  gh run download "$RUN" -n contracts-wasm -D "$WASM_DIR"
fi

# 2. Check each wasm against the live contract: it must keep every live method (additive only).
check() {
  node - "$1" "$2" "$RPC" <<'EOF'
const fs = require('fs');
const [acct, file, rpc] = process.argv.slice(2);
const names = async (buf) => WebAssembly.Module.exports(await WebAssembly.compile(buf)).filter((e) => e.kind === 'function').map((e) => e.name).sort();
(async () => {
  const r = await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_code', finality: 'final', account_id: acct } }) })).json();
  if (!r.result) { console.log(`${acct}: cannot read the live code (${JSON.stringify(r.error).slice(0, 120)})`); process.exit(2); }
  const live = await names(Buffer.from(r.result.code_base64, 'base64'));
  const next = await names(fs.readFileSync(file));
  const added = next.filter((n) => !live.includes(n));
  const removed = live.filter((n) => !next.includes(n));
  console.log(`${acct}: adds [${added.join(' ') || 'nothing'}] removes [${removed.join(' ') || 'nothing'}]`);
  process.exit(removed.length ? 3 : added.length ? 0 : 4);
})();
EOF
}

TODO=()
for c in "${CONTRACTS[@]}"; do
  acct="$c.$PARENT"
  wasm="$WASM_DIR/skirm_$c.wasm"
  [[ -f "$wasm" ]] || { log "missing $wasm"; exit 1; }
  set +e
  check "$acct" "$wasm"
  rc=$?
  set -e
  case $rc in
    0) TODO+=("$c") ;;
    4) log "$acct is already up to date, skipping" ;;
    3) log "$acct: the new code would remove live methods; refusing (check the build)"; exit 1 ;;
    *) log "$acct: check failed"; exit 1 ;;
  esac
done

if [[ ${#TODO[@]} -eq 0 ]]; then log "nothing to deploy"; exit 0; fi
if [[ -n "${DRY_RUN:-}" ]]; then log "DRY_RUN: would deploy ${TODO[*]}"; exit 0; fi

# 3. Deploy (code only, keeps state), signed with each contract account's own key from the keychain.
for c in "${TODO[@]}"; do
  log "deploying $c.$PARENT"
  near contract deploy "$c.$PARENT" use-file "$WASM_DIR/skirm_$c.wasm" without-init-call \
    network-config "$NET_ID" sign-with-keychain send
done

# 4. Verify on chain: every check now reports the contract up to date.
for c in "${TODO[@]}"; do
  set +e
  check "$c.$PARENT" "$WASM_DIR/skirm_$c.wasm"
  rc=$?
  set -e
  [[ $rc -eq 4 ]] || { log "$c.$PARENT does not match the new code yet (rc $rc): check the transaction"; exit 1; }
done
log "done: ${TODO[*]} upgraded. With market upgraded, NEAR_RENTALS_ONCHAIN can be turned on."
