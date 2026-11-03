# skirm NEAR contracts

Rust contracts (near-sdk 5.29, near-contract-standards 5.29) for the MVP onchain systems in arch.md
and the season prize pools. The stretch `pool` contract is not included.

| Crate | Account (testnet) | What it does |
| --- | --- | --- |
| `skills` | `skills.playskirm.testnet` | NEP-171 skill NFTs (core, approval, enumeration, metadata), one token per skill version, NEP-199 royalty payouts |
| `market` | `market.playskirm.testnet` | List through `nft_approve`, delist, reprice, buy with NEAR; pays the platform fee (30% of it to the season pool), creator royalty and seller; fee changes go through a 24 h timelock |
| `registry` | `registry.playskirm.testnet` | Match records (`MatchRecordV2`), log hashes, Elo per player, per-season standings |
| `deposits` | `deposits.playskirm.testnet` | `deposit()` top-ups with a NEP-297 event for the credits ledger; owner withdraws to the treasury |
| `seasons` | `seasons.playskirm.testnet` | 14-day season prize pools: funded by market fees, standings posted by ops, prizes claimed by players |

Roles used below: `playskirm.testnet` is the owner (full-access keys kept offline), the treasury and
the market's governance account. `ops.playskirm.testnet` is the platform signer.

The ops key allow-list (function-call keys, one per contract):

| Contract | Methods |
| --- | --- |
| `skills` | `nft_mint` |
| `registry` | `record_match` |
| `seasons` | `open_season`, `lock_season`, `post_standings`, `close_season` |

Function-call keys cannot attach NEAR, so `skills`, `registry` and `seasons` pay their own storage.
None of the market's admin methods are on the list: they all need 1 yocto.

## Build

```sh
cd contracts
./build.sh            # -> target/wasm32-unknown-unknown/release/skirm_{skills,market,registry,deposits,seasons}.wasm
```

