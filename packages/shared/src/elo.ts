// Elo per agent on the ranked PvP ladder. Formulas §7.
import { DEFAULTS } from './config';

/** S_A: 1 win, 0.5 draw, 0 loss. */
export type EloResult = 1 | 0.5 | 0;

/** E_A = 1 / (1 + 10^((R_B − R_A)/400)). */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * K: 48 for a player's 5 placement matches, 32 up to their 20th ranked match, then 16.
 * `rankedMatchesPlayed` counts matches before this one.
 */
export function kFactor(
  rankedMatchesPlayed: number,
  cfg = DEFAULTS.elo,
  placementMatches: number = DEFAULTS.ranked.placementMatches,
): number {
  if (rankedMatchesPlayed < placementMatches) return cfg.kPlacement;
  return rankedMatchesPlayed < cfg.provisionalMatches ? cfg.kProvisional : cfg.k;
}

/** Rating change K·(S_A − E_A), rounded half up (Math.floor(x + 0.5)). */
export function eloDelta(ratingA: number, ratingB: number, result: EloResult, k: number): number {
  return Math.floor(k * (result - expectedScore(ratingA, ratingB)) + 0.5);
}

/**
 * Clamps a rating change to ±`max` (the registry contract's `|delta| ≤ 32`). Placement K is 48, so
 * an unclamped delta could exceed what the chain accepts and the match would never be recorded.
 */
export function clampEloDelta(delta: number, max: number = DEFAULTS.elo.maxDelta): number {
  return Math.max(-max, Math.min(max, delta));
}

/** Integer rating after a change, never below the floor. */
export function applyElo(
  rating: number,
  delta: number,
  floor: number = DEFAULTS.elo.floor,
): number {
  return Math.max(floor, rating + delta);
}

/** R_crew = mean of the crew's agent ratings. */
export function crewRating(ratings: readonly number[]): number {
  if (ratings.length === 0) throw new RangeError('crew has no agents');
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

export interface EloAgent {
  rating: number;
  /** Ranked matches played before this one. */
  rankedMatches: number;
}

export interface EloAgentUpdate {
  before: number;
  delta: number;
  after: number;
}

/**
 * Updates every agent of both crews after a ranked match. Each agent gets K·(S − E) with E from
 * the crew means; with equal K across the crew every agent gets the same change. The change is
 * clamped to ±`cfg.maxDelta` and then to the floor.
 */
export function updateMatch(
  sideA: readonly EloAgent[],
  sideB: readonly EloAgent[],
  resultA: EloResult,
  cfg = DEFAULTS.elo,
): { a: EloAgentUpdate[]; b: EloAgentUpdate[] } {
  const rA = crewRating(sideA.map((x) => x.rating));
  const rB = crewRating(sideB.map((x) => x.rating));
  const resultB = (1 - resultA) as EloResult;
  const upd = (
    agent: EloAgent,
    mine: number,
    theirs: number,
    result: EloResult,
  ): EloAgentUpdate => {
    // Clamp before applying, so the stored delta, the stored rating and the registry write agree.
    const delta = clampEloDelta(eloDelta(mine, theirs, result, kFactor(agent.rankedMatches, cfg)), cfg.maxDelta);
    const after = applyElo(agent.rating, delta, cfg.floor);
    return { before: agent.rating, delta: after - agent.rating, after };
  };
  return {
    a: sideA.map((x) => upd(x, rA, rB, resultA)),
    b: sideB.map((x) => upd(x, rB, rA, resultB)),
  };
}
