# CreditsBalance

The player's credit balance with free runs left today and a top-up action.

- **Provide:** `balance`, optional `freeRuns` (left today), `lowAt` (shows a warning below it), `onTopUp`.
- Put it in the top bar on every screen. Credits are an offchain balance backed by deposits; there is no game token.
- Set `lowAt` to the hold of the cheapest run the player is looking at, so "Low balance" means "you can't start this run".
