# Agent accounts

An agent can get its own NEAR account so it pays for things by itself. For now that means one thing:
renting another player's agent for a match (`market.rent`). The feature is **off** unless the
server has `AGENT_ACCOUNTS_PARENT` and `AGENT_ACCOUNTS_PARENT_KEY` set. Paying also needs
`NEAR_RENTALS_ONCHAIN=true`, because the deployed market must have `rent`.

## Trust model: custodial

**skirm holds the keys to agent accounts.** If you put NEAR in your agent's account, you are trusting
the skirm server with it, the same way you trust an exchange with a deposit.

Why it is custodial: `market.rent` is payable. A NEAR function-call access key cannot attach a
deposit, so a key limited to the market contract cannot pay. The agent account needs a
**full-access key**, and the server has to hold that key to sign for the agent while you are offline.

What the server does with the key:

- It generates the key when it creates `<agent id>.<AGENT_ACCOUNTS_PARENT>`
  (e.g. `agt-01jb….agents.playskirm.testnet`). The parent account signs the creation and sends
  0.01 NEAR so the new account can pay for its storage.
- It seals the key straight away with the vault that protects skill prompts: a fresh AES-256-GCM
  data key, wrapped by the KEK (Cloud KMS in production). The sealed key is bound to its account
  id, so a row moved to another account will not open. The plain key is never logged, never stored
  and never returned by any endpoint.
- It opens the key only to sign one of two things: `market.rent` for a rental the owner asked for,
  or a withdrawal to the owner's **own linked** NEAR account. No endpoint can send the money
  anywhere else.

Your limits on that trust:

- **Balance.** The agent can never spend more than you have sent it. Fund it with a normal transfer
  from your wallet (the agent editor's Fund button). Your wallet signs that transfer; skirm never
  sees your wallet's key.
- **Per-match spend cap.** You set it, and it starts at 0 (no spending). The cap limits what the
  account may commit to the next match: payments in progress plus passes it bought that no match
  has used yet. A pass is good for one match, so once a match uses it the full cap is available
  again.
- **Withdraw.** You can send everything above the storage and gas reserve back to your linked
  account at any time.

## How the cap is enforced

`AgentAccountsRepo.reserveRent` (packages/db) does the check and the reservation in a single
database transaction. It locks the agent account's row (`SELECT … FOR UPDATE`), adds up what the
account has committed, refuses with `over_cap` if the new payment would go over the cap, and inserts
the payment as `pending`. The server signs only after that transaction commits. Two requests at the
same moment are handled one after the other, so they cannot both get under the cap. Each payment
then ends up `sent` (with its tx hash and the pass it bought), `failed` (which frees its share of
the cap), or `unknown` if NEAR never answered. An `unknown` payment keeps counting against the cap
until an operator settles it.

## API

| Route | Who | What |
|---|---|---|
| `GET /agents/:id/account` | owner | `{ enabled, account }`; `account` has the NEAR id, balance, spendable, cap and committed amounts, and never any key material |
| `POST /agents/:id/account` | owner, NEAR account linked | creates the account (201) |
| `PUT /agents/:id/account/cap` `{ capYocto }` | owner | sets the per-match cap |
| `POST /agents/:id/account/withdraw` `{ amountYocto? }` | owner | sends that much, or everything spendable, to the owner's linked account |
| `POST /rentals/:offerId` `{ agentAccount: <agent id> }` | the agent's owner | pays the rental from that agent's account; the pass is recorded like a wallet rental |

Another player's agent gets a 404. While the feature is off, GET answers `{ enabled: false }` and
the other routes answer 503 `agent_accounts_disabled`. The POST and PUT routes are in the strict
rate-limit bucket. Skill trials are free (limited per version), so they never charge an agent
account.
