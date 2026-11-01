import { describe, expect, it } from 'vitest';
import {
  COST_RATES,
  DEFAULTS,
  chargeDue,
  modeledCostPerAgentTickUsd,
  talkHold,
  talkRatePer100,
  v2CostPerFreeCredit,
  v2FreePlayBudget,
  v2GlobalFreeBudget,
  type TalkTierName,
} from '../src/index';

const TIERS: TalkTierName[] = ['quiet', 'standard', 'open'];

describe('talk-tier rates', () => {
  it('are integer credits per 100 agent-ticks: Quiet 20, Standard 20, Open 40', () => {
    expect(TIERS.map((t) => talkRatePer100(t))).toEqual([20, 20, 40]);
    for (const t of TIERS) expect(Number.isInteger(talkRatePer100(t))).toBe(true);
    expect(talkRatePer100('quiet')).toBe(talkRatePer100('standard'));
  });

  it('model cost per agent-tick is a Haiku turn plus a planner call every 25 ticks', () => {
    expect(modeledCostPerAgentTickUsd()).toBeCloseTo(COST_RATES.haiku + COST_RATES.planner / 25, 15);
    expect(modeledCostPerAgentTickUsd()).toBeCloseTo(0.000168, 12);
    expect(modeledCostPerAgentTickUsd(DEFAULTS, 1)).toBeCloseTo(COST_RATES.haiku + COST_RATES.planner, 15);
  });

  it('every tier earns at least 1.15x its modeled model cost per agent-tick', () => {
    const cost = modeledCostPerAgentTickUsd();
    for (const t of TIERS) {
      const earned = (talkRatePer100(t) / 100) * DEFAULTS.credits.priceUsd;
      expect(earned).toBeGreaterThanOrEqual(1.15 * cost);
    }
    // Quiet and Standard about 1.19x, Open about 2.38x.
    expect((0.2 * DEFAULTS.credits.priceUsd) / cost).toBeCloseTo(1.19, 2);
    expect((0.4 * DEFAULTS.credits.priceUsd) / cost).toBeCloseTo(2.38, 2);
  });

  it('a credit costs priceUsd, a NEAR buys perNear credits (assumes NEAR = $1)', () => {
    expect(DEFAULTS.credits.priceUsd * DEFAULTS.credits.perNear).toBe(1);
  });
});

describe('talk holds', () => {
  it('hold = ceil(ticks x sum of rates / 100) over 150 ticks', () => {
    expect(talkHold([20], 150)).toBe(30);
    expect(talkHold([20, 20], 150)).toBe(60);
    expect(talkHold([20, 20, 20], 150)).toBe(90);
    expect(talkHold([40, 40], 150)).toBe(120);
    expect(talkHold([40, 20], 135)).toBe(81);
    expect(talkHold([20], 1)).toBe(1);
    expect(talkHold([], 150)).toBe(0);
  });

  it('the daily free allowance buys one 2-agent ranked match or two 1-agent matches', () => {
    const daily = DEFAULTS.free.dailyCredits;
    expect(daily).toBe(60);
    expect(talkHold([20, 20], 150)).toBe(60);
    expect(talkHold([20, 20], 150)).toBeLessThanOrEqual(daily);
    expect(2 * talkHold([20], 150)).toBeLessThanOrEqual(daily);
    expect(talkHold([20, 20, 20], 150)).toBeGreaterThan(daily);
  });
});

describe('talk charges', () => {
  it('charges only the whole credits a running total newly crosses', () => {
    expect(chargeDue(0, 0)).toBe(0);
    expect(chargeDue(20, 0)).toBe(1);
    expect(chargeDue(100, 1)).toBe(0);
    expect(chargeDue(120, 1)).toBe(1);
    expect(chargeDue(60, 5)).toBe(0);
  });

  it('never charges past the hold, for every tier mix, clock and agents going out', () => {
    const rates = TIERS.map((t) => talkRatePer100(t));
    const crews: number[][] = [];
    for (const a of rates) {
      crews.push([a]);
      for (const b of rates) {
        crews.push([a, b]);
        for (const c of rates) crews.push([a, b, c]);
      }
    }
    for (const crew of crews) {
      for (const ticks of [150, 135, 120, 37, 1]) {
        const hold = talkHold(crew, ticks);
        // outAfter[i]: agent i stops costing after that many ticks (ticks = plays the whole clock).
        for (const outAfter of [crew.map(() => ticks), crew.map((_, i) => (i === 0 ? 7 : ticks)), crew.map((_, i) => 3 * i + 1)]) {
          let cum = 0;
          let charged = 0;
          for (let tick = 1; tick <= ticks; tick++) {
            cum += crew.reduce((n, r, i) => n + (tick <= outAfter[i]! ? r : 0), 0);
            const due = chargeDue(cum, charged);
            expect(Number.isInteger(due) && due >= 0).toBe(true);
            charged += due;
            expect(charged).toBeLessThanOrEqual(hold);
          }
          expect(charged).toBe(Math.ceil(cum / 100));
          if (outAfter.every((t) => t === ticks)) expect(charged).toBe(hold);
        }
      }
    }
  });
});

describe('v2 free-play budget', () => {
  it('prices one free credit at the model cost behind a Standard credit', () => {
    expect(v2CostPerFreeCredit()).toBeCloseTo(modeledCostPerAgentTickUsd() / 0.2, 15);
    expect(v2CostPerFreeCredit()).toBeCloseTo(0.00084, 12);
  });

  it('B = $130 a month and G = 4,126 credits a day (about 68 free 60-credit players)', () => {
    // B = NφA + F − (NφA / p)·c − X_fix = 500 + 200 − 500,000 · 0.00084 − 150.
    expect(v2FreePlayBudget()).toBeCloseTo(130, 9);
    // G = floor(0.8 · 130 / (30 · 0.00084)) = floor(4126.98).
    expect(v2GlobalFreeBudget()).toBe(4126);
    expect(Math.floor(v2GlobalFreeBudget() / DEFAULTS.free.dailyCredits)).toBe(68);
  });

  it('takes overrides for every input, and G is never negative', () => {
    expect(v2FreePlayBudget({ payerShare: 0.1 })).toBeCloseTo(1000 + 200 - 1_000_000 * 0.00084 - 150, 9);
    expect(v2FreePlayBudget({ costPerTurn: 0.0005 })).toBeCloseTo(500 + 200 - 500_000 * 0.0005 - 150, 9);
    // G = floor(0.8 · 300 / (30 · 0.001)).
    expect(v2GlobalFreeBudget(300, 0.001)).toBe(8000);
    expect(v2GlobalFreeBudget(300, 0.001, 0.5, 10)).toBe(15000);
    expect(v2GlobalFreeBudget(-1)).toBe(0);
  });
});
