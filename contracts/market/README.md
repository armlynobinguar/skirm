# skirm market contract

List, delist, reprice and buy skill NFTs, and rent another player's agent for one match. The
method table, events and fee rules are in [contracts/README.md](../README.md#market); this page
covers agent rentals and the testnet redeploy they need.

## `rent(rental_id, owner_id, price)`

| | |
| --- | --- |
| Caller | the renter's wallet (`market.rent`, 60 Tgas from the web) |
| Deposit | at least `price`; the excess is refunded |
| `rental_id` | `<offerId>:<nonce>`, 1 to 96 bytes (the backend's offer id) |
| Pays | the platform fee (`fee_bps`, 500) split like a sale's: `season_share_bps` of it to `seasons.fund`, the rest to the treasury; `price - fee` to `owner_id` |
| Panics | empty or long `rental_id`, `price` 0, `owner_id` = caller, deposit below `price`. A panic refunds the whole deposit (nothing was paid) |
| Event | `skirm_market` `rental` `{rental_id, owner, renter, price, fee, fee_bps, season_share, treasury_share, owner_proceeds, refund}` |
| State | none: agents live offchain, so nothing is stored or transferred |

The api turns a rental into a one-match pass only after it reads the transaction back
(`EXPERIMENTAL_tx_status`, `wait_until: FINAL`, as the renter's linked account) and finds the
market's own `rental` event (logged by `market.playskirm.testnet` itself) whose `rental_id` starts
with the offer id, `owner` is the agent owner's linked account, `renter` is the caller's linked
account, `price` covers the offer and `fee + owner_proceeds = price`
(`packages/server/src/near/rentals.ts`, `apps/api/src/controllers/rentals.controller.ts`). The tx
hash is recorded once (`rentals.tx_hash` unique), so a retry returns the same pass.

## What testnet runs today

Checked 2026-11-05 against `market.playskirm.testnet` (code hash
`37FAyVpdgXVpmq18cUHik7kXu8Dv6FYMFH1XSCZ4mYDZ`, deployed 2026-11-01 from the initial commit): its
wasm exports `apply_fee buy contract_source_metadata delist fee_for get_config get_listing
get_listings get_listings_by_seller is_purchase_pending listing_count new nft_on_approve
on_season_funded propose_fee resolve_purchase set_fee_bps set_governance set_owner set_season_pool
set_treasury update_price`. The repo adds exactly one method, **`rent`** (and the `rental` event it
logs); a view call of `rent` on testnet fails with `MethodNotFound`. Nothing else changed:
`buy`/`resolve_purchase` were refactored onto a shared `pay_fee` helper with identical payouts.

To check it yourself:

```sh
# Exported methods of the deployed wasm
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"query","params":{"request_type":"view_code","finality":"final","account_id":"market.playskirm.testnet"}}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=Buffer.from(JSON.parse(s).result.code_base64,'base64');console.log(WebAssembly.Module.exports(new WebAssembly.Module(b)).map(e=>e.name).sort().join(' '))})"
```

## State migration: none needed

The contract state (`Contract`: owner, governance, NFT contract, treasury, season pool, season
share, fee, pending fee, `listings`, `by_seller`, `pending`) and its storage keys are byte for byte
the same in the deployed code and the repo (`git diff 6c112d3 HEAD -- contracts/market/src/lib.rs`
touches no stored type), and `rent` stores nothing. Redeploying the code keeps every listing and the
fee settings, so there is no `migrate` method and no init call. (Were a stored type to change, the
redeploy would need an `#[init(ignore_state)] migrate()` that reads the old layout and writes the new
one, per [NEAR's upgrade guide](https://docs.near.org/smart-contracts/release/upgrade).)

## Redeploy runbook (testnet, operator only)

Needs: [near-cli-rs](https://docs.near.org/tools/near-cli) and the market account's full-access key
in the legacy keychain (`~/.near-credentials/testnet/market.playskirm.testnet.json`, written by
`scripts/deploy-testnet-contracts.ts`). `scripts/deploy-testnet-contracts.ts` skips accounts that
already have code, so it does not redeploy; use the CLI as below. Never use `--fresh market`: it
deletes the account and its listings.

1. **Build.** Take the wasm CI built from `main` after this lands (the `contracts` job uploads
   `contracts-wasm`), or build locally with a toolchain that builds near-sdk 5.29:

   ```sh
   gh workflow run ci.yml --ref main          # or use the run of the merge commit
   gh run list --workflow ci.yml --branch main --limit 1
   gh run download <run id> -n contracts-wasm -D /tmp/wasm
   # local alternative: cd contracts && ./build.sh  (target/wasm32-unknown-unknown/release/skirm_market.wasm)
   ```

2. **Check the wasm has `rent`** before deploying:

   ```sh
   node -e "const b=require('fs').readFileSync('/tmp/wasm/skirm_market.wasm');console.log(WebAssembly.Module.exports(new WebAssembly.Module(b)).map(e=>e.name).includes('rent'))"   # true
   ```

3. **Check the balance covers storage.** The account holds about 4.0 NEAR with 307,556 bytes used
   (about 3.08 NEAR locked). Storage costs 1 NEAR per 100 kB; if the new wasm is more than about
   90 kB larger than the old one (307,177 bytes), top it up first:
   `near tokens playskirm.testnet send-near market.playskirm.testnet '1 NEAR' network-config testnet sign-with-legacy-keychain send`.

4. **Deploy the code, no init call** (state is kept):

   ```sh
   near contract deploy market.playskirm.testnet \
     use-file /tmp/wasm/skirm_market.wasm \
     without-init-call \
     network-config testnet \
     sign-with-legacy-keychain \
     send
   ```

5. **Verify** the state survived and `rent` exists:

   ```sh
   near contract call-function as-read-only market.playskirm.testnet get_config json-args '{}' network-config testnet now
   # same owner, treasury, season pool, fee_bps 500 as before
   near contract call-function as-read-only market.playskirm.testnet listing_count json-args '{}' network-config testnet now
   ```

   Then rent once from a test wallet (any account other than the owner):

   ```sh
   near contract call-function as-transaction market.playskirm.testnet rent \
     json-args '{"rental_id":"smoke:1","owner_id":"<another testnet account>","price":"10000000000000000000000"}' \
     prepaid-gas '60 Tgas' attached-deposit '0.01 NEAR' \
     sign-as <your testnet account> network-config testnet sign-with-keychain send
   ```

   The receipt logs `EVENT_JSON:{"standard":"skirm_market",...,"event":"rental",...}`.

6. **Switch the backend on.** Set `NEAR_RENTALS_ONCHAIN=true` for the api (`.env` locally, the api
   service's env on staging) and restart it. `GET /rentals` then answers `payWith: "near"` and the
   web signs `market.rent` from the renter's wallet; with it unset or `false` rentals are paid in
   credits. No web rebuild is needed: the web follows the api. Players need a linked NEAR account
   to rent or to be paid; offers whose owner has none cannot be rented while it is on.

7. **Update the docs**: the "Deployed on testnet" table in [contracts/README.md](../README.md) (date,
   and drop the note that the market predates `rent`).

Rolling back: set `NEAR_RENTALS_ONCHAIN=false` (rentals go back to credits at once; passes already
paid onchain stay valid). Redeploying the old wasm is not needed, because `rent` is additive.
