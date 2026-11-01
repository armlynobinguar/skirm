// Formulas §10 parameter summary as one typed, frozen object.
// Keys follow the doc (`credits.priceUsd` → DEFAULTS.credits.priceUsd). Values marked "proposed"
// in the doc are the proposed defaults. A few inputs used by §4 worked examples but missing from
// the §10 table (payer share, spend, days per month) live under `model` and are marked below.

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

function deepFreeze<T>(obj: T): DeepReadonly<T> {
  if (obj && typeof obj === 'object') {
    for (const value of Object.values(obj as Record<string, unknown>)) deepFreeze(value);
    Object.freeze(obj);
  }
  return obj as DeepReadonly<T>;
}

const defaults = {
  crew: {
    maxAgents: 3,
    /** a in m_k = 1 + a(k − 1): weights 1, 1.5, 2. */
    extraAgentStep: 0.5,
  },
  tokens: {
    actorStaticCached: 2500,
    actorDynamic: 1000,
    actorOutputCap: 60,
    plannerDynamic: 1500,
    planOutput: 300,
  },
  /** USD per million tokens. */
  price: {
    haiku: { input: 0.1, cacheHit: 0.01, output: 0.5 },
  },
  credits: {
    /** One credit = one base agent turn. */
    priceUsd: 0.001,
    /** Hold before a match: stepLimit × S(n) credits. */
    preauth: 'stepLimitTimesCrewFactor' as const,
    markupTarget: 5,
    repriceStepUsd: 0.0001,
    repriceWindowDays: 7,
    /** Credits per NEAR. priceUsd 0.001 assumes NEAR = $1; the server's CREDITS_PER_NEAR reads it. */
    perNear: 1000,
  },
  free: {
    dailyBudgetSafety: 0.8,
    /** Free credits per player per day: one 2-agent ranked match or two 1-agent matches. */
    dailyCredits: 60,
    resetUtc: '00:00',
  },
  model: {
    dailyPlayers: 1000,
    fixedInfraUsdMonth: 150,
    feeIncomeUsdMonth: 200,
    /** §4 worked example inputs (not in the §10 table). */
    payerShare: 0.05,
    spendUsdMonth: 10,
    daysPerMonth: 30,
  },
  market: {
    feeBps: 500,
    royaltyBps: 500,
    royaltyMaxBps: 1000,
  },
  elo: {
    start: 1200,
    kProvisional: 32,
    provisionalMatches: 20,
    k: 16,
    floor: 100,
  },
  /**
   * v2 talk tiers, integer credits per 100 agent-ticks. Quiet makes the same per-tick model calls
   * as Standard, so it costs the same; its value is stealth, not price.
   */
  talk: {
    ratePer100: { quiet: 20, standard: 20, open: 40 },
  },
  /**
   * v2 seasons: 14 days, standings from ranked v2 matches only, top 10 paid 30/20/15 then 5 × 7
   * (bps, the seasons contract's SPLIT_BPS). The pool is funded NEAR plus this share of market fees.
   */
  season: {
    days: 14,
    splitBps: [3000, 2000, 1500, 500, 500, 500, 500, 500, 500, 500],
    feeShareBps: 3000,
    points: { win: 25, draw: 12, loss: 5 },
  },
};

export type SkirmConfig = DeepReadonly<typeof defaults>;

export const DEFAULTS: SkirmConfig = deepFreeze(defaults);
