// Sealed match settlement (Zama FHEVM on Sepolia): the game server's write side of
// packages/fhevm SkirmMatch.sol. Once a sealed match ends, the server posts the result with
// `settle(matchId, winnerSeat, logHash)` from the operator account: it anchors the head of the
// match's hash-chained log on chain (the verification anchor) and pays the encrypted cSKIRM escrow
// out (the pot to the winner, both stakes back on a draw). The amounts stay encrypted; the server
// never sees them either.
//
// Gated by ZAMA_ENABLED. Env: ZAMA_OPERATOR_PRIVATE_KEY (optional: without it nothing settles and
// a warning is logged; the players can still get their stakes back with refundUnsettled after the
// timeout), SEPOLIA_RPC_URL, ZAMA_MATCH_ADDRESS (see sealed-match.ts). The key is never logged.
import { SkirmMatchAbi, sepolia } from '@skirm/fhevm/generated';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { SEALED_MATCH_STATUSES, sealedMatchKey, zamaServerConfig, type ZamaServerConfig } from './sealed-match';

/** SkirmMatch.NO_SIDE: the seat a draw is settled with. */
export const DRAW_SEAT = 255;

/** What happened to one settlement. */
export type SettleOutcome =
  | { status: 'settled'; txHash: string }
  /** The match is not in a state settle accepts (e.g. never revealed, or already settled). */
  | { status: 'skipped'; reason: string };

/** Posts a sealed match's result on chain (mocked in tests). */
export interface MatchSettler {
  /** `winner` null is a draw; `logHash` is the log's head hash (64 hex chars, 0x optional). */
  settle(matchId: string, winner: 'A' | 'B' | null, logHash: string): Promise<SettleOutcome>;
}

/** The contract's winner seat for an off-chain winner: A is 0, B is 1, a draw NO_SIDE. */
export function winnerSeat(winner: 'A' | 'B' | null): number {
  return winner === 'A' ? 0 : winner === 'B' ? 1 : DRAW_SEAT;
}

/** The log head hash as the bytes32 settle takes; throws on anything but 32 bytes of hex. */
export function logHashBytes32(logHash: string): string {
  const hex = logHash.startsWith('0x') ? logHash.slice(2) : logHash;
  if (!/^[0-9a-fA-F]{64}$/.test(hex) || /^0+$/.test(hex)) throw new Error('log hash must be 32 nonzero bytes of hex');
  return `0x${hex.toLowerCase()}`;
}

/** The narrow contract surface the settler uses (an interface, so tests fake the chain). */
export interface SettleContract {
  getMatch(key: string): Promise<{ status: bigint }>;
  settle(key: string, seat: number, logHash: string): Promise<{ hash: string; wait(): Promise<unknown> }>;
}

/** Settles through a SkirmMatch contract (an ethers Contract bound to the operator wallet, or a fake). */
export class ContractMatchSettler implements MatchSettler {
  constructor(private readonly contract: SettleContract) {}

  async settle(matchId: string, winner: 'A' | 'B' | null, logHash: string): Promise<SettleOutcome> {
    const key = sealedMatchKey(matchId);
    const anchor = logHashBytes32(logHash);
    const m = await this.contract.getMatch(key);
    const status = SEALED_MATCH_STATUSES[Number(m.status)] ?? 'none';
    if (status !== 'revealed') return { status: 'skipped', reason: `match is ${status} on chain` };
    const tx = await this.contract.settle(key, winnerSeat(winner), anchor);
    await tx.wait();
    return { status: 'settled', txHash: tx.hash };
  }
}

const PRIVATE_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;

interface SettlerLog {
  warn(msg: string): void;
}

/**
 * The settler when the feature is on, SkirmMatch is deployed and ZAMA_OPERATOR_PRIVATE_KEY holds a
 * key; else null (a missing or malformed key logs a warning, never the key itself).
 */
export function createMatchSettler(
  env: Record<string, string | undefined> = process.env,
  log: SettlerLog = console,
  cfg: ZamaServerConfig = zamaServerConfig(env),
): MatchSettler | null {
  if (!cfg.enabled || !cfg.matchAddress) return null;
  const key = env.ZAMA_OPERATOR_PRIVATE_KEY?.trim();
  if (!key) {
    log.warn('zama: ZAMA_OPERATOR_PRIVATE_KEY is not set, sealed matches will not be settled on chain');
    return null;
  }
  if (!PRIVATE_KEY_RE.test(key)) {
    log.warn('zama: ZAMA_OPERATOR_PRIVATE_KEY is not a 32-byte hex key, sealed matches will not be settled on chain');
    return null;
  }
  const wallet = new Wallet(key.startsWith('0x') ? key : `0x${key}`, new JsonRpcProvider(cfg.rpcUrl, sepolia.chainId, { staticNetwork: true }));
  const contract = new Contract(cfg.matchAddress, SkirmMatchAbi, wallet);
  return new ContractMatchSettler({
    getMatch: (k) => contract.getFunction('getMatch')(k) as Promise<{ status: bigint }>,
    settle: (k, seat, hash) => contract.getFunction('settle')(k, seat, hash) as Promise<{ hash: string; wait(): Promise<unknown> }>,
  });
}
