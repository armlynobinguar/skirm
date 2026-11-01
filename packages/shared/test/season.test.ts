import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  SEASON,
  YOCTO_PER_NEAR,
  seasonFeeShare,
  seasonPayouts,
  seasonPoints,
  splitSale,
} from '../src/index';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ accountId: `acc_${i}` }));

describe('seasons', () => {
  it('14 days, 30/20/15 then 5 × 7 (the whole pool), 30% of fees, points 25/12/5', () => {
    expect(SEASON).toBe(DEFAULTS.season);
    expect(SEASON.days).toBe(14);
    expect(SEASON.splitBps).toEqual([3000, 2000, 1500, 500, 500, 500, 500, 500, 500, 500]);
    expect(SEASON.splitBps.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(SEASON.feeShareBps).toBe(3000);
    expect([seasonPoints('win'), seasonPoints('draw'), seasonPoints('loss')]).toEqual([25, 12, 5]);
  });

  it('a full top 10 takes the whole pool when it divides evenly', () => {
    const { payouts, carry } = seasonPayouts(100n * YOCTO_PER_NEAR, players(12));
    expect(payouts).toHaveLength(10);
    expect(payouts[0]).toEqual({
      rank: 1,
      accountId: 'acc_0',
      bps: 3000,
      amountYocto: 30n * YOCTO_PER_NEAR,
    });
    expect(payouts[2]!.amountYocto).toBe(15n * YOCTO_PER_NEAR);
    expect(payouts[9]).toMatchObject({
      rank: 10,
      accountId: 'acc_9',
      bps: 500,
      amountYocto: 5n * YOCTO_PER_NEAR,
    });
    expect(carry).toBe(0n);
  });

  it('floors every place; payouts plus carry always sum to the pool', () => {
    for (const pool of [0n, 1n, 19n, 9_999n, 123_456_789_012_345_678_901n]) {
      for (const n of [0, 1, 3, 10, 15]) {
        const { payouts, carry } = seasonPayouts(pool, players(n));
        const paid = payouts.reduce((s, p) => s + p.amountYocto, 0n);
        expect(paid + carry).toBe(pool);
        expect(paid).toBeLessThanOrEqual(pool);
        expect(carry).toBeGreaterThanOrEqual(0n);
      }
    }
    expect(seasonPayouts(19n, players(1)).payouts[0]!.amountYocto).toBe(5n); // 5.7 → 5, as the contract
    // Empty places are carried: three players take 65%.
    expect(seasonPayouts(1000n, players(3)).carry).toBe(350n);
    expect(() => seasonPayouts(-1n, players(1))).toThrow(RangeError);
  });

  it('the pool share of a sale fee is 30% of it, floored', () => {
    const { fee } = splitSale(5n * YOCTO_PER_NEAR, { primary: true });
    expect(seasonFeeShare(fee)).toBe((fee * 3n) / 10n);
    expect(seasonFeeShare(9n)).toBe(2n);
  });
});