`wasm32v1-none` cannot build these contracts because it only provides `core`/`alloc` and
near-sdk needs `std`. `build.sh` builds for `wasm32-unknown-unknown` instead and rebuilds `std`
with `-C target-cpu=mvp` via `-Z build-std` (enabled on stable with `RUSTC_BOOTSTRAP=1`). The
result uses only MVP wasm features. It needs the `rust-src` component, not the
wasm32-unknown-unknown std. If you have [cargo-near](https://github.com/near/cargo-near),
`cargo near build non-reproducible-wasm` inside each crate directory works too.

## Test

```sh
cd contracts
cargo test                                                   # unit tests, every contract (no network)
./build.sh && cargo test -p skirm-integration-tests --features sandbox   # sandbox end-to-end (opt-in)
```

The unit tests use near-sdk `unit-testing` and `testing_env!`. They cover every method,
access control, Formulas §6 arithmetic and the market callback outcomes:

* 5 NEAR resale gives a 0.25 fee, 0.25 royalty and 4.5 to the seller. A 5 NEAR primary sale
  gives a 0.25 fee, 0 royalty and 4.75 to the creator.
* The parts sum to the price for odd yocto amounts.
* Callback outcomes: success, failed transfer, unparseable or oversized payout, private callback.
* Market governance: the 24 h fee delay and the 1,000 bps cap, owner/governance access, setter
  events, the season share split (sums to the fee for odd amounts, zero share, no pool) and the
  failed `fund` forwarding the share to the treasury.

The sandbox tests (near-workspaces 0.22, which downloads a `near-sandbox` binary on first run)
deploy the release wasm. They then check the same splits against real account balances, plus a
failed purchase refund, registry writes and deposit events. They also measure storage per write.
The `integration-tests` crate is outside `default-members`, so a plain `cargo test` never builds
or starts the sandbox.

## Deployed on testnet (2026-11-01)

These contracts are live and initialized, built with `contracts/build.sh` and deployed with
`scripts/deploy-testnet-contracts.ts`:

| Account | Contract | Init |
| --- | --- | --- |
| `playskirm.testnet` | none (owner and treasury) | |
| `skills.playskirm.testnet` | `skirm_skills.wasm` | owner `playskirm.testnet`, ops `ops.playskirm.testnet`, account-bound Flood Warden |
| `market.playskirm.testnet` | `skirm_market.wasm` | NFT contract `skills.playskirm.testnet`, treasury and governance `playskirm.testnet`, fee 500 bps (max 1000, 24 h delay), 30% of fees to `seasons.playskirm.testnet` |
| `registry.playskirm.testnet` | `skirm_registry.wasm` | owner `playskirm.testnet`, ops `ops.playskirm.testnet`, Elo start 1200, floor 100 |
| `seasons.playskirm.testnet` | `skirm_seasons.wasm` | owner `playskirm.testnet`, ops `ops.playskirm.testnet` |
| `deposits.playskirm.testnet` | `skirm_deposits.wasm` | treasury `playskirm.testnet`, default minimum deposit |
| `ops.playskirm.testnet` | none (platform signer, 1 NEAR) | |

The backend's season job opens each season onchain with the ops key. While no season is open,
the market forwards the season share of each fee to the treasury.

These are the `NEAR_CONTRACT_*` defaults, so the backend needs only the signer to go onchain:
`NEAR_OPS_ACCOUNT=ops.playskirm.testnet` and `NEAR_OPS_KEY=<ops private key>`. The keys are held by the
person who ran the deploy, in `~/.near-credentials/testnet/`; ask them for the ops key and store
it as a secret (for GCP staging: Secret Manager `<env>-near-ops-key`). The ops account holds a
single full-access key because the backend signs every contract with one `NEAR_OPS_KEY`; keep its
balance small. Move the owner key of `playskirm.testnet` offline.

## Deploy (testnet, near CLI: `near-cli-rs`)

Replace `playskirm.testnet` with the team's parent account. Fund contracts that pay storage
(measured: a mint uses 1,457 bytes ≈ 0.0146 NEAR, a 2v2 match 987 bytes ≈ 0.0099 NEAR).
1,000 mints + 10,000 matches ≈ 114 NEAR. Top up `skills` and `registry`
as usage grows.

```sh
cd contracts && ./build.sh
W=target/wasm32-unknown-unknown/release
NET="network-config testnet sign-with-keychain send"

# 1. Accounts
for c in skills market registry deposits seasons ops; do
  near account create-account fund-myself $c.playskirm.testnet '10 NEAR' \
    autogenerate-new-keypair save-to-keychain sign-as playskirm.testnet $NET
done

# 2. Deploy + init
near contract deploy skills.playskirm.testnet use-file $W/skirm_skills.wasm \
  with-init-call new json-args '{"owner_id":"playskirm.testnet","ops_id":"ops.playskirm.testnet"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' $NET
near contract deploy seasons.playskirm.testnet use-file $W/skirm_seasons.wasm \
  with-init-call new json-args '{"owner_id":"playskirm.testnet","ops_id":"ops.playskirm.testnet"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' $NET
near contract deploy market.playskirm.testnet use-file $W/skirm_market.wasm \
  with-init-call new json-args '{"owner_id":"playskirm.testnet","nft_contract_id":"skills.playskirm.testnet","treasury_id":"playskirm.testnet","fee_bps":500,"governance_id":"playskirm.testnet","season_pool_id":"seasons.playskirm.testnet"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' $NET
near contract deploy registry.playskirm.testnet use-file $W/skirm_registry.wasm \
  with-init-call new json-args '{"owner_id":"playskirm.testnet","ops_id":"ops.playskirm.testnet"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' $NET
near contract deploy deposits.playskirm.testnet use-file $W/skirm_deposits.wasm \
  with-init-call new json-args '{"owner_id":"playskirm.testnet","treasury_id":"playskirm.testnet"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' $NET

# 3. Platform signer function-call keys (store the private keys in Secret Manager as NEAR_OPS_KEY)
near account add-key ops.playskirm.testnet grant-function-call-access --allowance '5 NEAR' \
  --contract-account-id skills.playskirm.testnet --function-names 'nft_mint' \
  autogenerate-new-keypair print-to-terminal $NET
near account add-key ops.playskirm.testnet grant-function-call-access --allowance '5 NEAR' \
  --contract-account-id registry.playskirm.testnet --function-names 'record_match' \
  autogenerate-new-keypair print-to-terminal $NET
near account add-key ops.playskirm.testnet grant-function-call-access --allowance '1 NEAR' \
  --contract-account-id seasons.playskirm.testnet \
  --function-names 'open_season, lock_season, post_standings, close_season' \
  autogenerate-new-keypair print-to-terminal $NET

# 4. Optional: make the starter skill's id unmintable
near contract call-function as-transaction skills.playskirm.testnet set_account_bound \
  json-args '{"skill_id":"skl_<FLOOD_WARDEN_ULID>","bound":true}' \
  prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as playskirm.testnet $NET
```

M3 smoke test from the CLI (mint, list, buy, resell, then check balances):

```sh
# Mint (ops)
near contract call-function as-transaction skills.playskirm.testnet nft_mint json-args '{"skill":{
  "id":"skl_01JB7Z3K9QX4M2T8V6N5R1C0DE","version":1,"name":"Flood Warden Plus",
  "summary":"Seals the leak first.","creator":"tyron.testnet","royalty_bps":500,
  "requires_actions":["place_block"],"handles_tags":["spreads","liquid"],
  "prompt_sha256":"<64 hex>","created_at":"2026-11-03T08:15:00Z"}}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as ops.playskirm.testnet $NET

# List at 5 NEAR (seller's wallet; deposit pays the approval's storage, the excess is refunded)
near contract call-function as-transaction skills.playskirm.testnet nft_approve json-args \
  '{"token_id":"skl_01JB7Z3K9QX4M2T8V6N5R1C0DE:1","account_id":"market.playskirm.testnet","msg":"{\"price\":\"5000000000000000000000000\"}"}' \
  prepaid-gas '100 Tgas' attached-deposit '0.01 NEAR' sign-as tyron.testnet $NET

# Buy (buyer's wallet; attach the price, at least 120 Tgas)
near contract call-function as-transaction market.playskirm.testnet buy \
  json-args '{"token_id":"skl_01JB7Z3K9QX4M2T8V6N5R1C0DE:1"}' \
  prepaid-gas '150 Tgas' attached-deposit '5 NEAR' sign-as jev.testnet $NET

# Views
near contract call-function as-read-only market.playskirm.testnet get_listings json-args '{}' network-config testnet now
near contract call-function as-read-only skills.playskirm.testnet nft_payout \
  json-args '{"token_id":"skl_01JB7Z3K9QX4M2T8V6N5R1C0DE:1","balance":"5000000000000000000000000"}' network-config testnet now
```

## Interfaces

All amounts are yoctoNEAR strings (`U128`). "1 yocto" means the call needs exactly 1 yoctoNEAR
attached, so a function-call key cannot make it.

### skills

| Method | Caller | Deposit | Notes |
| --- | --- | --- | --- |
| `new(owner_id, ops_id, metadata?, account_bound_skill_ids?)` | deployer | | Metadata defaults to `nft-1.0.0`, "skirm skills", `SKIRM` |
| `nft_mint(skill)` → `Token` | ops only | none | Mints to `skill.creator`; contract pays storage |
| `nft_transfer`, `nft_transfer_call`, `nft_token` | NEP-171 | 1 yocto | |
| `nft_approve`, `nft_revoke`, `nft_revoke_all`, `nft_is_approved` | NEP-178 | storage / 1 yocto | |
| `nft_total_supply`, `nft_tokens`, `nft_supply_for_owner`, `nft_tokens_for_owner` | NEP-181 | | |
| `nft_metadata` | NEP-177 | | |
| `nft_payout(token_id, balance, max_len_payout?)` → `{payout}` | NEP-199 view | | |
| `nft_transfer_payout(receiver_id, token_id, approval_id?, memo?, balance, max_len_payout?)` | owner or approved | 1 yocto | Payout computed for the owner before the transfer; refunds approval storage to them |
| `skill_info(token_id)`, `skill_token(skill_id, version)`, `is_account_bound(skill_id)`, `get_config()` | view | | |
| `set_ops`, `set_owner`, `set_account_bound(skill_id, bound)` | owner | 1 yocto | |

`skill` is the public part of `skirm.skill/v0` (Spec §9), validated on chain:

* `id`: `skl_` + 26-char ULID.
* `version` ≥ 1.
* `name`: 3–32 letters, digits, spaces, `-` or `'`.
* `summary`: up to 140 characters.
* `creator`: NEAR account.
* `royalty_bps`: 0–1000, default 500.
* `requires_actions`: 0–3 of `place_block`, `dig`, `extinguish`.
* `handles_tags`: 1–10 of the 10 tags.
* `prompt_sha256`: 64 lowercase hex characters.
* `created_at`: ISO 8601 UTC.

Token id is `<skill id>:<version>`. Token metadata:

* `title` = name, `description` = summary, `issued_at` = created_at, `copies` = 1.
* `extra` = JSON
  `{"schema":"skirm.skill/v0","id","version","creator","royalty_bps","prompt_sha256","requires_actions","handles_tags"}`.
  Tag and action lists are stored in spec order.

The creator of a skill id is fixed by its first minted version. The prompt is never on chain.

Payout (Formulas §6): the owner gets `balance − royalty`, with `royalty = floor(balance × royalty_bps / 10^4)`
going to the creator. On the creator's own (primary) sale the royalty is 0.

### market

| Method | Caller | Deposit | Notes |
| --- | --- | --- | --- |
| `new(owner_id, nft_contract_id, treasury_id, fee_bps?, governance_id?, season_pool_id?, season_share_bps?)` | deployer | | `fee_bps` default 500, max 1000. `governance_id` defaults to the owner. No `season_pool_id` sends the whole fee to the treasury. `season_share_bps` default 3000 (30% of the fee), max 10000. |
| `nft_on_approve(token_id, owner_id, approval_id, msg)` | skills contract only | | `msg = {"price":"<yocto>"}`; creates or replaces the listing; market pays listing storage |
| `delist(token_id)` | seller | 1 yocto | |
| `update_price(token_id, price)` | seller | 1 yocto | |
| `buy(token_id)` → `bool` | anyone but the seller | ≥ price | Needs ≥ 120 Tgas (the web sends 150). Excess deposit refunded |
| `rent(rental_id, owner_id, price)` | anyone but `owner_id` | ≥ price | Agent rentals (agents are offchain, nothing is transferred). The platform fee comes out of `price` with the same season/treasury split as a sale, `owner_id` gets the rest, the excess is refunded. `rental_id` is 1–96 bytes (the api's offer id and a nonce). Keeps no state. The web sends 60 Tgas |
| `resolve_purchase(...)`, `on_season_funded(amount)` | private callbacks | | |
| `get_listing`, `get_listings(from_index?, limit?)`, `get_listings_by_seller`, `listing_count`, `is_purchase_pending`, `fee_for(price)`, `get_config` | view | | `get_config` → `{owner_id, governance_id, nft_contract_id, treasury_id, season_pool_id, season_share_bps, fee_bps, max_fee_bps, pending_fee: {bps, effective_at_ms}?, fee_delay_ms}` |
| `propose_fee(bps)` → `{bps, effective_at_ms}` | owner or governance | 1 yocto | `bps` ≤ 1000. Replaces a pending proposal and restarts its delay |
| `apply_fee()` → new bps | owner or governance | 1 yocto | Only once block time ≥ `effective_at_ms` (proposal + 24 h) |
| `set_fee_bps(fee_bps)` | owner | 1 yocto | Immediate, ≤ 1000. Governance cannot use it |
| `set_treasury`, `set_owner` | owner | 1 yocto | |
| `set_governance(governance_id)`, `set_season_pool(season_pool_id?)` | owner or governance | 1 yocto | `set_season_pool(null)` sends the whole fee to the treasury |

The buy flow:

1. The listing is removed and the token is locked as pending.
2. The market calls `skills.nft_transfer_payout(buyer, token_id, approval_id, balance = price, max_len_payout = 10)`.
3. The callback pays from the returned payout:
   * `fee = floor(P × fee_bps / 10^4)` is taken out of the seller's entry and split:
     `season = floor(fee × season_share_bps / 10^4)` goes to `season_pool.fund(null)` (with its
     callback), and `treasury = fee − season` goes to the treasury. With no season pool, or a
     season share that rounds to 0, there is no `fund` call and the treasury gets the whole fee.
   * The other payout entries (the creator royalty) go to their accounts.
   * The seller gets the rest, so fee + royalty + seller = P exactly.
   * The buyer gets back any deposit above P.
4. If the transfer failed (approval revoked, token moved), the buyer is refunded in full and the
   stale listing stays removed.
5. If the transfer succeeded but the payout is unusable (wrong sum, too long, seller share below
   the fee), the seller gets P − fee. The token has already moved, so the sale is never refunded.
6. If `fund` fails (no open season, seasons contract down), its deposit is refunded to the market
   and `on_season_funded` sends the season share to the treasury, with a `season_share_forwarded`
   event. The sale itself has already settled.

Seasons pay out by pull (`claim`), so the market never waits on a prize transfer.

### registry

Ratings are per player.

| Method | Caller | Notes |
| --- | --- | --- |
| `new(owner_id, ops_id)` | deployer | |
| `record_match(match_id, season_id?, map_id, ranked, side_a, side_b, result, decided_by?, head_start_ticks, ticks, log_sha256, elo_changes: [{player, delta}])` → `MatchRecordV2` | ops only | Writes one match (stored shape below). `elo_changes` names both players once for a ranked match with a result, and is empty otherwise |
| `get_match(match_id)`, `get_matches(from_index?, limit?)`, `match_count()` | view | |
| `get_matches_by_season(season_id, from_index?, limit?)`, `season_match_count(season_id)` | view | |
| `get_rating(player)`, `get_ratings(players)` | view | `{rating, matches, wins, losses, draws}`; unrated players read as 1,200 |
| `get_season_standing(season_id, player)` | view | `{points, wins, losses, draws}` |
| `get_config` | view | |
| `set_ops`, `set_owner` | owner, 1 yocto | |

`MatchRecordV2`:

| Field | Type | Notes |
| --- | --- | --- |
| `match_id` | string | |
| `season_id` | u32? | Season the match counts toward |
| `map_id` | string | |
| `ranked` | bool | Unranked matches carry no Elo and no season points |
| `side_a`, `side_b` | `{player, agents: [1–3 unique ids], tiers: [string], delivered: u32}` | `delivered` = talk lines delivered |
| `result` | `"A"` \| `"B"` \| `"draw"` \| `"void"` | |
| `decided_by` | `"goal"` \| `"score"` \| `"fewer_agents"` \| `"earlier"` \| `"draw"` \| null | null only for `void`; `"draw"` only for a draw |
| `head_start_ticks`, `ticks` | u32 | |
| `log_sha256` | 64 lowercase hex | Hash of the match log |
| `elo` | `[{player, before, delta, after}]` | Built from the `elo_changes` arg |
| `recorded_at_ms`, `block_height` | U64 string | |

`record_match` rules:

* `|delta| ≤ 32`, `after = max(100, before + delta)`; winners don't lose and losers don't gain.
* Unranked and `Void` matches carry no Elo.
* Ranked matches update each player's rating and season standing in the same write: win 25
  points, draw 12, loss 5.
* Idempotent: resending the identical record returns the stored one; a different record under the
  same id is rejected.

### seasons

| Method | Caller | Deposit | Notes |
| --- | --- | --- | --- |
| `new(owner_id, ops_id)` | deployer | | |
| `open_season(id, name, starts_at_ms, ends_at_ms)` | owner or ops | | The previous season must be `Paid` or absent; the carry rolls into the new pool |
| `fund(season_id?)` → `U128` | anyone (the market) | the amount | Adds the deposit to the given or current `Open` season. Panics when no season is open |
| `lock_season(id)` | owner or ops | | Once block time ≥ `ends_at_ms` |
| `post_standings(id, standings: [{player, near?, points}])` | owner or ops | | `Locked` seasons only, at most 10 rows, rank = index + 1. Identical retry is a no-op; different data panics |
| `claim(id)` | the standing's `near` account | | Once per standing; transfers the share |
| `close_season(id)` | owner or ops | | `Locked` with standings: unclaimed shares go to the carry, status becomes `Paid` |
| `get_season`, `current_season`, `get_config`, `get_carry` | view | | |
| `set_ops`, `set_owner` | owner | 1 yocto | |

Shares: places 1–10 get 3000, 2000, 1500, then 500 bps each of the pool, rounded down. Shares for
missing places, for rows without a NEAR account, and the rounding dust go to the carry, which funds
the next season.

Every ops write is safe to retry: `open_season` with the same id and args, `lock_season` on a
season already locked or paid, and `close_season` on a paid season return the season unchanged with
no event.

### deposits

| Method | Caller | Deposit | Notes |
| --- | --- | --- | --- |
| `new(owner_id, treasury_id, min_deposit?)` | deployer | | `min_deposit` default 0.01 NEAR |
| `deposit()` → receipt number | player wallet | ≥ min | Logs the event below |
| `withdraw(amount?)` | owner | 1 yocto | Sends to the treasury; keeps storage cost + 0.1 NEAR on the contract |
| `get_deposit(receipt)`, `total_deposited_by(account_id)`, `withdrawable()`, `get_config()` | view | | |
| `set_treasury`, `set_min_deposit`, `set_owner` | owner | 1 yocto | |

## Events (NEP-297, `EVENT_JSON:` logs)

| Standard | Events and data |
| --- | --- |
| `nep171` | `nft_mint`, `nft_transfer` (emitted by skills) |
| `skirm_market` | `list` (listing), `delist`, `update_price`, `sale` `{token_id, seller, buyer, price, fee, fee_bps, season_share, treasury_share, royalties{account: amount}, seller_proceeds, refund, payout_fallback}`, `purchase_failed` `{token_id, seller, buyer, refund}`, `rental` `{rental_id, owner, renter, price, fee, fee_bps, season_share, treasury_share, owner_proceeds, refund}`, `season_share_forwarded` `{amount, treasury_id, season_pool_id}`, `fee_proposed` `{old_bps, new_bps, effective_at_ms, by}`, `fee_updated` `{old_bps, new_bps, by}`, `treasury_updated` / `owner_updated` / `governance_updated` / `season_pool_updated` `{old, new, by}` |
| `skirm_registry` | `match_recorded` (MatchRecordV2) |
| `skirm_seasons` | `season_opened`, `season_funded`, `season_locked`, `standings_posted`, `prize_claimed`, `season_closed`, `carry_rolled`, `ops_updated`, `owner_updated` |
| `skirm_deposits` | `deposit` `{receipt, player, amount, block_height, timestamp_ms}`, `withdraw` `{treasury, amount}` |

A deposit event looks like
`EVENT_JSON:{"standard":"skirm_deposits","version":"1.0.0","event":"deposit","data":[{"player":"tyron.testnet","amount":"2000000000000000000000000","receipt":"1","block_height":"…","timestamp_ms":"…"}]}`.
The backend credits each `receipt` once (1,000 credits per NEAR on testnet). It can re-check
the deposit with `get_deposit(receipt)`.
