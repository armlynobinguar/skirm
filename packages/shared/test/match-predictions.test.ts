import { describe, expect, it } from 'vitest';
import { predictionOdds, predictionPayout, predictionSide, predictionStatus } from '../src/match-predictions';

describe('match predictions', () => {
  it('names the contract statuses', () => {
    expect(predictionStatus(0)).toBe('none');
    expect(predictionStatus(3n)).toBe('revealed');
    expect(predictionStatus(5)).toBe('void');
    expect(predictionStatus(9)).toBe('none');
    expect(predictionSide('A')).toBe(0);
    expect(predictionSide('B')).toBe(1);
  });

  it('pays a winner its stake plus its pro-rata share of the losing side, minus the fee', () => {
    // Team A backed with 100 + 300, team B with 200; A wins.
    expect(predictionPayout(100n, true, 400n, 200n, 0)).toEqual({ winnings: 50n, fee: 0n, payout: 150n });
    expect(predictionPayout(300n, true, 400n, 200n, 0)).toEqual({ winnings: 150n, fee: 0n, payout: 450n });
    expect(predictionPayout(300n, true, 400n, 200n, 500)).toEqual({ winnings: 150n, fee: 7n, payout: 443n });
    expect(predictionPayout(300n, true, 400n, 200n, 500, false).fee).toBe(0n);
  });

  it('pays a loser nothing, and a lone side its stake back', () => {
    expect(predictionPayout(200n, false, 400n, 200n, 500).payout).toBe(0n);
    expect(predictionPayout(70n, true, 70n, 0n, 500)).toEqual({ winnings: 0n, fee: 0n, payout: 70n });
    expect(() => predictionPayout(1n, true, 0n, 5n, 0)).toThrow();
  });

  it('never pays out more than the pool (rounding down)', () => {
    const stakes = [7n, 11n, 13n];
    const winning = stakes.reduce((a, b) => a + b, 0n);
    const paid = stakes.reduce((s, x) => s + predictionPayout(x, true, winning, 10n, 0).payout, 0n);
    expect(paid <= winning + 10n).toBe(true);
  });

  it('gives decimal odds once the totals are public', () => {
    expect(predictionOdds(400n, 200n)).toEqual({ A: 1.5, B: 3 });
    expect(predictionOdds(0n, 5n)).toEqual({ A: null, B: 1 });
  });
});
