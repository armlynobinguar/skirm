// Confidential spectator predictions (Zama FHEVM on Sepolia): the game server's operator side of
// packages/fhevm MatchPredictions.sol. When a PvP match goes live the realtime server opens a market
// on it; spectators back a side with an encrypted side and amount from their own wallets (the server
// never sees either). At PREDICTION_CLOSE_TICK the server closes betting, public-decrypts the two
// totals through the Zama relayer and submits them with the KMS proof (the odds go public). After
// the match it resolves the market: a sealed match's winner is read by the contract from SkirmMatch,
// any other match takes the result the server posts. Winners then claim their payout themselves.
//
// Gated by ZAMA_ENABLED. Env: ZAMA_OPERATOR_PRIVATE_KEY (the same operator key settlement uses;
// without it no market opens), SEPOLIA_RPC_URL, ZAMA_PREDICTIONS_ADDRESS (default: the
// MatchPredictions address in packages/fhevm/deployments/sepolia.json, via @skirm/fhevm/generated),
// ZAMA_RELAYER_URL (default: the SDK's Sepolia relayer). The key is never logged.
import { MatchPredictionsAbi, sepolia } from '@skirm/fhevm/generated';
import { PREDICTION_NO_SIDE, predictionStatus, retryRead, waitForHandles, withFreshKmsProof, type PredictionStatus } from '@skirm/shared';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { nodeRelayer, type RelayerInstance } from './benchmark-seeds';
import { sealedMatchKey, zamaServerConfig, type ZamaServerConfig } from './sealed-match';
import { OperatorQueue, operatorQueue } from './operator-queue';
import { OPERATOR_KEY_RE } from './settlement';

/** MatchPredictions.getMarket, as the server uses it. */
export interface ChainMarket {
  status: PredictionStatus;
  /** Unix seconds. */
  closesAt: number;
  predictors: number;
  /** Public once revealed (0 before). */
  totalA: bigint;
  totalB: bigint;
  /** 0 or 1 once resolved, else 255. */
  winner: number;
}

/** The MatchPredictions calls the realtime server makes as the operator (an interface, so tests fake it). */
export interface PredictionOperator {
  read(matchId: string): Promise<ChainMarket>;
  /** Sends openMarket and waits for it; returns the tx hash. */
  open(matchId: string, closesAt: number): Promise<string>;
  /** Sends close and waits for it; returns the tx hash. */
  close(matchId: string): Promise<string>;
  /** Public-decrypts the two totals and sends revealTotals with the KMS proof. */
  revealTotals(matchId: string): Promise<{ txHash: string; totalA: bigint; totalB: bigint }>;
  /** Sends resolve (`winner` null: a draw or a void match, which refunds everyone). */
  resolve(matchId: string, winner: 'A' | 'B' | null): Promise<string>;
}

/** getMarket's tuple as ChainMarket (exported for tests). */
export function parseChainMarket(m: { closesAt: bigint; status: bigint; winner: bigint; predictors: bigint; totalA: bigint; totalB: bigint }): ChainMarket {
  return {
    status: predictionStatus(m.status),
    closesAt: Number(m.closesAt),
    predictors: Number(m.predictors),
    totalA: BigInt(m.totalA),
    totalB: BigInt(m.totalB),
    winner: Number(m.winner),
  };
}

/** The contract seat for an off-chain winner: A is 0, B is 1, a draw NO_SIDE. */
export const predictionWinnerSide = (winner: 'A' | 'B' | null): number => (winner === 'A' ? 0 : winner === 'B' ? 1 : PREDICTION_NO_SIDE);

type Tx = { hash: string; wait(): Promise<unknown> };

/** The contract calls the operator needs (an ethers Contract bound to the operator wallet, or a fake). */
export interface PredictionsContract {
  getMarket(key: string): Promise<{ closesAt: bigint; status: bigint; winner: bigint; predictors: bigint; totalA: bigint; totalB: bigint }>;
  totalHandles(key: string): Promise<string[]>;
  openMarket(key: string, closesAt: number): Promise<Tx>;
  close(key: string): Promise<Tx>;
  revealTotals(key: string, clear: string, proof: string): Promise<Tx>;
  resolve(key: string, side: number): Promise<Tx>;
}

/** The SDK keys results by handle hex; match case-insensitively. */
function clearOf(values: Record<string, bigint | boolean | string>, handle: string): bigint {
  const lower = handle.toLowerCase();
  for (const [k, v] of Object.entries(values)) if (k.toLowerCase() === lower) return BigInt(v as bigint);
  throw new Error('the relayer returned no value for a total handle');
}

