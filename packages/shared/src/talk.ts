// v2 talk-tier pricing. Rates are integer credits per 100 agent-ticks (DEFAULTS.talk.ratePer100),
// so holds and charges stay in whole credits: a hold rounds the whole match up once, and each tick
// charges only what a cumulative counter has newly crossed, so the total never exceeds the hold.
import { DEFAULTS, type SkirmConfig } from './config';
import { costRates } from './credits';

export type TalkTierName = 'quiet' | 'standard' | 'open';

/** Credits per 100 agent-ticks for one agent on this tier. */
export function talkRatePer100(tier: TalkTierName, cfg: SkirmConfig = DEFAULTS): number {
  return cfg.talk.ratePer100[tier];
}

/** Credits held for a crew over `ticks`: ceil(ticks × Σ rate / 100). */
export function talkHold(ratesPer100: readonly number[], ticks: number): number {
  const sum = ratesPer100.reduce((n, r) => n + r, 0);
  // Integer rates and ticks: an exact multiple of 100 divides exactly, so plain ceil is safe.
  return Math.ceil((ticks * sum) / 100);
}

/** Whole credits to charge now: ceil(cum / 100) − charged so far, never negative. */
export function chargeDue(cumPer100: number, chargedSoFar: number): number {
  return Math.max(0, Math.ceil(cumPer100 / 100) - chargedSoFar);
}

/**
 * Modeled USD per agent-tick for a 1-agent crew (the worst case): a Haiku actor turn every tick
 * plus one planner call every `planEvery` ticks.
 */
export function modeledCostPerAgentTickUsd(cfg: SkirmConfig = DEFAULTS, planEvery = 25): number {
  const rates = costRates(cfg);
  return rates.haiku + rates.planner / planEvery;
}

/** USD of model cost behind one credit spent at the Standard rate. */
export function v2CostPerFreeCredit(cfg: SkirmConfig = DEFAULTS): number {
  return modeledCostPerAgentTickUsd(cfg) / (talkRatePer100('standard', cfg) / 100);
}

/** One crew's real model spend in one ended match, its agents all on one tier. */
export interface TalkUsageSample {
  tier: TalkTierName;
  agents: number;
  ticks: number;
  costUsd: number;
}

export interface TalkRateMeasure {
  /** Crews measured. */
  crews: number;
  agentTicks: number;
  /** Measured model USD per agent-tick (null with no samples). */
  costPerAgentTickUsd: number | null;
  /** ratePer100 that covers the measured cost with the margin (null with no samples). */
  suggestedRatePer100: number | null;
  currentRatePer100: number;
  /** Enough samples to act on (at least `minAgentTicks`). */
  enough: boolean;
}

/**
 * Talk-tier rates from measured usage (the prototype: "rates are placeholders until token counts are
 * measured"). For each tier, the model cost per agent-tick over the samples, and the rate in credits
 * per 100 agent-ticks that covers it: ceil(cost / priceUsd × 100 × margin). Quiet makes the same model
 * calls as Standard, so their measures are usually close; the suggestion never undercuts the cost.
 */
export function measureTalkRates(
  samples: readonly TalkUsageSample[],
  opts: { margin?: number; minAgentTicks?: number; cfg?: SkirmConfig } = {},
): Record<TalkTierName, TalkRateMeasure> {
  const cfg = opts.cfg ?? DEFAULTS;
  const margin = opts.margin ?? 1.25;
  const min = opts.minAgentTicks ?? 3000;
  const out = {} as Record<TalkTierName, TalkRateMeasure>;
  for (const tier of ['quiet', 'standard', 'open'] as const) {
    const mine = samples.filter((s) => s.tier === tier && s.agents > 0 && s.ticks > 0 && s.costUsd >= 0);
    const agentTicks = mine.reduce((n, s) => n + s.agents * s.ticks, 0);
    const cost = mine.reduce((n, s) => n + s.costUsd, 0);
    const per = agentTicks ? cost / agentTicks : null;
    out[tier] = {
      crews: mine.length,
      agentTicks,
      costPerAgentTickUsd: per,
      suggestedRatePer100: per === null ? null : Math.max(1, Math.ceil(((per / cfg.credits.priceUsd) * 100 * margin) - 1e-9)),
      currentRatePer100: talkRatePer100(tier, cfg),
      enough: agentTicks >= min,
    };
  }
  return out;
}
