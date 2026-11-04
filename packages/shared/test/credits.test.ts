import { describe, expect, it } from 'vitest';
import {
  COST_RATES,
  DEFAULTS,
  chargeCredits,
  costRates,
  creditsFromTopUp,
  crewFactor,
  grossMargin,
  holdCredits,
  markup,
  priceWeight,
  refundCredits,
  repriceCredit,
} from '../src/index';

describe('config', () => {
  it('is deeply frozen', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
    expect(Object.isFrozen(DEFAULTS.talk.ratePer100)).toBe(true);
    expect(() => {
      (DEFAULTS.credits as { priceUsd: number }).priceUsd = 1;
    }).toThrow();
  });
  it('holds the §10 values', () => {
    expect(DEFAULTS.free.dailyCredits).toBe(60);
    expect(DEFAULTS.crew).toEqual({ maxAgents: 3, extraAgentStep: 0.5 });
    expect(DEFAULTS.elo).toMatchObject({ start: 1200, kProvisional: 32, k: 16, floor: 100 });
    expect(DEFAULTS.market).toMatchObject({ feeBps: 500, royaltyBps: 500 });
  });
  it('carries exactly these blocks', () => {
    expect(Object.keys(DEFAULTS).sort()).toEqual([
      'bench',
      'commands',
      'credits',
      'crew',
      'elo',
      'free',
      'market',
      'model',
      'price',
      'ranked',
      'season',
      'talk',
      'tokens',
    ]);
    expect(Object.keys(DEFAULTS.free).sort()).toEqual([
      'dailyBudgetSafety',
      'dailyCredits',
      'resetUtc',
    ]);
  });
});

describe('§3 crew price', () => {
  it('weights 1, 1.5, 2 and S(n) 1, 2.5, 4.5', () => {
    expect([1, 2, 3].map((k) => priceWeight(k))).toEqual([1, 1.5, 2]);
    expect([1, 2, 3].map((n) => crewFactor(n))).toEqual([1, 2.5, 4.5]);
  });
  it('three agents, 50 ticks: 225 credits', () => {
    expect(chargeCredits([50, 50, 50])).toBe(225);
  });
  it('rejects a crew of zero and an agent position of zero', () => {
    expect(() => crewFactor(0)).toThrow(RangeError);
    expect(() => priceWeight(0)).toThrow(RangeError);
  });
});

describe('§2 cost per call', () => {
  it('c_H = $0.000155, c_P = $0.000325', () => {
    expect(COST_RATES.haiku).toBeCloseTo(0.000155, 12);
    expect(COST_RATES.planner).toBeCloseTo(0.000325, 12);
  });
  it('without caching c_H is $0.00038; 300 reasoning tokens raise it to $0.000275', () => {
    const noCache = costRates({
      ...DEFAULTS,
      price: { ...DEFAULTS.price, haiku: { ...DEFAULTS.price.haiku, cacheHit: 0.1 } },
    });
    expect(noCache.haiku).toBeCloseTo(0.00038, 12);
    const reasoning = costRates({
      ...DEFAULTS,
      tokens: { ...DEFAULTS.tokens, actorOutputCap: 300 },
    });
    expect(reasoning.haiku).toBeCloseTo(0.000275, 12);
  });
  it('a Haiku turn earns 6.45x at $0.001 a credit, an 84.5% gross margin', () => {
    const mu = markup(COST_RATES.haiku);
    expect(mu).toBeCloseTo(6.45, 2);
    expect(grossMargin(mu) * 100).toBeCloseTo(84.5, 1);
    expect(markup(0.0005, 0.002)).toBe(4);
  });
});

describe('§2 hold, charge, refund table', () => {
  const rows = [
    // L, agents, ticks, Q, H, refund
    [60, 1, 27, 27, 60, 33],
    [60, 2, 23, 58, 150, 92],
    [50, 1, 29, 29, 50, 21],
    [50, 2, 29, 73, 125, 52],
    [70, 1, 57, 57, 70, 13],
    [70, 2, 32, 80, 175, 95],
  ] as const;
  for (const [L, n, t, Q, H, refund] of rows) {
    it(`L ${L}, ${n} agent(s), ${t} ticks: hold ${H}, charge ${Q}, refund ${refund}`, () => {
      const hold = holdCredits(L, n);
      const charged = chargeCredits(Array.from({ length: n }, () => t));
      expect(hold).toBe(H);
      expect(charged).toBe(Q);
      expect(refundCredits(hold, charged)).toBe(refund);
    });
  }
  it('a lost agent stops charging: only its own weight stops', () => {
    // Agent 2 (m = 1.5) lost after 10 ticks, agent 1 plays 32: 32 + 15 = 47.
    expect(chargeCredits([32, 10])).toBe(47);
    // Half credits round up.
    expect(chargeCredits([0, 1])).toBe(2);
  });
});

describe('top-up', () => {
  it('credits = floor(D·X/p)', () => {
    expect(creditsFromTopUp(1, 1)).toBe(1000);
    expect(creditsFromTopUp(0.29, 1)).toBe(290);
    expect(creditsFromTopUp(2.5, 3.1234)).toBe(7808);
    expect(creditsFromTopUp(0.0004, 1)).toBe(0);
  });
});

describe('§9 repricing', () => {
  it('raises the price to the next step that meets the 5x target', () => {
    expect(repriceCredit(0.000414)).toBe(0.0021);
    expect(repriceCredit(0.0002195)).toBe(0.0011);
  });
  it('keeps the price while the markup meets the target', () => {
    expect(repriceCredit(0.0001035)).toBe(0.001);
    expect(repriceCredit(0.0002)).toBe(0.001); // exactly 5×
  });
});
