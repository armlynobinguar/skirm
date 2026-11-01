import { describe, expect, it } from 'vitest';
import { YOCTO_PER_NEAR, nearToYocto, splitSale, yoctoToNear } from '../src/index';

describe('§6 sale split', () => {
  it('5 NEAR resale → fee 0.25, royalty 0.25, seller 4.5', () => {
    const s = splitSale(5n * YOCTO_PER_NEAR, { primary: false });
    expect(yoctoToNear(s.fee)).toBe('0.25');
    expect(yoctoToNear(s.royalty)).toBe('0.25');
    expect(yoctoToNear(s.seller)).toBe('4.5');
  });

  it('primary sale → fee 0.25, royalty 0, creator 4.75', () => {
    const s = splitSale(nearToYocto('5'), { primary: true });
    expect(s).toEqual({ fee: nearToYocto('0.25'), royalty: 0n, seller: nearToYocto('4.75') });
  });

  it('parts always add up to P exactly', () => {
    const prices = [
      0n,
      1n,
      19_999n,
      123_456_789_012_345_678_901_234_567n,
      nearToYocto('0.000000000000000000000007'),
    ];
    for (const P of prices) {
      for (const royaltyBps of [0, 1, 333, 500, 1000]) {
        for (const primary of [true, false]) {
          const s = splitSale(P, { primary, royaltyBps, feeBps: 517 });
          expect(s.fee + s.royalty + s.seller).toBe(P);
          expect(s.seller >= 0n).toBe(true);
        }
      }
    }
    // Rounding down fee and royalty gives the remainder to the seller.
    expect(splitSale(19_999n, { primary: false })).toEqual({
      fee: 999n,
      royalty: 999n,
      seller: 18_001n,
    });
  });

  it('refuses a royalty outside 0..1000 bps', () => {
    expect(() => splitSale(1n, { primary: false, royaltyBps: 1001 })).toThrow(RangeError);
    expect(() => splitSale(1n, { primary: false, royaltyBps: -1 })).toThrow(RangeError);
  });

  it('converts NEAR strings exactly', () => {
    expect(nearToYocto('1')).toBe(YOCTO_PER_NEAR);
    expect(nearToYocto('0.000000000000000000000001')).toBe(1n);
    expect(yoctoToNear(1n)).toBe('0.000000000000000000000001');
    expect(() => nearToYocto('1e3')).toThrow(RangeError);
  });
});
