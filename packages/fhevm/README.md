# @skirm/fhevm

skirm's confidential contracts on the [Zama Protocol](https://docs.zama.org/protocol) (FHEVM), deployed on Sepolia.
The layout mirrors [zama-ai/fhevm-hardhat-template](https://github.com/zama-ai/fhevm-hardhat-template):
Hardhat 2 + `@fhevm/hardhat-plugin` (an in-process FHEVM mock for tests), `@fhevm/solidity` and
OpenZeppelin's [confidential contracts](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts) for ERC-7984.

| Contract | What it is |
| --- | --- |
| `ConfidentialSkirmCredits` (cSKIRM) | ERC-7984 confidential token for stakes and rewards. Balances and transfer amounts are FHE ciphertexts. Owner + approved minters (game contracts) can mint; a public faucet gives testers a fixed amount once per cooldown. |
| `SkirmMatch` | Sealed PvP loadouts: each player commits its crew, skills and talk tiers as encrypted inputs; nobody can read them until both have locked, then both are revealed together with a KMS-verified public decryption. Lock deadline + forfeit. FHE randomness (seed, supply drops). Confidential cSKIRM stake escrow, settled by the game server with the match log hash anchored on chain. |
| `FogSkirm` | Fog Skirm, a short two-player mode played fully on chain: scouts, traps, moves and a hidden seed vial stay ciphertexts; each round is resolved under FHE and only aggregate outcomes go public. See below. |
| `SkillAuction` | Sealed-bid (second-price) auctions of skill versions on the Exchange, paid in cSKIRM: bids are escrowed ciphertexts, the top two are tracked under FHE, only the winner and the clearing price are ever decrypted, and losing bids are refunded confidentially. See below. |

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
result detectable (see "Verify a sealed round" below), not impossible.

## Verify a sealed round (anyone, in the browser)

`/verify?id=<matchId>` (apps/web `src/features/verify`, behind `NEXT_PUBLIC_ZAMA_ENABLED`) checks a
sealed round against SkirmMatch with no wallet: a read-only ethers `JsonRpcProvider` on
`NEXT_PUBLIC_SEPOLIA_RPC_URL` (default publicnode). The debrief of a sealed match links to it
("Verify this round"). The comparison is pure and unit-tested (`sealed.ts`), and the chain read is
separate (`sealedChain.ts`):

| Check | Compares |
| --- | --- |
| Commitments came first | both `LoadoutSealed` events come before `RandomnessDrawn` (block, log index) |
| Seed is genuine | `SeedRevealed` (only emitted after `FHE.checkSignatures` in `finalizeReveal`) and `randomness().seed` equal the log header `seed` |
| Drops are genuine | each logged drop `value` equals `randomness().drops[slot]` (or `seedDropValue(seed, slot)` when `fromSeed`), and its tile equals `sealedDropTile(map, value)` |
| Loadouts played as sealed | `revealedLoadout` per side against the header crews: crew size, talk tiers (casual), distinct roster indices whose order agrees with the agent ids; with a roster, a full `decodeLoadout` |
| Result anchored | `settlement().logHash` equals the recomputed hash-chain head; `winner` equals the log result's seat (draw `NO_SIDE`) |
| Replay | the logged actions and drops replayed through `@skirm/engine` reach the logged result |
| Never revealed 🔒 | stake and payout handles (`escrow()`, `StakePaid`) stay encrypted; only the public "stake ok" flags are shown |

Every event takes `matchId` as its first indexed argument, so one `eth_getLogs` filter (address and
topic1) returns a match's events. The page walks back from the latest block in 10k-block windows
until it finds `MatchCreated`, and stops at the deploy block: `deployBlocks` in
`generated/index.ts` (from `deployments/sepolia.json`) or `NEXT_PUBLIC_ZAMA_MATCH_FROM_BLOCK`.
Without either, it goes about 6 weeks back. The roster that maps indices to agent ids is private,
so a live check covers what the revealed plaintexts alone prove. `?id=fixture-sealed-round` (and
`~wrong-seed`, `~wrong-drop`, `~wrong-crew`, `~wrong-log-hash`, `~edited-log`) shows the checks on a
labelled fixture: a real engine match with the SkirmMatch record it would leave behind.

## FogSkirm: Fog Skirm, a fully on-chain hidden-information mode

A small game that only works with FHE. Two scouts on a 5×5 marsh; a seed vial is hidden somewhere
in the middle row. Find it, carry it back to your home row, and avoid the two flood switches your
rival planted on your side of the board where you cannot see them. Ten rounds, simultaneous moves,
every move a transaction. Play it at `/fog` (apps/web `src/features/zama/fog`, behind
`NEXT_PUBLIC_ZAMA_ENABLED`, linked from the PvP hub).

**How to play.**

1. *Create* (`createGame(opponent, moveWindow, trap0, trap1, proof)`): plant your two flood switches
   (encrypted tile indices, one input proof), pick the move clock and optionally invite one address
   (else the seat is open). Share the game id.
2. *Join* (`joinGame(id, trap0, trap1, proof)`): the rival plants theirs. This transaction draws the
   vial (`FHE.randEuint8() mod 5` on row 2) after both trap sets are committed, places both scouts on
   their home rows and starts round 1.
3. *Each round* both players `submitMove(id, direction, proof)`: an encrypted 0 stay, 1 north,
   2 east, 3 south, 4 west. In the UI you click a glowing tile next to your scout. The second move
   resolves the round under FHE in the same transaction.
4. *Publish the outcome*: either client public-decrypts the three outcome handles through the relayer
   and sends `finalizeRound(id, clear, proof)`; `FHE.checkSignatures` rejects forged values.
5. The game ends when a carrier reaches its home row (winner), after round 10 (draw), or by
   `claimTimeout` once the move deadline passes: the only player who moved wins, nobody moved is a
   draw. `cancelGame` calls off a game nobody joined.

**Rules** (resolved for both scouts at once, in this order; `packages/shared/src/fog-skirm.ts` is the
same logic in TypeScript):

| Step | Under FHE |
| --- | --- |
| Move | `FHE.select` on each direction and board edge: off the board or an unknown code means you stay. Positions are kept as encrypted row, column and tile. |
| Trap | Your tile equals a live rival trap (`FHE.eq`): you are sent home, that trap is spent (set to 255) and a carried vial drops back to its tile. |
| Tag | Both scouts on one tile knock the vial loose. |
| Pickup | Alone on the vial tile while nobody carries it. Both arriving together: nobody gets it. |
| Delivery | The carrier on its home row wins. |
| Sense | Each player gets two pings: distance band to the vial and to the rival scout (Manhattan distance; 0 = on or next to you, 1 = 2–3 steps, 2 = 4+). |

Traps are planted on the rival's half: side 0 on tiles 10–19 (rows 2–3), side 1 on tiles 5–14
(rows 1–2). The contract cannot reject an out-of-band trap without revealing it, so it turns it into
an inert 255 under FHE (the planter can see that when it decrypts its own traps).

**What stays hidden, from whom.**

| Value | Who can decrypt it during the game |
| --- | --- |
| Your traps (as planted and live) | You |
| Your scout's tile, whether you carry the vial, whether you were just hit | You |
| Your vial ping | You |
| The rival ping (symmetric) | Both players |
| Every move, both scouts' rows and columns, the vial | Nobody (only the contract's ACL) |
| Per round: "a trap went off", "the vial is carried", winner | Everyone, after `finalizeRound` (KMS-verified) |

