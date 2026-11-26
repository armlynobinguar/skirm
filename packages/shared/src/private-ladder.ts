// Private MMR (Zama FHEVM, packages/fhevm PrivateLadder.sol), in plain TypeScript: the ladder's
// constants, the public tier names by index, and the banded Elo step the contract evaluates on
// ciphertexts, run here on plaintexts (tests, docs, and the comparison with the real Elo of elo.ts).
// It has no runtime imports (packages/fhevm's Hardhat tests load it as CommonJS); the tier
// thresholds equal DEFAULTS.ranked.tiers, which the shared tests check.

/** PrivateLadder.NO_SIDE: a draw (no rating change). */
export const LADDER_NO_SIDE = 255;
/** Lowest starting rating; a new player starts somewhere in START .. START + START_DITHER - 1. */
export const LADDER_START_RATING = 1168;
export const LADDER_START_DITHER = 64;
/** Rating clamps. */
export const LADDER_FLOOR = 100;
export const LADDER_CEILING = 3000;
/** The gap separating the three Elo bands. */
export const LADDER_BAND = 100;
/** Base steps per band, before the encrypted dither of 0 .. LADDER_DITHER - 1. */
export const LADDER_STEPS = { favoured: 7, even: 15, underdog: 23 } as const;
export const LADDER_DITHER = 4;
/** Default isCloseMatch window (the deploy script's LADDER_MATCH_WINDOW default). */
export const LADDER_MATCH_WINDOW = 200;

/** Tier names by the contract's tier index (0 .. 5), with the rating each starts at. */
export const LADDER_TIERS = [
  { name: 'Bronze', min: 0 },
  { name: 'Silver', min: 1100 },
  { name: 'Gold', min: 1300 },
  { name: 'Platinum', min: 1500 },
  { name: 'Diamond', min: 1700 },
  { name: 'Master', min: 1900 },
] as const;
export type LadderTierName = (typeof LADDER_TIERS)[number]['name'];

/** The tier a new player shows (START .. START + 63 is always Silver). */
export const LADDER_START_TIER = 1;

/** The tier name for a contract tier index, or null for an index out of range. */
export function ladderTierName(index: number | bigint): LadderTierName | null {
  return LADDER_TIERS[Number(index)]?.name ?? null;
}

/** The tier index a rating falls in (what the contract computes under FHE). */
export function ladderTierIndex(rating: number): number {
  let i = 0;
  for (let t = 1; t < LADDER_TIERS.length; t++) if (rating >= LADDER_TIERS[t]!.min) i = t;
  return i;
}

export type LadderBand = keyof typeof LADDER_STEPS;

/** The band of a winner against a loser. */
export function ladderBand(winner: number, loser: number): LadderBand {
  if (winner >= loser + LADDER_BAND) return 'favoured';
  if (loser >= winner + LADDER_BAND) return 'underdog';
  return 'even';
}

/**
 * Both ratings after `winner` beat `loser` with an encrypted dither of `dither` (0 .. 3): the winner
 * gains the step (at most CEILING), the loser loses it (at least FLOOR).
 */
export function ladderUpdate(winner: number, loser: number, dither: number): { winner: number; loser: number; step: number } {
  if (!Number.isInteger(dither) || dither < 0 || dither >= LADDER_DITHER) throw new RangeError(`dither must be 0..${LADDER_DITHER - 1}`);
  const step = LADDER_STEPS[ladderBand(winner, loser)] + dither;
  return { winner: Math.min(winner + step, LADDER_CEILING), loser: Math.max(loser, LADDER_FLOOR + step) - step, step };
}

/** The real Elo gain of a win, K * (1 - E), for comparison with the banded step (K = 32). */
export function realEloGain(winner: number, loser: number, k = 32): number {
  return k * (1 - 1 / (1 + 10 ** ((loser - winner) / 400)));
}
