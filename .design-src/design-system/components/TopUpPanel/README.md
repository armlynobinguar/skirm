# TopUpPanel

Buys credits with NEAR: pick an amount, see the credits, confirm in the wallet.

- **Provide:** optional `packs` (`[{ near }]`, default 1, 5, 10), `creditsPerNear` (rate, default 1000 *proposed placeholder*), `network` (e.g. "Testnet"), `onConfirm(pack)`, `pending` (waiting for the wallet).
- The note restates the prepaid rule: a run holds agents × step limit, unused credits return.
- The NEAR-to-credit rate is not set yet. Show the real rate from the backend; never hard-code it.
- This is the only screen that names the wallet. Use it inside a `Modal`.