When the game ends, `_end` makes every planted trap, the vial column, both final tiles and every
move of every finalized round publicly decryptable (`revealHandles`, `GameRevealRequested`).
`finalizeGameReveal` checks them against the KMS proof and stores them (`replay`, `GameRevealed`).
**Verify this game** on the game-over screen replays that history with the shared rules and checks
that every round's public outcome, the final positions and the winner match the chain.

**Why a transparent chain breaks it.** Without FHE the traps would be in `createGame`'s calldata and
in storage, so the rival reads them on a block explorer before moving; every position and move
would be public, so there is no fog; and a vial drawn from public randomness is visible the moment it
is drawn. Commit-reveal does not fix it either: resolving a round needs comparisons between hidden
values every round (is my scout on your trap, on the vial, on your tile?), so someone would have to
reveal to resolve, or trust a referee. Here the contract computes on ciphertexts, nobody knows the
full board, and the public outcome comes with a proof.

**Gas and HCU** (FHEVM mock, `npx hardhat test test/FogSkirm.ts` prints them; HCU limits per tx on
the coprocessor: 20,000,000 total, 5,000,000 sequential depth):

| Call | Gas | HCU | HCU depth |
| --- | ---: | ---: | ---: |
| `createGame` | 533,855 | 380,032 | 138,000 |
| `joinGame` (draws the vial, first pings) | 1,771,699 | 3,721,640 | 931,000 |
| `submitMove`, first of the round | 219,553 | 0 | 0 |
| `submitMove`, second (resolves the round) | 2,853,642 | 6,955,652 | 1,006,000 |
| `finalizeRound` | 142,180 | 0 | 0 |
| `finalizeRound` that ends the game (opens up to 27 handles) | 991,939 | 0 | 0 |
| `finalizeGameReveal` | 463,186 to 480,953 | 0 | 0 |

The resolving move is the heaviest transaction: about 35% of the per-transaction HCU budget and 20%
of the depth budget, and about 2.9 M gas, well under Sepolia's block gas limit. A full 10-round game
is about 35 M gas across both players.

