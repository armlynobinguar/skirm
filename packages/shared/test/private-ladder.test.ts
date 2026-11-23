import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/config';
import {
  LADDER_CEILING,
  LADDER_FLOOR,
  LADDER_START_DITHER,
  LADDER_START_RATING,
  LADDER_START_TIER,
  LADDER_STEPS,
  LADDER_TIERS,
  ladderBand,
  ladderTierIndex,
  ladderTierName,
  ladderUpdate,
  realEloGain,
} from '../src/private-ladder';
import { tierOf } from '../src/tier';

describe('private ladder', () => {
  it('uses the off-chain ranked tiers', () => {
    expect(LADDER_TIERS.map((t) => ({ ...t }))).toEqual(DEFAULTS.ranked.tiers);
    for (const r of [0, 1099, 1100, 1300, 1499, 1700, 1900, 3000])
      expect(ladderTierName(ladderTierIndex(r))).toBe(tierOf(r).name);
    expect(ladderTierName(6)).toBeNull();
  });

  it('starts every player in Silver', () => {
    expect(ladderTierIndex(LADDER_START_RATING)).toBe(LADDER_START_TIER);
    expect(ladderTierIndex(LADDER_START_RATING + LADDER_START_DITHER - 1)).toBe(LADDER_START_TIER);
  });

  it('picks the band from the winner-loser gap', () => {
    expect(ladderBand(1300, 1200)).toBe('favoured');
    expect(ladderBand(1299, 1200)).toBe('even');
    expect(ladderBand(1200, 1299)).toBe('even');
    expect(ladderBand(1200, 1300)).toBe('underdog');
  });

  it('moves both ratings by one step within the clamps', () => {
    expect(ladderUpdate(1200, 1210, 2)).toEqual({ winner: 1217, loser: 1193, step: 17 });
    expect(ladderUpdate(LADDER_CEILING - 1, LADDER_FLOOR + 1, 0)).toEqual({ winner: LADDER_CEILING, loser: LADDER_FLOOR, step: LADDER_STEPS.favoured });
    expect(() => ladderUpdate(1200, 1200, 4)).toThrow(RangeError);
  });

  it('stays within a few points of the real Elo (K = 32) for gaps up to 400', () => {
    for (let gap = -400; gap <= 400; gap += 10) {
      const banded = LADDER_STEPS[ladderBand(1500 + gap, 1500)] + 1.5; // mean dither
      expect(Math.abs(banded - realEloGain(1500 + gap, 1500))).toBeLessThan(6);
    }
  });
});
