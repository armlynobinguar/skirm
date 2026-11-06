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
    /**
     * Largest change one ranked match may apply. The registry contract rejects `|delta| > 32`
     * (contracts/registry ELO_MAX_DELTA), so a placement K of 48 is clamped to this bound.
     */
    maxDelta: 32,
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
   * Writers' skill test bench: headless runs against the greedy bot, free on the greedy brain (with a
   * model a run pays one Standard agent at the talk rate). At most this many runs per account per
   * rolling hour (the api's BENCH_RUNS_PER_HOUR overrides it).
   */
  bench: {
    runsPerHour: 20,
  },
  /**
   * Daily challenge: one challenge per UTC day (@skirm/engine dailyChallenge), played headless
   * against the greedy bot like a bench run (free on the greedy brain, the crew's talk rate with a
   * model). Attempts that played count towards the cap per account per day (the api's
   * DAILY_ATTEMPTS overrides it); the board shows the top `boardSize` best attempts.
   */
  daily: {
    attemptsPerDay: 3,
    boardSize: 50,
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
  /**
   * Bring your own agent (docs/external-agents.md): a player's own program plays one of their
   * agents in casual and practice matches. Each tick it has `timeoutMs` to answer (under the 1.5 s
   * action deadline) or the greedy brain plays that tick; webhook replies over `maxResponseBytes`
   * count as a miss. At most `perAccount` registered per player.
   */
  external: {
    timeoutMs: 1200,
    maxResponseBytes: 16_384,
    perAccount: 5,
  },
  /**
   * Draft mode (a casual queue): after accept each crew in turn bans one of the rival's equipped
   * skills (by name and id), `bansPerSide` each, crew A first. A ban step lasts `stepMs`; one not
   * answered in time passes. A banned skill is unequipped from the rival crew for that match only.
   */
  draft: {
    bansPerSide: 1,
    stepMs: 15_000,
  },
  /**
   * Crew playbooks: one crew-level strategy per player (who does what, when to regroup, goal or deny),
   * picked at lock-in. Text up to `maxChars` (sealed in the vault like skill prompts), names up to
   * `nameMaxChars`, at most `maxSaved` per player. The planner reads it whole; each actor gets one line
   * of at most `actorLineChars`.
   */
  playbooks: {
    maxChars: 800,
    nameMaxChars: 32,
    maxSaved: 5,
    actorLineChars: 160,
  },
  /**
   * Agent roles (skill-roles.ts AGENT_ROLES). Ranked plays the six original roles only (Builder,
   * Digger, Firefighter, Scout, Runner, Hauler) until `rankedNewRoles` is turned on: a ranked crew
   * with a Medic, Engineer, Saboteur or Courier is refused at queue and lock-in, and the engine
   * refuses to create such a ranked match. Casual, practice, lobbies, campaign and puzzles play all ten.
   */
  roles: {
    rankedNewRoles: false,
  },
  /**
   * Agent progression (progression.ts): each agent earns XP from the matches it plays to the end
   * (ranked and casual; practice against the bot and void matches give none, as for the agent's
   * record). Per match: the kind's base, plus `win` or `draw`, plus `perDelivered` per item it
   * delivered (at most `maxDelivered` items count). Level L → L+1 costs `levelBase + levelStep ×
   * (L − 1)` XP, up to `maxLevel`. At each of `traitLevels` the owner picks one trait (engine
   * traits.ts: one small step on one stat), at most `maxTraits` per agent. Ranked plays every agent
   * on its base stats unless `rankedTraits` is on.
   */
  progression: {
    xp: { ranked: 40, casual: 25, practice: 0, win: 20, draw: 10, perDelivered: 2, maxDelivered: 10 },
    levelBase: 100,
    levelStep: 50,
    maxLevel: 10,
    traitLevels: [3, 6] as number[],
    maxTraits: 2,
    rankedTraits: false,
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
