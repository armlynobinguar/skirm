// Confidential spectator predictions (Zama FHEVM, packages/fhevm MatchPredictions.sol), in plain
// TypeScript: the status names, the tick the market closes at, and the pro-rata payout the contract
// computes on ciphertexts, run here on plaintexts (tests, the odds the UI shows once the totals are
// public). It has no runtime imports (packages/fhevm's Hardhat tests load it as CommonJS); the
// market key is keccak256 of the off-chain match id, taken by the caller (ethers `id()`).

/** MatchPredictions.Status, by index. */
export const PREDICTION_STATUSES = ['none', 'open', 'closed', 'revealed', 'resolved', 'void'] as const;
export type PredictionStatus = (typeof PREDICTION_STATUSES)[number];

/** The contract status name for a numeric status (unknown values read as 'none'). */
export function predictionStatus(n: number | bigint): PredictionStatus {
  return PREDICTION_STATUSES[Number(n)] ?? 'none';
}

/**
 * The match tick the game server closes betting at: early enough that nobody can predict on
 * late-game information (the match runs 90+ ticks), late enough for spectators to join in.
 */
export const PREDICTION_CLOSE_TICK = 30;

/** MatchPredictions.MAX_STAKE: the largest stake per prediction, in base units (100,000 cSKIRM). */
export const PREDICTION_MAX_STAKE = 100_000n * 10n ** 6n;
/** MatchPredictions.MAX_FEE_BPS. */
export const PREDICTION_MAX_FEE_BPS = 1000;
/** MatchPredictions.NO_SIDE: a draw or a void market. */
export const PREDICTION_NO_SIDE = 255;

/** The side index the contract stores for a team: A is 0, B is 1. */
export const predictionSide = (team: 'A' | 'B'): 0 | 1 => (team === 'A' ? 0 : 1);

/** What one prediction pays once the market is resolved (all amounts in base units). */
export interface PredictionPayout {
  /** stake * losing / winning, rounded down (0 for a loser). */
  winnings: bigint;
  /** feeBps of the winnings, rounded down (0 for a loser, or without a treasury). */
  fee: bigint;
  /** What `claim` sends: stake + winnings - fee for a winner, 0 for a loser. */
  payout: bigint;
}

/**
 * The payout MatchPredictions.claim computes under FHE: a winner gets its stake back plus its
 * pro-rata share of the losing side, minus the fee on that share; a loser gets 0. `winningTotal` 0
 * never reaches claim (the market is void then and everyone gets the stake back).
 */
export function predictionPayout(
  stake: bigint,
  won: boolean,
  winningTotal: bigint,
  losingTotal: bigint,
  feeBps: number,
  hasTreasury = true,
): PredictionPayout {
  if (!won) return { winnings: 0n, fee: 0n, payout: 0n };
  if (winningTotal <= 0n) throw new Error('winningTotal must be positive');
  const winnings = losingTotal === 0n ? 0n : (stake * losingTotal) / winningTotal;
  const fee = feeBps > 0 && hasTreasury && losingTotal !== 0n ? (winnings * BigInt(feeBps)) / 10_000n : 0n;
  return { winnings, fee, payout: stake + winnings - fee };
}

/**
 * Decimal odds per side once the totals are public: what 1 staked on that side returns if it wins,
 * before the fee (pool / side total). Null for a side nobody backed.
 */
export function predictionOdds(totalA: bigint, totalB: bigint): { A: number | null; B: number | null } {
  const pool = Number(totalA + totalB);
  return {
    A: totalA > 0n ? pool / Number(totalA) : null,
    B: totalB > 0n ? pool / Number(totalB) : null,
  };
}