**No stake.** Fog Skirm is unstaked for now: an escrow would add an operator approval and a payout
path to every game, and the point of the mode is the hidden-information mechanic. cSKIRM stakes
live in SkirmMatch.

**Known limits.** The vial column is `randEuint8 mod 5`, so column 0 is drawn with probability
52/256 and the others 51/256. A round that is resolved but not finalized has no timeout: anyone can
send `finalizeRound`, so it only needs the relayer. Ping history is kept in the player's browser
(the chain keeps the latest pings only). A spectator sees only the public outcomes until the end.

## SkillAuction: sealed-bid skill auctions in cSKIRM

Sellers auction a skill version on the Exchange and bidders submit encrypted bids, paid in cSKIRM.
Nobody, the seller included, can read a bid while the auction runs or after it ends; when it closes
only two numbers become public: who won and the clearing price. Play it from the Exchange (apps/web
`src/features/zama/auctions`, behind `NEXT_PUBLIC_ZAMA_ENABLED`): a "Sealed auctions 🔒" row on the
Exchange tab, and a bid box or "Start a sealed auction 🔒" in a skill's detail.

**Flow.**

1. *Create*: `createAuction(skillRef, endTime, reserve)` with a public reserve, or
   `createAuctionSealedReserve(skillRef, endTime, encReserve, proof)` with an encrypted one.
   `skillRef = keccak256("skirm-skill:<skillId>:<version>")` (`skillRefPreimage` in
   `packages/shared/src/sealed-auction.ts`) ties the auction to one off-chain skill version without
   putting its name or text on chain. The seller then registers it with the api (`POST /zama/auctions`),
   which checks the seller's linked EVM address, the skill reference and that it holds the version.
2. *Bid*: `bid(auctionId, encAmount, proof)`, after making SkillAuction a cSKIRM operator once. The
   contract pulls the amount with `confidentialTransferFrom` and adds what *actually arrived* to the
   bidder's sealed total: ERC-7984 moves 0 on a short balance instead of reverting, so an unfunded
   bid counts as 0 and nobody learns that it was unfunded. One sealed total per address; a second
   `bid` raises it. The public sees "N sealed bids" (a count); the bidder can user-decrypt its own.
3. *Close* (anyone, after `endTime`): with no bids the auction fails at once. Otherwise it computes
   `met = first >= reserve` and opens exactly two handles for public decryption,
   `met ? winnerIndex : 0` and `met ? price : 0`.
4. *Finalize* (anyone): `finalize(auctionId, clear, proof)` checks the KMS proof with
   `FHE.checkSignatures`, records the winner and price, pays the seller `price - fee` and the
   treasury the fee, and emits `Won(auctionId, skillRef, winner, seller, price)` (or `Failed`).
5. *Refund* (anyone, paid to the bidder): `refund(auctionId, bidder)` sends a loser its whole escrow
   and the winner `total - price`, both as ciphertexts. Pulled per bidder so `finalize` stays O(1)
   under the per-transaction HCU limit.

**Pricing: Vickrey (second price).** The highest total wins and pays `max(second, reserve)`. Ties go to
the earlier bidder at the tied value. Truthful bidding is the dominant strategy, which fits a market
where nobody can see the others anyway. The contract tracks the top two totals and the winner index
under FHE in O(1) per bid (no loop over bidders). With `t` the bidder's new total and `i` its index:
`beats = t > first`, `first' = max(first, t)`, `firstIdx' = beats ? i : firstIdx`, and
`second' = (firstIdx == i) ? second : (beats ? first : max(second, t))`. `vickreyOutcome` in
`packages/shared/src/sealed-auction.ts` is the same rule on plaintexts, and the tests compare them.

**What stays hidden, from whom.**

