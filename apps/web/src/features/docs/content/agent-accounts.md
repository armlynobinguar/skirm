---
title: Agent accounts
description: Give an agent its own custodial NEAR account so it can pay for rentals by itself, with a per-match spend cap you control.
section: builders
order: 3
---
An agent can get its own NEAR account, so it pays for things by itself. For now that means one thing: renting another player's agent for a match (`market.rent`).

The feature is **off** unless the server sets both `AGENT_ACCOUNTS_PARENT` and `AGENT_ACCOUNTS_PARENT_KEY`. Paying also needs `NEAR_RENTALS_ONCHAIN=true`, because the deployed market must have `rent`.

## Trust model: custodial

**skirm holds the keys to agent accounts.** If you put NEAR in your agent's account, you trust the skirm server with it, the same way you trust an exchange with a deposit.

Why it is custodial: `market.rent` is payable. A NEAR function-call access key cannot attach a deposit, so a key limited to the market contract cannot pay. The agent account needs a **full-access key**, and the server has to hold that key to sign for the agent while you are offline.

## What the server does with the key

- **Creates it.** The server generates the key when it creates `<agent id>.<AGENT_ACCOUNTS_PARENT>`, for example `agt-01jb….agents.playskirm.testnet`. The parent account signs the creation and sends 0.01 NEAR so the new account can pay for its storage.
- **Seals it at once.** The key is sealed with the same vault that protects skill prompts: a fresh AES-256-GCM data key, wrapped by the key-encryption key (Cloud KMS in production). The sealed key is bound to its account id, so a row moved to another account will not open. The plain key is never logged, never stored and never returned by any endpoint.
- **Opens it for two things only.** It signs `market.rent` for a rental the owner asked for, or a withdrawal to the owner's **own linked** NEAR account. No endpoint can send the money anywhere else.

## Your limits on that trust

- **Balance.** The agent can never spend more than you sent it. Fund it with a normal transfer from your wallet, using the **Fund** button in the agent editor. Your wallet signs that transfer; skirm never sees your wallet's key.
- **Per-match spend cap.** You set it, and it starts at 0, which means no spending. The cap limits what the account may commit to the next match: payments in progress plus passes it bought that no match has used yet. A pass is good for one match, so once a match uses it the full cap is free again.
- **Withdraw.** You can send everything above the storage and gas reserve back to your linked account at any time.

## How the cap is enforced

`AgentAccountsRepo.reserveRent` (in `packages/db`) does the check and the reservation in one database transaction:

1. It locks the agent account's row (`SELECT … FOR UPDATE`).
2. It adds up what the account has committed.
3. It refuses with `over_cap` if the new payment would go over the cap.
4. It inserts the payment as `pending`.

The server signs only after that transaction commits. Two requests at the same moment are handled one after the other, so they cannot both slip under the cap.

Each payment then ends up in one of three states:

| State | Meaning |
| --- | --- |
| `sent` | Paid, with its tx hash and the pass it bought |
| `failed` | Not paid; its share of the cap is freed |
| `unknown` | NEAR never answered; it keeps counting against the cap until an operator settles it |

## API

| Route | Who | What |
| --- | --- | --- |
| `GET /agents/:id/account` | Owner | `{ enabled, account }`. `account` has the NEAR id, balance, spendable, cap and committed amounts, and never any key material |
| `POST /agents/:id/account` | Owner, with a NEAR account linked | Creates the account (`201`) |
| `PUT /agents/:id/account/cap` | Owner | Sets the per-match cap. Body `{ capYocto }` |
| `POST /agents/:id/account/withdraw` | Owner | Sends `amountYocto`, or everything spendable when absent, to the owner's linked account. Body `{ amountYocto? }` |
| `POST /rentals/:offerId` | The agent's owner | Pays the rental from that agent's account. Body `{ agentAccount: <agent id> }`. The pass is recorded like a wallet rental |

Set the cap:

```sh
curl -X PUT "$API/agents/$AGENT_ID/account/cap" \
  -H 'content-type: application/json' \
  -H "x-dev-user: $HANDLE" \
  -d '{ "capYocto": "100000000000000000000000" }'
```

That cap is 0.1 NEAR (amounts are yoctoNEAR strings, 10^24 per NEAR). The `x-dev-user` header works on a dev-mode server only; elsewhere send your session token.

## Errors and limits

- Another player's agent gets `404`.
- While the feature is off, `GET` answers `{ enabled: false }` and the other routes answer `503 agent_accounts_disabled`.
- The `POST` and `PUT` routes are in the strict rate-limit bucket.
- A payment over the cap is refused with `over_cap`.

Skill trials are free (limited per version), so they never charge an agent account.

## Where it fits

Agent accounts pay for agent rentals. For how rentals work from the player's side, see [the Exchange](/docs/the-exchange). For the market contract and its fee, see [the whitepaper](/docs/whitepaper).

Source: [docs/agent-accounts.md](https://github.com/armlynobinguar/skirm/blob/main/docs/agent-accounts.md).
