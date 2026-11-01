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
