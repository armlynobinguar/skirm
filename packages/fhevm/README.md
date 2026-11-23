# @skirm/fhevm

skirm's confidential contracts on the [Zama Protocol](https://docs.zama.org/protocol) (FHEVM), deployed on Sepolia.
The layout mirrors [zama-ai/fhevm-hardhat-template](https://github.com/zama-ai/fhevm-hardhat-template):
Hardhat 2 + `@fhevm/hardhat-plugin` (an in-process FHEVM mock for tests), `@fhevm/solidity` and
OpenZeppelin's [confidential contracts](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts) for ERC-7984.

| Contract | What it is |
| --- | --- |
| `ConfidentialSkirmCredits` (cSKIRM) | ERC-7984 confidential token for stakes and rewards. Balances and transfer amounts are FHE ciphertexts. Owner + approved minters (game contracts) can mint; a public faucet gives testers a fixed amount once per cooldown. |

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

## Deploy to Sepolia

```bash
npm run deploy:sepolia -w @skirm/fhevm
```

This deploys `ConfidentialSkirmCredits`, records it in `deployments/sepolia.json` (address, tx, block,
constructor args; later contracts are merged into the same file) and regenerates `generated/index.ts`.
Commit both files so the web picks up the address. To verify:

```bash
npx hardhat verify --network sepolia <address> <owner> <faucetAmount> <faucetCooldown>
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

The web reads the address from there, unless `NEXT_PUBLIC_ZAMA_CREDITS_ADDRESS` overrides it, and
shows the cSKIRM card on /account/credits only when `NEXT_PUBLIC_ZAMA_ENABLED=1`
(client code: `apps/web/src/lib/zama`, UI: `apps/web/src/features/zama`).
