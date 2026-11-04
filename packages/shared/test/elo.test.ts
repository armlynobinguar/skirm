import { describe, expect, it } from 'vitest';
import { applyElo, crewRating, eloDelta, expectedScore, kFactor, updateMatch } from '../src/index';

describe('§7 Elo', () => {
  it('E_A = 0.360 for 1,200 vs 1,300', () => {
    expect(expectedScore(1200, 1300)).toBeCloseTo(0.36, 3);
    expect(expectedScore(1200, 1200)).toBe(0.5);
  });

  it('K = 48 for the 5 placement matches, 32 up to the 20th ranked match, then 16', () => {
    expect(kFactor(0)).toBe(48);
    expect(kFactor(4)).toBe(48);
    expect(kFactor(5)).toBe(32);
    expect(kFactor(19)).toBe(32);
    expect(kFactor(20)).toBe(16);
  });

  it('§7 worked example: win and loss changes from the exact formula', () => {
    // Exact values: 32 × 0.640065 = 20.48 and 32 × (−0.359935) = −11.52. Half-up rounding gives
    // +20 and −12. The doc prints +21 and −11 because it rounds the product to 20.5 / −11.5
    // before rounding half up; reported as an open issue.
    expect(32 * (1 - expectedScore(1200, 1300))).toBeCloseTo(20.48, 2);
    expect(32 * (0 - expectedScore(1200, 1300))).toBeCloseTo(-11.52, 2);
    expect(eloDelta(1200, 1300, 1, 32)).toBe(20);
    expect(eloDelta(1200, 1300, 0, 32)).toBe(-12);
  });

  it('with K = 16 the win is worth +10', () => {
    expect(eloDelta(1200, 1300, 1, 16)).toBe(10);
  });

  it('rounds exact halves up', () => {
    // Equal ratings, draw-free: 25 × 0.5 = 12.5 → 13; loss −12.5 → −12.
    expect(eloDelta(1500, 1500, 1, 25)).toBe(13);
    expect(eloDelta(1500, 1500, 0, 25)).toBe(-12);
    expect(eloDelta(1500, 1500, 0.5, 32)).toBe(0);
  });

  it('floor 100', () => {
    expect(applyElo(105, -16)).toBe(100);
    expect(applyElo(1200, 20)).toBe(1220);
  });

  it('crew rating is the mean', () => {
    expect(crewRating([1200, 1300])).toBe(1250);
    expect(() => crewRating([])).toThrow(RangeError);
  });

  it('updates every agent of both crews; same K means the winner gains what the loser loses', () => {
    const r = updateMatch(
      [{ rating: 1200, rankedMatches: 5 }],
      [{ rating: 1300, rankedMatches: 5 }],
      1,
    );
    expect(r.a[0]).toEqual({ before: 1200, delta: 20, after: 1220 });
    expect(r.b[0]).toEqual({ before: 1300, delta: -20, after: 1280 });

    const crew = updateMatch(
      [
        { rating: 1250, rankedMatches: 30 },
        { rating: 1150, rankedMatches: 30 },
      ],
      [{ rating: 1300, rankedMatches: 30 }],
      1,
    );
    expect(crew.a.map((x) => x.delta)).toEqual([10, 10]);
    expect(crew.b[0]!.delta).toBe(-10);
  });

  it('a placement match moves the placing player further (K 48)', () => {
    const r = updateMatch([{ rating: 1200, rankedMatches: 0 }], [{ rating: 1300, rankedMatches: 30 }], 1);
    // 48 × 0.640065 = 30.72 → +31; the placed rival loses 16 × 0.640065 = 10.24 → −10.
    expect(r.a[0]).toEqual({ before: 1200, delta: 31, after: 1231 });
    expect(r.b[0]!.delta).toBe(-10);
  });

  it('a draw between equals changes nothing; the floor caps a loss', () => {
    const r = updateMatch(
      [{ rating: 1200, rankedMatches: 0 }],
      [{ rating: 1200, rankedMatches: 0 }],
      0.5,
    );
    expect(r.a[0]!.delta).toBe(0);
    const low = updateMatch(
      [{ rating: 110, rankedMatches: 0 }],
      [{ rating: 110, rankedMatches: 0 }],
      0,
    );
    expect(low.a[0]).toEqual({ before: 110, delta: -10, after: 100 });
  });
});
