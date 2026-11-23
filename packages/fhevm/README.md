# @skirm/fhevm

skirm's confidential contracts on the [Zama Protocol](https://docs.zama.org/protocol) (FHEVM), deployed on Sepolia.
The layout mirrors [zama-ai/fhevm-hardhat-template](https://github.com/zama-ai/fhevm-hardhat-template):
Hardhat 2 + `@fhevm/hardhat-plugin` (an in-process FHEVM mock for tests), `@fhevm/solidity` and
OpenZeppelin's [confidential contracts](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts) for ERC-7984.

| Contract | What it is |
| --- | --- |
| `ConfidentialSkirmCredits` (cSKIRM) | ERC-7984 confidential token for stakes and rewards. Balances and transfer amounts are FHE ciphertexts. Owner + approved minters (game contracts) can mint; a public faucet gives testers a fixed amount once per cooldown. |
| `SkirmMatch` | Sealed PvP loadouts: each player commits its crew, skills and talk tiers as encrypted inputs; nobody can read them until both have locked, then both are revealed together with a KMS-verified public decryption. Lock deadline + forfeit. FHE randomness (seed, supply drops). Confidential cSKIRM stake escrow, settled by the game server with the match log hash anchored on chain. |

## Setup

From the repo root, `npm install` installs this workspace with the others. Node 20+.

```bash
cp packages/fhevm/.env.example packages/fhevm/.env   # only needed to deploy
```

| Variable | Used for |
| --- | --- |
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC (default: publicnode) |
| `DEPLOYER_PRIVATE_KEY` | Deployer account (needs Sepolia ETH). Never commit it. |
| `ETHERSCAN_API_KEY` | Optional, for `hardhat verify` |
| `CREDITS_OWNER` | Optional token owner (default: deployer) |
| `FAUCET_AMOUNT` / `FAUCET_COOLDOWN_SECONDS` | Optional faucet settings (default 1,000 cSKIRM per 24 h; 6 decimals) |

## Test

```bash
npm test -w @skirm/fhevm          # hardhat test, FHEVM mock on the hardhat network
npm run typecheck -w @skirm/fhevm # compile (generates typechain types/) + tsc
```

The tests encrypt inputs with `fhevm.createEncryptedInput`, decrypt balances with
`fhevm.userDecryptEuint` and cover the ACL (a third party cannot decrypt someone else's balance),
faucet cooldowns, minter roles and confidential transfers (including the silent zero transfer on
insufficient balance, which is how ERC-7984 avoids leaking balances through reverts).

## SkirmMatch: sealed loadouts

In skirm both players lock in a crew of AI agents (which agents, which of their skills play, how
much they talk) without seeing the rival's. Off chain that rests on trusting the server. On a
transparent chain a commit is readable the moment it lands, so the second player could counter the
first. With FHEVM the picks are ciphertexts until both are locked, and the reveal is verifiable.

**Lifecycle** (`Status`): `None → Open → Locked → Revealing → Revealed → Settled`, or `Open → Forfeited | Cancelled`
at the lock deadline, or `Locked | Revealing | Revealed → Cancelled` when nobody settles in time.

| Call | Who | What |
| --- | --- | --- |
| `createMatch(id, playerA, playerB, lockWindow, minStake)` | a player (or anyone, with both seats open) | `id = keccak256(utf8(offchainMatchId))`. A seat left as `address(0)` goes to the first account that seals it (never both seats to one account). `lockWindow` 1 min to 1 day. `minStake`: public minimum cSKIRM stake per side (0: unstaked). |
| `submitLoadout(id, side, agents[3], skills[3], tiers[3], stake, proof)` | that side's player | Nine `externalEuint8` and one `externalEuint64` stake under one input proof. ACL: only the contract and the submitting player. One submission per side, before the deadline. A staked match pulls the stake into escrow (see below). |
| `reveal(id)` | anyone, once both locked | `FHE.makePubliclyDecryptable` on the 18 loadout handles, the match seed and both "stake ok" flags; emits `RevealRequested(id, handles)`. |
| `finalizeReveal(id, abiEncodedClearValues, decryptionProof)` | anyone | Fetch both from the relayer (`publicDecrypt(revealHandles(id))`); `FHE.checkSignatures` verifies the KMS proof, then the plaintexts are stored (`revealedLoadout`, `randomness`) and emitted (`LoadoutRevealed`, `SeedRevealed`). |
| `revealDrop(id, slot)` | anyone, once the drop is due | Opens supply drop `slot` for public decryption, in slot order, no earlier than `dropDueAt(id, slot)`; emits `DropRevealRequested`. |
| `finalizeDrop(id, slot, abiEncodedClearValue, decryptionProof)` | anyone | Checks the KMS proof for that one handle, stores the value (`randomness`) and emits `DropRevealed`. |
| `forfeit(id)` | anyone, after the deadline while `Open` | One side locked: it wins (`MatchForfeited`, `winner`) and gets its stake back. Neither: `MatchCancelled`. |
| `settle(id, winnerSeat, logHash)` | the `operator` (game server), once, while `Revealed` | Anchors the log head hash, records the result (0, 1 or `NO_SIDE` = draw) and pays the escrow out (`MatchSettled`, `StakePaid`). |
| `refundUnsettled(id)` | anyone, `SETTLE_TIMEOUT` (1 day) after the lock deadline | A locked match nobody settled is cancelled and both stakes go back. |

Public decryption uses the current FHEVM flow (`makePubliclyDecryptable` + off-chain relayer
decryption + on-chain `checkSignatures`), not the old oracle callback.

**Encoding** (`packages/shared/src/sealed-loadout.ts`, shared by the web and the game server), per slot:

- `agents[i]`: 0 = empty, n = the n-th agent (1-based) of the player's roster sorted by agent id;
- `skills[i]`: bitmask over that agent's equipped skills (bit j = j-th equipped skill plays);
- `tiers[i]`: 0 quiet, 1 standard, 2 open.

The contract cannot range-check an encrypted value without leaking it, so the game server
validates the revealed plaintexts (`decodeLoadout`) and refuses anything that does not fit.

**Game flow.** On the PvP lock-in (`NEXT_PUBLIC_ZAMA_ENABLED=1`) the player presses "Seal loadout
on Sepolia": the web sends `v2_seal` (the server stretches the lock-in to `sealedLockMs`, 4 min, and
tells the rival someone is sealing), creates the match if needed, encrypts and submits, waits for the
rival, then team A reveals and finalizes (team B steps in if it does not land). The web then sends
`v2_lock_in { sealed: true }`; realtime (`ZAMA_ENABLED=1`, `SEPOLIA_RPC_URL`, optional
`ZAMA_MATCH_ADDRESS`) reads `revealedLoadout` through `@skirm/server` `EthersSealedMatchReader`,
checks the seat is the address the player declared, and plays exactly that crew. Reading needs no
key; settling the result (below) uses the operator key.

**Hook points**: `_onCreated`, `_onSealed`, `_onBothLocked` (the randomness below is already drawn
when it runs), `_onRevealed` and `_onForfeited`. The stake escrow below is implemented in them.

**Known limits.** Match ids are predictable, so an attacker who knows one could open it first with
fixed seats only if they are one of those seats; with open seats, the off-chain address check makes a
squatted seat fail the sealed lock (the player then locks in normally). Off chain, a side that never
locks plays its queued crew as before; the on-chain forfeit settles the commitment only.

## SkirmMatch: on-chain randomness (match seed and supply drops)

**Fairness goal.** Neither player nor the game server can pick or grind a match's seed, nobody can
know where a supply drop lands before it appears, and afterwards anyone can check every value.

**Draw.** The transaction that seals the second loadout also draws the randomness
(`_drawRandomness`, before `_onBothLocked`):

- the match seed, `FHE.randEuint64()`;
- one value per supply drop slot, `FHE.randEuint16()` × `DROP_SLOTS` (3; maps have at most 3 drops).

Both commitments are already in, so no player can choose a loadout against the seed, and the
coprocessor's randomness cannot be re-rolled by retrying a transaction someone controls. Only the
contract holds ACL access: the players, the game server and the deployer cannot decrypt any of it
(tested: user decryption and public decryption both fail until the reveal). `RandomnessDrawn` logs
the handles.

**Seed reveal.** The seed is the 19th handle of `revealHandles` and opens with the loadouts:
`reveal` makes it publicly decryptable and `finalizeReveal` checks it under the same KMS proof, then
stores it with the start time (`randomness(id).seed`, `startedAt`; `SeedRevealed`). Public decryption
was chosen over granting the server operator ACL: everyone learns the seed at the same moment the
match starts, the server needs no key or ACL of its own, and the value is verifiable by anyone.

**Drop reveals.** Each drop value opens on its own, in slot order, and never early:
`revealDrop(id, slot)` reverts with `DropNotDue` before `startedAt + (slot + 1) × DROP_INTERVAL`
(60 s) and with `DropOutOfOrder` until the previous slot is finalized; `finalizeDrop` checks the KMS
proof for that handle. The official maps land drops 70–140 s into a match, so a value is public at most
a few seconds before its drop lands. Anyone can send both transactions (the players' tabs do, team A
first and team B as fallback); a forged value reverts.

**Game server.** Realtime (`ZAMA_ENABLED`) reads `randomness` with the sealed loadouts and starts the
match on the seed (`createMatch` `seed` + `sealedDrops`, packages/engine v2 `drops.ts`). A sealed drop
cannot land until it is placed: a few ticks before each drop's tick the server reads the chain, and
once the value is stored it places the drop on `sealedDropTile(map, value)` = the map's candidate
tiles (open floor on the centre column, equally far from both crews, top to bottom) at index
`value mod count`. A late reveal delays the drop to the first tick after it is read; if nothing is
revealed within 20 ticks the seed stands in (`seedDropValue`, flagged `fromSeed` in the log), so a
match never stalls. Frames carry `sealedDrops`, so the web hides the map's drop markers.

**Verification.** The match log header commits to the seed (`seed`, `sealedDrops`) and each tick to
the drops placed on it (`drops: [{ slot, value, at }]`), so the log hash anchors them. To check a
match: read `randomness(keccak256(matchId))` (or the `SeedRevealed` / `DropRevealed` events), compare
the seed and each value with the log, recompute `sealedDropTile` for each value, and replay. Each
stored value came through `FHE.checkSignatures`, and anyone can re-run `publicDecrypt` on the handles
for the same plaintexts. The debrief shows every draw with its Etherscan transaction and can publish
the draws the map did not use, so all of a match's randomness ends up public.

## SkirmMatch: confidential cSKIRM stakes and payouts

**Confidentiality goal.** A player can put cSKIRM on a sealed match without the rival, spectators or
the game server learning how much: the stake, the escrow and every payout stay ciphertexts that
only their owner can decrypt. On a transparent chain a stake is a public transfer, so the rival
sees how confident (or how rich) you are before the match starts; here they see a handle.

**Why in SkirmMatch, not a separate contract.** The stake rides the seal: one input proof covers
the loadout and the stake, one operator approval (to SkirmMatch) lets it pull the stake, and the
"stake ok" flags join the loadout reveal batch, so one `publicDecrypt` and one `checkSignatures`
open everything. A separate `SkirmStakes` would need a second approval or ACL hand-offs
(`allowTransient` across contracts) for every amount, and a second reveal round for the flags.

**Stake on seal.** The player first calls `cSKIRM.setOperator(SkirmMatch, until)` (ERC-7984 has no
allowance; the web asks once and sets 30 days). `submitLoadout` then runs
`confidentialTransferFrom(player, SkirmMatch, stake)`. ERC-7984 does not revert on a short balance:
it moves 0. So the escrow stores the amount actually transferred (the returned handle) and derives
`stakeOk = transferred >= minStake` as an `ebool`. Nothing about the amount is public; the seal
succeeds either way, so even "this player was short" stays hidden until the reveal.

**Matched pot.** Once both are sealed, `matched = FHE.min(FHE.select(ok0, staked0, 0), FHE.select(ok1, staked1, 0))`:
each side risks the smaller valid stake, and a side whose stake is not ok does not count as locked in
the escrow (the pot is 0). At `reveal` the two flags open with the loadouts (handles 20 and 21 of
`revealHandles`); `finalizeReveal` checks and stores them (`StakeChecked`, `escrow(id).stakeOkClear`).
That is the only thing anyone learns about a stake: yes or no.

**Settlement.** The game server (`operator`, set at deploy, changeable by the owner) posts
`settle(id, winnerSeat, logHash)` after the match. It stores the head of the match's hash-chained
log (`settlement(id)`: the on-chain anchor the verifier checks) and pays out by confidential transfer:

| Result | Winner | Loser / other side | Treasury |
| --- | --- | --- | --- |
| Win | its stake + `matched` − fee | its stake − `matched` (the unmatched excess) | fee = `feeBps` of `2 × matched` |
| Draw (`NO_SIDE`) | its stake back | its stake back | — |
| A stake not ok | `matched` is 0: both stakes back | | — |
| Lock forfeit (one side sealed) | the locked side takes the pot: its own stake | — | — |
| Cancelled (`refundUnsettled`) | both stakes back | | — |

The fee is computed as `(pot / 10000) × bps + (pot % 10000) × bps / 10000` so it cannot overflow 64
bits; `feeBps` is fixed per match at creation (max `MAX_FEE_BPS` = 10%). Each payout handle
(`escrow(id).paid`) only decrypts for its recipient (and the contract); `matched` only for the
contract. `settle` reverts for anyone but the operator (`NotOperator`) and on a second call
(`WrongStatus(Settled)`). Draws, forfeits and cancels also go through `_pay`, so every amount that
leaves the escrow is a confidential transfer.

**Game flow.** On the lock-in the web shows "Stake (🔒 encrypted)" (default and minimum
`NEXT_PUBLIC_ZAMA_MIN_STAKE`, 10 cSKIRM; 0 makes sealed matches unstaked), approves SkirmMatch as
operator once, and encrypts the stake with the loadout. Realtime (`ZAMA_ENABLED`, plus
`ZAMA_OPERATOR_PRIVATE_KEY` for the operator account) settles each sealed match when it ends, in the
background (a void or unstored result settles as a draw). Without the key it logs a warning and
does not settle; players can still `refundUnsettled` after the timeout. The debrief shows the public
flags, a "Settled on Sepolia" link, and "Payout: 🔒 Reveal", which user-decrypts the player's own
stake and payout.

**Known limits.** A player who stakes 0 still gets the rival's loadout revealed (the flags open with
the loadouts), but risks nothing and can win nothing; the game itself is played and recorded
normally. The operator is trusted to post the true winner; the anchored log hash makes a false
result detectable (PR 5 verifies it), not impossible.

