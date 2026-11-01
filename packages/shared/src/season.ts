// v2 seasons: points per ranked result and the prize split. The split mirrors the seasons
// contract (contracts/seasons SPLIT_BPS): place i gets floor(pool · splitBps[i] / 10⁴), and
// whatever no place takes (empty places, rounding dust) is carried to the next season.
import { DEFAULTS } from './config';

/** DEFAULTS.season under its own name: days, splitBps, feeShareBps, points. */
export const SEASON = DEFAULTS.season;

const BPS = 10_000n;

export type SeasonOutcome = 'win' | 'draw' | 'loss';

/** Standings points for one ranked v2 result. */
export function seasonPoints(outcome: SeasonOutcome): number {
  return SEASON.points[outcome];
}

export interface SeasonPayout {
  /** 1-based place. */
  rank: number;
  accountId: string;
  bps: number;
  amountYocto: bigint;
}

/**
 * Prizes for the final standings, best first (only the first splitBps.length entrants are paid).
 * Floor maths per place, so Σ amountYocto + carry = pool exactly.
 */
export function seasonPayouts(
  poolYocto: bigint,
  entrants: readonly { accountId: string }[],
): { payouts: SeasonPayout[]; carry: bigint } {
  if (poolYocto < 0n) throw new RangeError('pool must be ≥ 0');
  const payouts = entrants.slice(0, SEASON.splitBps.length).map((e, i) => {
    const bps = SEASON.splitBps[i]!;
    return {
      rank: i + 1,
      accountId: e.accountId,
      bps,
      amountYocto: (poolYocto * BigInt(bps)) / BPS,
    };
  });
  const paid = payouts.reduce((sum, p) => sum + p.amountYocto, 0n);
  return { payouts, carry: poolYocto - paid };
}

/** The pool's share of one market fee: floor(fee · feeShareBps / 10⁴), as the market contract sends it. */
export function seasonFeeShare(feeYocto: bigint): bigint {
  return (feeYocto * BigInt(SEASON.feeShareBps)) / BPS;
}