| Value | Who can decrypt it |
| --- | --- |
| A bidder's total (every bid and raise) | That bidder only, before and after the close |
| The running highest and second-highest totals, the leader | Nobody (only the contract's ACL) |
| An encrypted reserve | The seller only; public only if it ends up being the price |
| How many addresses bid | Everyone (`bidders`) |
| Winner and clearing price | Everyone, after `finalize` (KMS-verified) |
| A losing bid's amount, its refund | That bidder only, forever |

In a second-price auction the clearing price is the runner-up's bid (or the reserve): that one
number is the price by design, but the runner-up's identity is never revealed.

**Why sealed bids need FHE.** On a transparent chain every bid is in the calldata and in storage the
moment it lands, so the auction degenerates: snipers outbid the leader by 1 in the last block, a
seller's shill account probes how high real bidders go, and late bidders herd behind the visible
leader. Commit-reveal hides amounts but leaks everything at reveal time (every losing bid becomes
public), lets a losing bidder refuse to reveal, and needs escrow sized without knowing the bid. Here
the escrow itself is a ciphertext, the ranking is computed on ciphertexts, and only the outcome is
ever decrypted, with a proof.

**Off chain.** The worker (`apps/worker/src/auction-processor.ts`, `grantWonAuctions` in
`packages/server/src/zama/auctions.ts`) polls auctions past their end and, once the chain says won,
grants the version to the account linked to the winning address through the Exchange's own sale
path (`MarketRepo.recordSale`, currency `cskirm`, keyed by the auction so a retry never sells twice).
A winner without a linked address is granted as soon as it links one (`PUT /zama/evm-link`, a
personal_sign of `evmLinkMessage(accountId, address)`).

**Gas and HCU** (FHEVM mock, `npx hardhat test test/SkillAuction.ts` prints them; HCU limits per tx
on the coprocessor: 20,000,000 total, 5,000,000 sequential depth):

| Call | Gas | HCU | HCU depth |
| --- | ---: | ---: | ---: |
| `createAuction` (public reserve) | 319,227 | 128 | 32 |
| `createAuctionSealedReserve` | 418,436 | 96 | 32 |
| `bid`, first from an address | 698,650 | 1,284,096 | 480,000 |
| `bid`, a raise | 673,975 | 1,556,064 | 697,000 |
| `close` | 276,580 | 480,064 | 273,000 |
| `close` with no bids | 30,911 | 0 | 0 |
| `finalize` (sells, pays seller and treasury) | 750,775 | 1,172,192 | 586,032 |
| `finalize` (no sale) | 99,277 | 0 | 0 |
| `refund` | 414,671 | 719,032 | 502,000 |

Every call is under 8% of the per-transaction HCU budget and 14% of the depth budget, and the cost
of a bid does not grow with the number of bidders.

**Known limits.** One open auction per skill version, and no fixed-price NEAR listing beside it (the
api refuses both). With NEAR ops on, the skill token itself still sits with the seller on NEAR: the
auction moves the Exchange's ownership record; moving the NEAR token is left to a follow-up. An
auction nobody finalizes stays in `Closing` (anyone can finalize; the seller has the incentive).

## Deploy to Sepolia

```bash
npm run deploy:sepolia -w @skirm/fhevm
```

This deploys `ConfidentialSkirmCredits`, `SkirmMatch`, `FogSkirm` and `SkillAuction` (or only the
ones in `DEPLOY_CONTRACTS`, e.g. `DEPLOY_CONTRACTS=SkirmMatch` next to an already deployed token,
`DEPLOY_CONTRACTS=FogSkirm` to add Fog Skirm, which takes no constructor arguments, or
`DEPLOY_CONTRACTS=SkillAuction` to add the sealed skill auctions), records them in
`deployments/sepolia.json` (address, tx, block, constructor args; merged with what is already
there) and regenerates `generated/index.ts`. Commit both files so the web and realtime pick up the
addresses.

SkirmMatch's constructor is `(credits, operator, treasury, feeBps)`: `CREDITS_ADDRESS` (default: the
cSKIRM deployed in the same run or recorded in `deployments/sepolia.json`), `MATCH_OPERATOR` (default
the deployer; give the game server that account's key as `ZAMA_OPERATOR_PRIVATE_KEY`), `TREASURY`
(default none) and `FEE_BPS` (default 0). The stake escrow changes SkirmMatch's ABI, so a SkirmMatch
deployed before it must be redeployed (`DEPLOY_CONTRACTS=SkirmMatch` keeps the token).

SkillAuction's constructor is `(credits, treasury, feeBps)`: the same `CREDITS_ADDRESS` and
`TREASURY`, and `AUCTION_FEE_BPS` (fee on the clearing price, at most 1000; default `FEE_BPS`, else
0). The server reads it with `ZAMA_ENABLED=1` (api: `/zama/auctions`; worker: the grant poller,
`ZAMA_AUCTION_POLL_MS`); `ZAMA_AUCTION_ADDRESS` / `NEXT_PUBLIC_ZAMA_AUCTION_ADDRESS` override the
address. To verify:

```bash
npx hardhat verify --network sepolia <creditsAddress> <owner> <faucetAmount> <faucetCooldown>
npx hardhat verify --network sepolia <matchAddress> <creditsAddress> <operator> <treasury> <feeBps>
npx hardhat verify --network sepolia <fogAddress>
npx hardhat verify --network sepolia <auctionAddress> <creditsAddress> <treasury> <feeBps>
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
`NEXT_PUBLIC_ZAMA_MATCH_ADDRESS` / `NEXT_PUBLIC_ZAMA_FOG_ADDRESS` override them (realtime: `ZAMA_MATCH_ADDRESS`), and
shows the cSKIRM card on /account/credits only when `NEXT_PUBLIC_ZAMA_ENABLED=1`
(client code: `apps/web/src/lib/zama`, UI: `apps/web/src/features/zama`).