## Deploy to Sepolia

```bash
npm run deploy:sepolia -w @skirm/fhevm
```

This deploys `ConfidentialSkirmCredits` and `SkirmMatch` (or only the ones in `DEPLOY_CONTRACTS`,
e.g. `DEPLOY_CONTRACTS=SkirmMatch` next to an already deployed token), records them in
`deployments/sepolia.json` (address, tx, block, constructor args; merged with what is already
there) and regenerates `generated/index.ts`. Commit both files so the web and realtime pick up the
addresses.

SkirmMatch's constructor is `(credits, operator, treasury, feeBps)`: `CREDITS_ADDRESS` (default: the
cSKIRM deployed in the same run or recorded in `deployments/sepolia.json`), `MATCH_OPERATOR` (default
the deployer; give the game server that account's key as `ZAMA_OPERATOR_PRIVATE_KEY`), `TREASURY`
(default none) and `FEE_BPS` (default 0). The stake escrow changes SkirmMatch's ABI, so a SkirmMatch
deployed before it must be redeployed (`DEPLOY_CONTRACTS=SkirmMatch` keeps the token). To verify:

```bash
npx hardhat verify --network sepolia <creditsAddress> <owner> <faucetAmount> <faucetCooldown>
npx hardhat verify --network sepolia <matchAddress> <creditsAddress> <operator> <treasury> <feeBps>
```

## Address + ABI export

`generated/index.ts` is what the web imports (`@skirm/fhevm/generated`):

```ts
import { sepolia, ConfidentialSkirmCreditsAbi } from '@skirm/fhevm/generated';
sepolia.contracts.ConfidentialSkirmCredits; // `0x…` or null before the first deploy
```

Regenerate it after changing a contract or editing a deployments file:

```bash
npm run export -w @skirm/fhevm
```

The web reads the addresses from there, unless `NEXT_PUBLIC_ZAMA_CREDITS_ADDRESS` /
`NEXT_PUBLIC_ZAMA_MATCH_ADDRESS` override them (realtime: `ZAMA_MATCH_ADDRESS`), and
shows the cSKIRM card on /account/credits only when `NEXT_PUBLIC_ZAMA_ENABLED=1`
(client code: `apps/web/src/lib/zama`, UI: `apps/web/src/features/zama`).
