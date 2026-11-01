import { describe, expect, it } from 'vitest';
import { MAPS } from '@/features/arena/world';
import { SEASON } from '@skirm/shared';
import { boardSizeRange, creditsAsNear, fmtCountdown, nearFixed, splitRows, splitShare, sumYocto } from './pvpUtil';

describe('hub helpers', () => {
  it('reads a place\'s share from the season split: 30 / 20 / 15, then 5 each to 10th', () => {
    expect([1, 2, 3, 4, 10].map((r) => splitShare(SEASON.splitBps, r))).toEqual([30, 20, 15, 5, 5]);
    expect(splitShare(SEASON.splitBps, 11)).toBeNull();
    expect(splitShare(SEASON.splitBps, 0)).toBeNull();
  });

  it('folds the equal tail of the split into one row', () => {
    expect(splitRows(SEASON.splitBps)).toEqual([
      ['1st', '30%'],
      ['2nd', '20%'],
      ['3rd', '15%'],
      ['4th–10th', '5% each'],
    ]);
    expect(splitRows([6000, 3000, 1000])).toEqual([
      ['1st', '60%'],
      ['2nd', '30%'],
      ['3rd', '10%'],
    ]);
    expect(splitRows([5000, 2500, 2500])).toEqual([
      ['1st', '50%'],
      ['2nd–3rd', '25% each'],
    ]);
    expect(splitRows([])).toEqual([]);
  });

  it('counts down in days, then in hours, minutes and seconds', () => {
    expect(fmtCountdown(2 * 86_400_000 + 3 * 3_600_000 + 5 * 60_000 + 9_000)).toBe('2d 03h 05m');
    expect(fmtCountdown(3 * 3_600_000 + 5 * 60_000 + 9_000)).toBe('3:05:09');
    expect(fmtCountdown(-5000)).toBe('0:00:00');
  });

  it('shows credits as NEAR at the server rate', () => {
    expect(creditsAsNear(2100, 1000)).toBe('2.10');
    expect(creditsAsNear(0, 1000)).toBe('0.00');
    expect(creditsAsNear(500, 0)).toBe('0.00');
  });

  it('sums yoctoNEAR strings, skipping null and malformed values', () => {
    expect(sumYocto('840000000000000000000000', '1000000000000000000000000', null, undefined, '', 'nope')).toBe(1_840_000_000_000_000_000_000_000n);
    expect(sumYocto()).toBe(0n);
  });

  it('formats NEAR with exactly two decimals, cut not rounded', () => {
    expect(nearFixed(1_840_000_000_000_000_000_000_000n)).toBe('1.84');
    expect(nearFixed(10n ** 24n)).toBe('1.00');
    expect(nearFixed(0n)).toBe('0.00');
    expect(nearFixed(1_999_000_000_000_000_000_000_000n)).toBe('1.99');
  });

  it('names the board size range of the rotation', () => {
    expect(boardSizeRange(MAPS.map((m) => m.A))).toBe('31×13 to 55×25');
    expect(boardSizeRange([])).toBe('');
  });
});
