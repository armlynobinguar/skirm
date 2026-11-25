// Confidential spectator predictions on MatchPredictions (packages/fhevm, Sepolia), behind
// NEXT_PUBLIC_ZAMA_ENABLED: the contract calls, the encrypt / decrypt steps and the pure helpers the
// live "Predict 🔒" panel and the debrief's "Claim 🔒" are built from.
//
// Spectator: make MatchPredictions a cSKIRM operator once, encrypt the side (a bool: team B?) and the
// amount under one proof in this tab, predict. While betting is open the page can only show "N sealed
// predictions" (a count). The server closes betting at tick 30 and opens the two totals with a KMS
// proof: then the odds show. After the match the winner claims: the payout is a ciphertext only the
// claimant can decrypt (a loser's is an encrypted 0, which looks the same on chain).
import { MatchPredictionsAbi } from '@skirm/fhevm/generated';
import { PREDICTION_CLOSE_TICK, predictionOdds, predictionStatus, type PredictionStatus } from '@skirm/shared';
import { Contract, id as keccakUtf8, type ContractRunner } from 'ethers';
import { zamaConfig, type HexAddress } from '@/lib/zama/config';
import { MAX_U64, checkUint, isZeroHandle, toHex, userDecrypt, type Hex, type TypedDataSigner } from '@/lib/zama/fhe';
import { ZamaWalletError } from '@/lib/zama/wallet';

/** How often the panel re-reads the market. */
export const PREDICTION_POLL_MS = 6_000;

/** The MatchPredictions address, or a not_deployed error. */
export function predictionsAddress(): HexAddress {
  const address = zamaConfig.contracts.predictions;
  if (!address) {
    throw new ZamaWalletError('not_deployed', 'MatchPredictions is not deployed yet: deploy packages/fhevm to Sepolia or set NEXT_PUBLIC_ZAMA_PREDICTIONS_ADDRESS.');
  }
  return address;
}

/** The match's on-chain key: keccak256 of its id (the server and SkirmMatch use the same). */
export const marketKey = (matchId: string): Hex => keccakUtf8(matchId) as Hex;

/** MatchPredictions.getMarket, as the web reads it. */
export interface ChainMarket {
  status: PredictionStatus;
  /** Unix seconds. */
  closesAt: number;
  /** 0 (team A) or 1 (team B) once resolved, else 255. */
  winner: number;
  feeBps: number;
  predictors: number;
  /** Public once revealed (0 before). */
  totalA: bigint;
  totalB: bigint;
}

/** The caller's sealed prediction handles. */
export interface MyPrediction {
  side: Hex;
  stake: Hex;
  payout: Hex;
  claimed: boolean;
}

/** An encrypted side + amount under one proof. */
export interface EncryptedPrediction {
  side: Hex;
  amount: Hex;
  inputProof: Hex;
}

type Tx = { hash: string; wait: () => Promise<unknown> };

/** The MatchPredictions calls the page needs (an interface, so tests fake the chain). */
export interface PredictionsApi {
  get(matchId: string): Promise<ChainMarket>;
  mine(matchId: string, who: string): Promise<MyPrediction>;
  predict(matchId: string, enc: EncryptedPrediction): Promise<string>;
  claim(matchId: string): Promise<string>;
}

/** getMarket's tuple as ChainMarket. */
export function parseMarket(m: { closesAt: bigint; status: bigint; winner: bigint; feeBps: bigint; predictors: bigint; totalA: bigint; totalB: bigint }): ChainMarket {
  return {
    status: predictionStatus(m.status),
    closesAt: Number(m.closesAt),
    winner: Number(m.winner),
    feeBps: Number(m.feeBps),
    predictors: Number(m.predictors),
    totalA: BigInt(m.totalA),
    totalB: BigInt(m.totalB),
  };
}

