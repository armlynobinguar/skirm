// Credits, model cost per call, markup, holds and charges. Formulas §2, §3, §9.
import { DEFAULTS } from './config';

const EPS = 1e-9;

/** ceil that ignores binary float noise (0.1 × 30 = 3.0000000000000004 → 3). */
export function ceilEps(x: number): number {
  return Math.ceil(x - EPS);
}

/** floor that ignores binary float noise (0.29 × 100 = 28.999999999999996 → 29). */
export function floorEps(x: number): number {
  return Math.floor(x + EPS);
}

function assertCrew(n: number): void {
  if (!Number.isInteger(n) || n < 1)
    throw new RangeError(`crew size must be an integer ≥ 1, got ${n}`);
}

// ---------- §3 crew price ----------

/** m_k = 1 + a(k − 1), k counted from 1 in deploy order. */
export function priceWeight(k: number, a: number = DEFAULTS.crew.extraAgentStep): number {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`agent position must be ≥ 1, got ${k}`);
  return 1 + a * (k - 1);
}

/** S(n) = n + a·n(n − 1)/2: 1, 2.5, 4.5 for 1 to 3 agents. */
export function crewFactor(n: number, a: number = DEFAULTS.crew.extraAgentStep): number {
  assertCrew(n);
  return n + (a * n * (n - 1)) / 2;
}

// ---------- §2 hold, charge, refund ----------

/** H = ceil(L · S(n)): worst case, every agent to the step limit. */
export function holdCredits(stepLimit: number, agents: number, a?: number): number {
  return ceilEps(stepLimit * crewFactor(agents, a));
}

/**
 * Q = ceil(Σ m_k · t_k). `ticksPerAgent[k-1]` = charged turns of the k-th agent in deploy order
 * (a lost agent stops adding turns).
 */
export function chargeCredits(ticksPerAgent: readonly number[], a?: number): number {
  let sum = 0;
  ticksPerAgent.forEach((t, i) => {
    sum += priceWeight(i + 1, a) * t;
  });
  return ceilEps(sum);
}

export function refundCredits(hold: number, charged: number): number {
  return hold - charged;
}

/** Credits from a top-up: floor(D_NEAR · X / p). */
export function creditsFromTopUp(
  near: number,
  usdPerNear: number,
  priceUsd: number = DEFAULTS.credits.priceUsd,
): number {
  return floorEps((near * usdPerNear) / priceUsd);
}

// ---------- §2 cost per call ----------

export interface CostRates {
  /** c_H: Haiku actor turn. */
  haiku: number;
  /** c_P: one planner call. */
  planner: number;
}

/** USD per call from token counts and USD-per-MTok prices (config §10 tokens.*, price.*). */
export function costRates(cfg = DEFAULTS): CostRates {
  const { tokens, price } = cfg;
  const h = price.haiku;
  return {
    haiku:
      (tokens.actorStaticCached * h.cacheHit +
        tokens.actorDynamic * h.input +
        tokens.actorOutputCap * h.output) /
      1e6,
    planner:
      (tokens.actorStaticCached * h.cacheHit +
        tokens.plannerDynamic * h.input +
        tokens.planOutput * h.output) /
      1e6,
  };
}

export const COST_RATES: Readonly<CostRates> = Object.freeze(costRates());

/** μ = p / c_eff. */
export function markup(
  costPerTurnUsd: number,
  priceUsd: number = DEFAULTS.credits.priceUsd,
): number {
  return priceUsd / costPerTurnUsd;
}

/** g = 1 − 1/μ. */
export function grossMargin(mu: number): number {
  return 1 - 1 / mu;
}

// ---------- §9 repricing ----------

export interface RepriceOptions {
  priceUsd?: number;
  markupTarget?: number;
  stepUsd?: number;
}

/**
 * p_new = step · ceil(μ_target · c_measured / step) when p / c_measured < μ_target; otherwise p
 * is kept.
 */
export function repriceCredit(costMeasured: number, opts: RepriceOptions = {}): number {
  const p = opts.priceUsd ?? DEFAULTS.credits.priceUsd;
  const target = opts.markupTarget ?? DEFAULTS.credits.markupTarget;
  const step = opts.stepUsd ?? DEFAULTS.credits.repriceStepUsd;
  if (p / costMeasured >= target) return p;
  const units = ceilEps((target * costMeasured) / step);
  // Strip float noise from units × step (21 × 0.0001 = 0.0021000000000000003).
  return Number((units * step).toPrecision(12));
}