/** MatchPredictions as the operator: ethers for transactions, the relayer for the public decryption. */
export class ContractPredictionOperator implements PredictionOperator {
  constructor(
    private readonly contract: PredictionsContract,
    private readonly relayer: () => Promise<Pick<RelayerInstance, 'publicDecrypt'>>,
    private readonly queue = new OperatorQueue(),
  ) {}

  async read(matchId: string): Promise<ChainMarket> {
    return parseChainMarket(await retryRead(() => this.contract.getMarket(sealedMatchKey(matchId))));
  }

  open(matchId: string, closesAt: number): Promise<string> {
    return this.send(() => this.contract.openMarket(sealedMatchKey(matchId), closesAt));
  }

  close(matchId: string): Promise<string> {
    return this.send(() => this.contract.close(sealedMatchKey(matchId)));
  }

  async revealTotals(matchId: string): Promise<{ txHash: string; totalA: bigint; totalB: bigint }> {
    const key = sealedMatchKey(matchId);
    // Zero handles (a lagging RPC node right after close) are read again: the relayer won't decrypt them.
    const handles = (await waitForHandles(async () => (await this.contract.totalHandles(key)).map(String))).slice();
    // A rejected KMS proof (KMSInvalidSigner) is fetched again and resent.
    const { res, txHash } = await withFreshKmsProof(
      async () => (await this.relayer()).publicDecrypt(handles),
      async (res) => ({ res, txHash: await this.send(() => this.contract.revealTotals(key, res.abiEncodedClearValues, res.decryptionProof)) }),
    );
    return { txHash, totalA: clearOf(res.clearValues, handles[0]!), totalB: clearOf(res.clearValues, handles[1]!) };
  }

  resolve(matchId: string, winner: 'A' | 'B' | null): Promise<string> {
    return this.send(() => this.contract.resolve(sealedMatchKey(matchId), predictionWinnerSide(winner)));
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

/** ZAMA_PREDICTIONS_ADDRESS, else the deployments file; null when not deployed. */
export function predictionsAddress(env: Record<string, string | undefined> = process.env): string | null {
  const override = env.ZAMA_PREDICTIONS_ADDRESS?.trim();
  return override && ADDRESS_RE.test(override) ? override : sepolia.contracts.MatchPredictions;
}

interface OperatorLog {
  warn(msg: string): void;
}

/**
 * The operator when ZAMA_ENABLED is on, MatchPredictions is deployed and ZAMA_OPERATOR_PRIVATE_KEY
 * holds a key; else null and no market opens (a missing or malformed key logs a warning, never the key).
 */
export function createPredictionOperator(
  env: Record<string, string | undefined> = process.env,
  log: OperatorLog = console,
  cfg: ZamaServerConfig = zamaServerConfig(env),
): PredictionOperator | null {
  const address = predictionsAddress(env);
  if (!cfg.enabled || !address) return null;
  const key = env.ZAMA_OPERATOR_PRIVATE_KEY?.trim();
  if (!key || !OPERATOR_KEY_RE.test(key)) {
    log.warn(
      key
        ? 'zama: ZAMA_OPERATOR_PRIVATE_KEY is not a 32-byte hex key, no prediction markets open'
        : 'zama: ZAMA_OPERATOR_PRIVATE_KEY is not set, no prediction markets open',
    );
    return null;
  }
  const wallet = new Wallet(key.startsWith('0x') ? key : `0x${key}`, new JsonRpcProvider(cfg.rpcUrl, sepolia.chainId, { staticNetwork: true }));
  const c = new Contract(address, MatchPredictionsAbi, wallet);
  const fn = (name: string) => c.getFunction(name);
  const contract: PredictionsContract = {
    getMarket: (k) => fn('getMarket')(k) as ReturnType<PredictionsContract['getMarket']>,
    totalHandles: (k) => fn('totalHandles')(k) as Promise<string[]>,
    openMarket: (k, at) => fn('openMarket')(k, at) as Promise<Tx>,
    close: (k) => fn('close')(k) as Promise<Tx>,
    revealTotals: (k, clear, proof) => fn('revealTotals')(k, clear, proof) as Promise<Tx>,
    resolve: (k, side) => fn('resolve')(k, side) as Promise<Tx>,
  };
  return new ContractPredictionOperator(contract, nodeRelayer(cfg.rpcUrl, env.ZAMA_RELAYER_URL?.trim() || undefined), operatorQueue(wallet.address));
}
