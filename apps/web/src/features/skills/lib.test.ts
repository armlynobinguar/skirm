import { splitSale } from '@skirm/shared';
import { describe, expect, it } from 'vitest';
import { devTxHash, parsePrice, pctToBps, validateForm, emptyForm, LIMITS } from './lib';

// The api's own patterns (apps/api/src/validation.ts listingBody, market.controller DEV_PURCHASE_RE).
const API_PRICE_RE = /^[0-9]{1,40}$/;
const DEV_PURCHASE_RE = /^dev:([0-9]{1,40})(?::[A-Za-z0-9_-]{1,64})?$/;

describe('parsePrice', () => {
  it('converts exactly, with up to 24 decimals', () => {
    expect(parsePrice('1.5')).toEqual({ yocto: '1500000000000000000000000' });
    expect(parsePrice(' 2 ')).toEqual({ yocto: '2000000000000000000000000' });
    expect(parsePrice('.5')).toEqual({ yocto: '500000000000000000000000' });
    expect(parsePrice('0.000000000000000000000001')).toEqual({ yocto: '1' });
    expect(parsePrice('5.')).toEqual({ yocto: '5000000000000000000000000' });
    expect(parsePrice('.0000000000000000000000001')).toEqual({ error: 'NEAR has at most 24 decimals.' });
  });
  it('rejects malformed amounts and what the api would refuse', () => {
    for (const t of ['', '.', '1.2.3', '-1', '+1', '1e3', '1,5', 'abc', '0x10', '1 000', '1.5.', '5..', '..5', '.5.'])
      expect(parsePrice(t)).toEqual({ error: 'Enter a price in NEAR, e.g. 1.5' });
    expect(parsePrice('1.0000000000000000000000001')).toEqual({ error: 'NEAR has at most 24 decimals.' });
    expect(parsePrice('0')).toEqual({ error: 'The price must be more than 0 NEAR.' });
    expect(parsePrice('99999999999999999')).toEqual({ error: 'That price is too high.' });
    const max = parsePrice('9999999999999999');
    expect('yocto' in max && API_PRICE_RE.test(max.yocto)).toBe(true);
  });
});

describe('api parity', () => {
  it('dev purchase hashes match the api pattern and carry the exact price', () => {
    const h = devTxHash('2000000000000000000000000');
    expect(DEV_PURCHASE_RE.exec(h)?.[1]).toBe('2000000000000000000000000');
    expect(h.length).toBeLessThanOrEqual(128);
  });
  it('royalty is 0-1000 bps; tags 1+; prompt 1,200 and reflexes 400 UTF-16 units like zod', () => {
    expect(pctToBps('10')).toBe(1000);
    expect(pctToBps('10.01')).toBeNull();
    const f = { ...emptyForm(), name: 'Dam First', tags: ['liquid' as const], prompt: '😀'.repeat(600) };
    expect(validateForm(f)).toEqual({});
    expect(validateForm({ ...f, prompt: `${f.prompt}x` }).prompt).toBeDefined();
    expect(validateForm({ ...f, reflexes: 'x'.repeat(LIMITS.reflexes + 1) }).reflexes).toBeDefined();
  });
  it('pre-listing split is the same splitSale the api uses (no royalty on a primary sale)', () => {
    const s = splitSale(2n * 10n ** 24n, { primary: true, royaltyBps: 500 });
    expect(s.royalty).toBe(0n);
    expect(s.fee + s.seller).toBe(2n * 10n ** 24n);
  });
});
