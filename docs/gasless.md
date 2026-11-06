# Gasless onboarding (NEP-366 meta-transactions)

**Off by default.** It does nothing until a funded relayer account is configured
(`RELAYER_ACCOUNT_ID` and `RELAYER_PRIVATE_KEY`). Without them `GET /relay` answers
`enabled: false`, `POST /relay` answers `404 relay_disabled`, and the web signs and sends every
transaction with the player's wallet as before.

## What it does

A new player's first few transactions to skirm's own contracts (`RELAYER_FREE_TXS`, default 3)
cost them no gas:

1. The web checks two things: the connected wallet can sign delegate actions (NEAR Connect's
   `signDelegateActions`, listed in the wallet's manifest), and `GET /relay` says free
   transactions are left.
2. The wallet signs a NEP-366 `DelegateAction` (a `SignedDelegate`) for the same call it would
   otherwise send: `deposits.deposit`, `market.buy`, `market.rent` or `skills.nft_approve` to the
   market.
3. The web posts it to `POST /relay`. The api checks it (below) and the relayer account wraps it
   in a transaction of its own, which pays the gas.
4. The web posts the returned hash to the usual confirm route (`/credits/deposits`, `/rentals/:id`,
   `/market/...`). The deposit and rental verifiers accept a meta-transaction from the configured
   relayer as the player's own. A "Gas paid by skirm" note confirms it.

Only gas is paid by the relayer. An attached deposit (a top-up, a skill's price, a rental's price,
the 0.01 NEAR approval storage) still comes from the player's account inside the delegate.

## What the api checks (`apps/api/src/relay.ts`)

- The `SignedDelegate` decodes strictly: function calls only, ed25519 key and signature, no
  trailing bytes, at most 8 KB of base64.
- The sender is the caller's linked NEAR account.
- The receiver is the deposits, market or skills contract, and every method is allowlisted for it
  (`deposit`; `buy`, `rent`; `nft_approve` only with the market as the approved account).
- At most 2 actions, at most 150 Tgas each and 300 Tgas in all.
- The signature is valid over the NEP-461-prefixed delegate action.
- `max_block_height` is above the final block height and at most 1000 blocks past it.
- The signing key is one of the sender's access keys and the nonce is above its current nonce.
- The player has free relayed transactions left. The quota is kept in `relayed_txs` and counts the
  skirm account and the NEAR account, so relinking does not reset it. One delegate is relayed once.
  A relay that never reached the chain gives its slot back. One that reached the chain and failed
  keeps it, because it cost the relayer gas.

`POST /relay` is in the strict rate-limit bucket.

## Turning it on

1. Create a relayer account (for example `relayer.playskirm.testnet`) with a full-access key, and
   fund it with enough NEAR for the gas you plan to pay (at testnet gas prices a relayed call
   costs roughly 0.01 to 0.02 NEAR; 150 Tgas is the cap per call). This is not automated, and none of the code here creates accounts or sends real
   transactions.
2. Put the key in Secret Manager and set `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY` (and
   optionally `RELAYER_FREE_TXS`) on the api. The key is only used inside near-api-js and is never
   logged or returned. Config errors name the variable, never its value.
3. The api logs `gasless on` at startup.

To turn it off, unset both variables. Hashes the relayer already sent stay verifiable only while
`RELAYER_ACCOUNT_ID` is set, so confirm in-flight deposits first.

## Code

- `packages/server/src/near/delegate.ts`: SignedDelegate decoder and signature check.
- `packages/server/src/near/relayer.ts`: the `MetaTxRelayer` interface and `NearMetaTxRelayer`.
  Tests use a fake.
- `packages/server/src/near/rpc.ts`: `effectiveCall` / `callSucceeded` / `txStatusOf` read
  relayed transactions.
- `apps/api/src/controllers/relay.controller.ts`, `apps/api/src/relay.ts`: the routes and the rules.
- `packages/db/src/repos/relay.ts`, migration `0022_gasless_relay`: the quota.
- `apps/web/src/lib/wallet/gasless.ts`: the web's choice between the relay and a normal
  transaction.
