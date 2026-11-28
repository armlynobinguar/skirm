// Private MMR (Zama FHEVM on Sepolia): the game server's operator side of packages/fhevm
// PrivateLadder.sol. Every player who joined the ladder (`register()` from their own wallet) has an
// encrypted rating only they can decrypt. After a ranked match between two linked, registered
// players the realtime server reports the result (the contract moves both ratings under FHE), then
// public-decrypts each player's new tier through the Zama relayer and submits it with the KMS proof;
// the tier is the only number that goes public, and the server caches it on the account. For
// matchmaking the server may ask `isCloseMatch(a, b)` and user-decrypt the one-bit answer as the
// operator: it learns whether two players are close, never their ratings.
//
// Gated by ZAMA_ENABLED. Env: ZAMA_OPERATOR_PRIVATE_KEY (the operator key the other Zama features
// use; without it nothing is reported), SEPOLIA_RPC_URL, ZAMA_LADDER_ADDRESS (default: the
// PrivateLadder address in packages/fhevm/deployments/sepolia.json, via @skirm/fhevm/generated),
// ZAMA_RELAYER_URL (default: the SDK's Sepolia relayer). The key is never logged.
import { PrivateLadderAbi, sepolia } from '@skirm/fhevm/generated';
import { LADDER_NO_SIDE, retryRead, waitForHandles, withFreshKmsProof } from '@skirm/shared';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { nodeRelayer, type OperatorSigner, type RelayerInstance } from './benchmark-seeds';
import { OperatorQueue, operatorQueue } from './operator-queue';
import { sealedMatchKey, zamaServerConfig, type ZamaServerConfig } from './sealed-match';
import { OPERATOR_KEY_RE } from './settlement';

/** PrivateLadder.playerOf, as the server uses it. */
export interface LadderPlayer {
  registered: boolean;
  /** The last revealed tier index (0 Bronze .. 5 Master). */
  tier: number;
  /** A newer tier is waiting for revealTier. */
  tierPending: boolean;
  matches: number;
}

/** The PrivateLadder calls the realtime server makes as the operator (an interface, so tests fake it). */
export interface LadderOperator {
  player(address: string): Promise<LadderPlayer>;
  reported(matchId: string): Promise<boolean>;
  /** Sends report and waits for it (`winner` null: a draw, which moves nothing); returns the tx hash. */
  report(matchId: string, a: string, b: string, winner: 'A' | 'B' | null): Promise<string>;
  /** Public-decrypts `address`'s pending tier and sends revealTier with the KMS proof; returns the tier. */
  revealTier(address: string): Promise<number>;
  /** Sends isCloseMatch and user-decrypts the encrypted answer as the operator. */
  isClose(a: string, b: string): Promise<boolean>;
}

type Tx = { hash: string; wait(): Promise<unknown> };

/** The contract calls the operator needs (an ethers Contract bound to the operator wallet, or a fake). */
export interface LadderContract {
  playerOf(address: string): Promise<{ registered: boolean; tier: bigint; tierPending: boolean; matches: bigint }>;
  reported(key: string): Promise<boolean>;
  tierHandle(address: string): Promise<string>;
  closeCheck(a: string, b: string): Promise<string>;
  report(key: string, a: string, b: string, side: number): Promise<Tx>;
  revealTier(address: string, clear: string, proof: string): Promise<Tx>;
  isCloseMatch(a: string, b: string): Promise<Tx>;
}

/** The contract side for an off-chain winner: A is 0, B is 1, a draw NO_SIDE. */
export const ladderWinnerSide = (winner: 'A' | 'B' | null): number => (winner === 'A' ? 0 : winner === 'B' ? 1 : LADDER_NO_SIDE);

/** The SDK keys results by handle hex; match case-insensitively. */
function clearOf(values: Record<string, bigint | boolean | string>, handle: string): bigint | boolean {
  const lower = handle.toLowerCase();
  for (const [k, v] of Object.entries(values)) if (k.toLowerCase() === lower) return typeof v === 'boolean' ? v : BigInt(v);
  throw new Error('the relayer returned no value for the handle');
}

/** PrivateLadder as the operator: ethers for transactions, the relayer for decryption. */
export class ContractLadderOperator implements LadderOperator {
  readonly address: string;

  constructor(
    address: string,
    private readonly contract: LadderContract,
    private readonly signer: OperatorSigner,
    private readonly relayer: () => Promise<Pick<RelayerInstance, 'generateKeypair' | 'createEIP712' | 'userDecrypt' | 'publicDecrypt'>>,
    /** One operator transaction at a time (shared with the operator's other senders), so none race for a nonce. */
    private readonly queue = new OperatorQueue(),
  ) {
    this.address = address.toLowerCase();
  }

  async player(address: string): Promise<LadderPlayer> {
    const p = await retryRead(() => this.contract.playerOf(address));
    return { registered: p.registered, tier: Number(p.tier), tierPending: p.tierPending, matches: Number(p.matches) };
  }

