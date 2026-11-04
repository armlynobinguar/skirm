// Ranked tiers (Bronze to Master) from a player's Elo, shown once their placement matches are
// played, and the Elo decay of inactive high-tier players. Thresholds: DEFAULTS.ranked.
import { DEFAULTS } from './config';

export type RankedTierName = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master';

type RankedConfig = typeof DEFAULTS.ranked;

/** Lowest tier first, as configured. */
export const RANKED_TIERS: readonly { readonly name: RankedTierName; readonly min: number }[] =
  DEFAULTS.ranked.tiers;

export interface EloTier {
  name: RankedTierName;
  /** The tier floor (lowest Elo in it). */
  min: number;
  /** The next tier and where it starts; null at the top. */
  next: RankedTierName | null;
  nextAt: number | null;
}

/** The tier an Elo rating falls in, placements aside. */
export function tierOf(elo: number, cfg: RankedConfig = DEFAULTS.ranked): EloTier {
  const tiers = cfg.tiers;
  let i = tiers.length - 1;
  while (i > 0 && elo < tiers[i]!.min) i--;
  const t = tiers[i]!;
  const n = tiers[i + 1];
  return { name: t.name, min: t.min, next: n?.name ?? null, nextAt: n?.min ?? null };
}

/** A player's ranked tier as the API and the client show it. */
export interface PlayerTier {
  /** The tier; null while placement matches are left. */
  tier: RankedTierName | null;
  /** Ranked matches counted towards placement (at most `placementMatches`). */
  placementsPlayed: number;
  placementMatches: number;
  /** Elo where the next tier starts; null at the top and during placement. */
  nextAt: number | null;
}

export function playerTier(
  elo: number,
  rankedMatches: number,
  cfg: RankedConfig = DEFAULTS.ranked,
): PlayerTier {
  const placed = rankedMatches >= cfg.placementMatches;
  const t = tierOf(elo, cfg);
  return {
    tier: placed ? t.name : null,
    placementsPlayed: Math.min(rankedMatches, cfg.placementMatches),
    placementMatches: cfg.placementMatches,
    nextAt: placed ? t.nextAt : null,
  };
}

/** Lowest Elo the decay applies to: the floor of `decay.fromTier`. */
export function decayFloorElo(cfg: RankedConfig = DEFAULTS.ranked): number {
  const t = cfg.tiers.find((x) => x.name === cfg.decay.fromTier);
  if (!t) throw new RangeError(`unknown decay tier ${cfg.decay.fromTier}`);
  return t.min;
}

/**
 * Elo after one decay step: `amount` less, never below the floor of the tier the player is in. A
 * player under `decay.fromTier` (or still placing) keeps their Elo.
 */
export function decayedElo(
  elo: number,
  rankedMatches: number,
  amount: number = DEFAULTS.ranked.decay.amount,
  cfg: RankedConfig = DEFAULTS.ranked,
): number {
  if (rankedMatches < cfg.placementMatches || elo < decayFloorElo(cfg)) return elo;
  return Math.max(tierOf(elo, cfg).min, elo - Math.max(0, Math.floor(amount)));
}

export interface RankedDecayConfig {
  /** Days without a ranked result (or a decay step) before the next step; 0 turns decay off. */
  days: number;
  /** Elo one step takes; 0 turns decay off. */
  amount: number;
}

/**
 * Decay settings from RANKED_DECAY_DAYS / RANKED_DECAY_AMOUNT (whole numbers, at least 0), the
 * DEFAULTS.ranked.decay values when unset or empty. Throws naming the variable on a bad value.
 */
export function rankedDecayFromEnv(env: Record<string, string | undefined>): RankedDecayConfig {
  const read = (name: string, fallback: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`${name} must be a whole number of at least 0`);
    return n;
  };
  return {
    days: read('RANKED_DECAY_DAYS', DEFAULTS.ranked.decay.days),
    amount: read('RANKED_DECAY_AMOUNT', DEFAULTS.ranked.decay.amount),
  };
}
