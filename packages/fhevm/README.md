# @skirm/fhevm

skirm's confidential contracts on the [Zama Protocol](https://docs.zama.org/protocol) (FHEVM), deployed on Sepolia.
The layout mirrors [zama-ai/fhevm-hardhat-template](https://github.com/zama-ai/fhevm-hardhat-template):
Hardhat 2 + `@fhevm/hardhat-plugin` (an in-process FHEVM mock for tests), `@fhevm/solidity` and
OpenZeppelin's [confidential contracts](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts) for ERC-7984.

| Contract | What it is |
| --- | --- |
| `ConfidentialSkirmCredits` (cSKIRM) | ERC-7984 confidential token for stakes and rewards. Balances and transfer amounts are FHE ciphertexts. Owner + approved minters (game contracts) can mint; a public faucet gives testers a fixed amount once per cooldown. |
| `SkirmMatch` | Sealed PvP loadouts: each player commits its crew, skills and talk tiers as encrypted inputs; nobody can read them until both have locked, then both are revealed together with a KMS-verified public decryption. Lock deadline + forfeit. |

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

**Lifecycle** (`Status`): `None → Open → Locked → Revealing → Revealed`, or `Open → Forfeited | Cancelled`.

| Call | Who | What |
| --- | --- | --- |
| `createMatch(id, playerA, playerB, lockWindow)` | a player (or anyone, with both seats open) | `id = keccak256(utf8(offchainMatchId))`. A seat left as `address(0)` goes to the first account that seals it (never both seats to one account). `lockWindow` 1 min to 1 day. |
| `submitLoadout(id, side, agents[3], skills[3], tiers[3], proof)` | that side's player | Nine `externalEuint8` under one input proof. ACL: only the contract and the submitting player. One submission per side, before the deadline. |
| `reveal(id)` | anyone, once both locked | `FHE.makePubliclyDecryptable` on all 18 handles; emits `RevealRequested(id, handles)`. |
| `finalizeReveal(id, abiEncodedClearValues, decryptionProof)` | anyone | Fetch both from the relayer (`publicDecrypt(revealHandles(id))`); `FHE.checkSignatures` verifies the KMS proof, then the plaintexts are stored (`revealedLoadout`) and emitted (`LoadoutRevealed`). |
| `forfeit(id)` | anyone, after the deadline while `Open` | One side locked: it wins (`MatchForfeited`, `winner`). Neither: `MatchCancelled`. |

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
checks the seat is the address the player declared, and plays exactly that crew. The server only
reads the chain and holds no key.

**Hook points** for later contracts: `_onCreated`, `_onSealed`, `_onBothLocked` (an FHE random seed
can be drawn here, before anything is revealed), `_onRevealed` and `_onForfeited` (a cSKIRM stake
escrow can take stakes on seal and pay out on result or forfeit). They are empty internal virtual
functions here.

**Known limits.** Match ids are predictable, so an attacker who knows one could open it first with
fixed seats only if they are one of those seats; with open seats, the off-chain address check makes a
squatted seat fail the sealed lock (the player then locks in normally). Off chain, a side that never
locks plays its queued crew as before; the on-chain forfeit settles the commitment only.

## Deploy to Sepolia

```bash
npm run deploy:sepolia -w @skirm/fhevm
```

This deploys `ConfidentialSkirmCredits` and `SkirmMatch` (or only the ones in `DEPLOY_CONTRACTS`,
e.g. `DEPLOY_CONTRACTS=SkirmMatch` next to an already deployed token), records them in
`deployments/sepolia.json` (address, tx, block, constructor args; merged with what is already
there) and regenerates `generated/index.ts`. Commit both files so the web and realtime pick up the
addresses. To verify:

```bash
npx hardhat verify --network sepolia <creditsAddress> <owner> <faucetAmount> <faucetCooldown>
npx hardhat verify --network sepolia <matchAddress>
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