  reported(matchId: string): Promise<boolean> {
    return retryRead(() => this.contract.reported(sealedMatchKey(matchId)));
  }

  report(matchId: string, a: string, b: string, winner: 'A' | 'B' | null): Promise<string> {
    return this.send(() => this.contract.report(sealedMatchKey(matchId), a, b, ladderWinnerSide(winner)));
  }

  async revealTier(address: string): Promise<number> {
    const handle = (await waitForHandles(async () => [await this.contract.tierHandle(address)]))[0]!;
    // A rejected KMS proof (KMSInvalidSigner) is fetched again and resent.
    const res = await withFreshKmsProof(
      async () => (await this.relayer()).publicDecrypt([handle]),
      async (res) => {
        await this.send(() => this.contract.revealTier(address, res.abiEncodedClearValues, res.decryptionProof));
        return res;
      },
    );
    return Number(clearOf(res.clearValues, handle));
  }

  async isClose(a: string, b: string): Promise<boolean> {
    await this.send(() => this.contract.isCloseMatch(a, b));
    const handle = await this.contract.closeCheck(a, b);
    const sdk = await this.relayer();
    const { publicKey, privateKey } = sdk.generateKeypair();
    const start = Math.floor(Date.now() / 1000);
    const contracts = [this.address];
    const eip712 = sdk.createEIP712(publicKey, contracts, start, 1);
    const signature = await this.signer.signTypedData(
      eip712.domain as Record<string, unknown>,
      { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
      eip712.message as Record<string, unknown>,
    );
    const clear = await sdk.userDecrypt(
      [{ handle, contractAddress: this.address }],
      privateKey,
      publicKey,
      signature.replace(/^0x/, ''),
      contracts,
      this.signer.address,
      start,
      1,
    );
    const v = clearOf(clear, handle);
    return v === true || v === 1n;
  }

  private send(fn: () => Promise<Tx>): Promise<string> {
    return this.queue.run(async () => {
      const tx = await fn();
      await tx.wait();
      return tx.hash;
    });
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** ZAMA_LADDER_ADDRESS, else the deployments file; null when not deployed. */
export function ladderAddress(env: Record<string, string | undefined> = process.env): string | null {
  const override = env.ZAMA_LADDER_ADDRESS?.trim();
  return override && ADDRESS_RE.test(override) ? override : sepolia.contracts.PrivateLadder;
}

interface OperatorLog {
  warn(msg: string): void;
}

/**
 * The ladder operator when ZAMA_ENABLED is on, PrivateLadder is deployed and ZAMA_OPERATOR_PRIVATE_KEY
 * holds a key; else null and nothing is reported (a missing or malformed key logs a warning, never the key).
 */
export function createLadderOperator(
  env: Record<string, string | undefined> = process.env,
  log: OperatorLog = console,
  cfg: ZamaServerConfig = zamaServerConfig(env),
): ContractLadderOperator | null {
  const address = ladderAddress(env);
  if (!cfg.enabled || !address) return null;
  const key = env.ZAMA_OPERATOR_PRIVATE_KEY?.trim();
  if (!key || !OPERATOR_KEY_RE.test(key)) {
    log.warn(
      key
        ? 'zama: ZAMA_OPERATOR_PRIVATE_KEY is not a 32-byte hex key, the private ladder is not reported'
        : 'zama: ZAMA_OPERATOR_PRIVATE_KEY is not set, the private ladder is not reported',
    );
    return null;
  }
  const wallet = new Wallet(key.startsWith('0x') ? key : `0x${key}`, new JsonRpcProvider(cfg.rpcUrl, sepolia.chainId, { staticNetwork: true }));
  const c = new Contract(address, PrivateLadderAbi, wallet);
  const fn = (name: string) => c.getFunction(name);
  const contract: LadderContract = {
    playerOf: (a) => fn('playerOf')(a) as ReturnType<LadderContract['playerOf']>,
    reported: (k) => fn('reported')(k) as Promise<boolean>,
    tierHandle: (a) => fn('tierHandle')(a) as Promise<string>,
    closeCheck: (a, b) => fn('closeCheck')(a, b) as Promise<string>,
    report: (k, a, b, side) => fn('report')(k, a, b, side) as Promise<Tx>,
    revealTier: (a, clear, proof) => fn('revealTier')(a, clear, proof) as Promise<Tx>,
    isCloseMatch: (a, b) => fn('isCloseMatch')(a, b) as Promise<Tx>,
  };
  const signer: OperatorSigner = {
    address: wallet.address,
    signTypedData: (domain, types, message) => wallet.signTypedData(domain, types as never, message),
  };
  return new ContractLadderOperator(address, contract, signer, nodeRelayer(cfg.rpcUrl, env.ZAMA_RELAYER_URL?.trim() || undefined), operatorQueue(wallet.address));
}
