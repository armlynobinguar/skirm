# Sealed spectator predictions

When you watch a live PvP match, a **Predict 🔒** panel sits over the board. Pick a crew, enter a stake in cSKIRM and press **Predict 🔒**. It runs on the Zama Protocol (`MatchPredictions` on Sepolia), so it needs `NEXT_PUBLIC_ZAMA_ENABLED` and a wallet on Sepolia with some cSKIRM from the faucet.

## Why the pool is hidden

On a normal chain every bet is public the moment it lands. That breaks a prediction market in a few ways:

- **Herding.** Late bettors copy the crowd instead of judging the match, so the odds show the crowd's mood, not the match.
- **Following whales.** One big bet on a side pulls others after it, and whoever placed it can exit on the move.
- **Front-running.** Anyone watching the mempool sees your side and size before your bet lands and can get in ahead of you.
- **Players reading the crowd.** In skirm the players can watch the market too. A public pool tells a crew how the room thinks the match is going.

Here your side and your stake are encrypted in your browser before they leave it. The contract adds every stake to both totals under FHE, `select(side, stake, 0)` for one and `select(side, 0, stake)` for the other, so a prediction looks the same on chain whichever side it backs. While betting is open, all anyone can see is **N sealed predictions · pool hidden until tick 30**.

## The close at tick 30

The server closes betting at tick 30, before the late game, so nobody can bet on a match that is already decided. The contract then makes the two totals public, and the server submits them with a KMS proof (`FHE.checkSignatures`). The panel then shows each side's total and its odds: what 1 cSKIRM returns on a win, before the fee.

## Payout

Once the match ends, the market is resolved.

- **A sealed match** (both crews sealed on SkirmMatch): the contract reads the winner from `SkirmMatch.settle`, the same call that pays the players and anchors the match log. Anyone can resolve it, and the operator can't post a different result.
- **Any other match**: the operator posts the result the server recorded. The match log stays checkable on the verify page.
- **A draw, a void match, or a side nobody backed** refunds every stake. A market nobody resolves within a day of its close can be voided by anyone.

In the debrief, press **Claim 🔒**. A winner gets `stake + stake × losing total ÷ winning total`, minus the fee on the winnings. A loser gets an encrypted 0. Both look the same on chain, so others only learn that you claimed. Only you can decrypt your payout.

## What stays hidden

| Value | Who can read it |
| --- | --- |
| Your side and your stake | Only you, at any time |
| The totals per side | Nobody while betting is open. Everyone after the close (with a KMS proof) |
| Your payout | Only you |
| How many predictions there are | Everyone |
| That your address predicted, and that it claimed | Everyone (transactions are public) |

A stake larger than your balance stakes 0: the confidential transfer moves nothing instead of failing, so a failed bet looks like any other. Each stake is capped at 100,000 cSKIRM. The two players of a sealed match can't predict on it.
