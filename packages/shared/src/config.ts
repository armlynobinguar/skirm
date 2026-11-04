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
    /** K for a player's placement matches (the first `ranked.placementMatches`, see below). */
    kPlacement: 48,
    kProvisional: 32,
    provisionalMatches: 20,
    k: 16,
    floor: 100,
  },
  /**
   * Ranked tiers from Elo (lowest first, `min` is the tier floor). A tier is shown once a player has
   * played `placementMatches` ranked matches; until then K is `elo.kPlacement`. Inactive players in
   * `decay.fromTier` or above lose `decay.amount` Elo per `decay.days` without a ranked match, never
   * below the floor of the tier they are in (the worker's `ranked` decay job). The skill leaderboard
   * ranks win rate over skills with at least `skillMinMatches` ranked matches.
   */
  ranked: {
    tiers: [
      { name: 'Bronze', min: 0 },
      { name: 'Silver', min: 1100 },
      { name: 'Gold', min: 1300 },
      { name: 'Platinum', min: 1500 },
      { name: 'Diamond', min: 1700 },
      { name: 'Master', min: 1900 },
    ] as { name: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master'; min: number }[],
    placementMatches: 5,
    decay: { fromTier: 'Diamond' as const, days: 14, amount: 25 },
    skillMinMatches: 10,
  },
  /**
   * v2 talk tiers, integer credits per 100 agent-ticks. Quiet makes the same per-tick model calls
   * as Standard, so it costs the same; its value is stealth, not price. Placeholders until measured:
   * GET /ops/talk-rates turns the model spend of ended matches into suggested rates (measureTalkRates).
   */
  talk: {
    ratePer100: { quiet: 20, standard: 20, open: 40 },
  },
  /**
   * v2 seasons: 14 days, standings from ranked v2 matches only, top 10 paid 30/20/15 then 5 × 7
   * (bps, the seasons contract's SPLIT_BPS). The pool is funded NEAR plus this share of market fees.
   */
  /**
   * Live commands: directives a player sends one agent or the whole crew during a match (presets
   * plus optional free text). `perMatch` per crew; at most one every `cooldownTicks`; each holds in
   * the agents' prompts for `activeTicks`; free text up to `maxChars` (it passes the speech filter).
   */
  commands: {
    perMatch: 3,
    cooldownTicks: 5,
    activeTicks: 10,
    maxChars: 80,
  },
  season: {
    days: 14,
    splitBps: [3000, 2000, 1500, 500, 500, 500, 500, 500, 500, 500],
    feeShareBps: 3000,
    points: { win: 25, draw: 12, loss: 5 },
  },
};

export type SkirmConfig = DeepReadonly<typeof defaults>;

export const DEFAULTS: SkirmConfig = deepFreeze(defaults);