/** MatchPredictions through ethers: reads on `runner`, writes signed by it (a JsonRpcSigner). */
export function predictionsApi(runner: ContractRunner, address: string = predictionsAddress()): PredictionsApi {
  const c = new Contract(address, MatchPredictionsAbi, runner);
  const send = async (fn: string, ...args: unknown[]) => {
    const tx = (await c.getFunction(fn)(...args)) as Tx;
    await tx.wait();
    return tx.hash;
  };
  return {
    get: async (matchId) => parseMarket(await c.getFunction('getMarket')(marketKey(matchId))),
    async mine(matchId, who) {
      const [side, stake, payout, claimed] = (await c.getFunction('predictionOf')(marketKey(matchId), who)) as [string, string, string, boolean];
      return { side: side as Hex, stake: stake as Hex, payout: payout as Hex, claimed: !!claimed };
    },
    predict: (matchId, enc) => send('predict', marketKey(matchId), enc.side, enc.amount, enc.inputProof),
    claim: (matchId) => send('claim', marketKey(matchId)),
  };
}

/** The relayer instance surface the encrypt step uses. */
interface EncryptInstance {
  createEncryptedInput(contract: string, user: string): {
    addBool(v: boolean): unknown;
    add64(v: bigint): unknown;
    encrypt(): Promise<{ handles: (Uint8Array | string)[]; inputProof: Uint8Array | string }>;
  };
}

/** Encrypts the side (true backs team B) and the amount under one proof for `contract`, sent by `user`. */
export async function encryptPrediction(instance: EncryptInstance, contract: string, user: string, team: 'A' | 'B', amount: bigint): Promise<EncryptedPrediction> {
  const v = checkUint(amount, MAX_U64, 'encryptPrediction');
  const input = instance.createEncryptedInput(contract, user);
  input.addBool(team === 'B');
  input.add64(v);
  const { handles, inputProof } = await input.encrypt();
  return { side: toHex(handles[0]!), amount: toHex(handles[1]!), inputProof: toHex(inputProof) };
}

/** What a viewer sees of the market right now. */
export type MarketPhase =
  /** No market on this match (off, or not a PvP match). */
  | 'none'
  /** Predictions are open. */
  | 'open'
  /** Closed; the totals wait for their KMS-checked reveal. */
  | 'closing'
  /** Totals and odds public; the match is still on. */
  | 'revealed'
  | 'resolved'
  | 'void';

/** Betting stops at the close tick on screen even before the server's close lands on chain. */
export function marketPhase(m: Pick<ChainMarket, 'status' | 'closesAt'> | null, tick: number, nowSec: number, closeTick = PREDICTION_CLOSE_TICK): MarketPhase {
  if (!m || m.status === 'none') return 'none';
  if (m.status === 'open') return tick >= closeTick || nowSec >= m.closesAt ? 'closing' : 'open';
  if (m.status === 'closed') return 'closing';
  return m.status;
}

/** "No predictions yet", "1 sealed prediction", "4 sealed predictions". */
export function sealedPredictionsLabel(n: number): string {
  if (n === 0) return 'No predictions yet';
  return `${n} sealed prediction${n === 1 ? '' : 's'}`;
}

/** "×1.50" decimal odds, "—" for a side nobody backed. */
export function oddsLabel(odds: number | null): string {
  return odds === null ? '—' : `×${odds.toFixed(2)}`;
}

/** Both sides' public odds once the totals are revealed. */
export const marketOdds = (m: Pick<ChainMarket, 'totalA' | 'totalB'>) => predictionOdds(m.totalA, m.totalB);

/** The caller's prediction in the clear (only its wallet holds ACL access). */
export interface RevealedPrediction {
  team: 'A' | 'B';
  stake: bigint;
  /** Null before claim. */
  payout: bigint | null;
}

/** User-decrypts the caller's side, stake and (once claimed) payout; null if it never predicted. */
export async function revealMine(
  instance: Parameters<typeof userDecrypt>[0],
  signer: TypedDataSigner,
  contract: string,
  mine: MyPrediction,
): Promise<RevealedPrediction | null> {
  if (isZeroHandle(mine.stake)) return null;
  const refs = [mine.side, mine.stake, ...(isZeroHandle(mine.payout) ? [] : [mine.payout])].map((handle) => ({ handle, contractAddress: contract }));
  const [side, stake, payout] = await userDecrypt(instance, signer, refs);
  if (typeof stake !== 'bigint') throw new TypeError('The stake handle is not an integer ciphertext');
  return { team: side === true || side === 1n ? 'B' : 'A', stake, payout: typeof payout === 'bigint' ? payout : null };
}
