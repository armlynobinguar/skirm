import { describe, expect, it } from 'vitest';
import type { LedgerRow } from '@/lib/api/types';
import {
  checkNearAmount,
  creditsForYocto,
  creditsPerNearOf,
  devDepositHash,
  explorerTxUrl,
  formatCountdown,
  formatUtc,
  ledgerDisplay,
  shortHash,
  yoctoFromDevHash,
} from './format';

const row = (o: Partial<LedgerRow>): LedgerRow => ({
  id: 'r1',
  type: 'topup',
  amount: 0,
  source: 'paid',
  note: null,
  matchId: null,
  txHash: null,
  createdAt: '2026-11-12T10:43:00.000Z',
  ...o,
});

describe('account format helpers', () => {
  it('converts yocto to credits with bigint, flooring, without float error', () => {
    expect(creditsForYocto('500000000000000000000000')).toBe(500);
    expect(creditsForYocto('999999999999999999999')).toBe(0); // 0.000999… NEAR
    expect(creditsForYocto('1000000000000000000000')).toBe(1);
    // 0.1 + 0.2 NEAR in yocto: exact 300 credits (a float path would give 300.00000000000006).
    expect(creditsForYocto(100000000000000000000000n + 200000000000000000000000n)).toBe(300);
    // Bigger than 2^53 yocto by far.
    expect(creditsForYocto('123456789000000000000000000000')).toBe(123_456_789);
  });

  it('validates typed NEAR amounts', () => {
    expect(checkNearAmount('0.5')).toEqual({ ok: true, yocto: '500000000000000000000000', credits: 500 });
    expect(checkNearAmount('.25')).toEqual({ ok: true, yocto: '250000000000000000000000', credits: 250 });
    expect(checkNearAmount('2.345')).toEqual({ ok: true, yocto: '2345000000000000000000000', credits: 2345 });
    // Regression: a remainder below one credit was paid but never credited (the server floors) and
    // M02 showed the amount rounded to 4 decimals. Only whole-credit amounts are accepted.
    expect(checkNearAmount('0.123456789012345678901234')).toEqual({
      ok: false,
      message: 'Enter a whole number of credits: 0.123 NEAR buys 123 credits.',
    });
    expect(checkNearAmount('2.34567')).toMatchObject({ ok: false, message: expect.stringContaining('2.345 NEAR') });
    expect(checkNearAmount('')).toMatchObject({ ok: false });
    expect(checkNearAmount('abc')).toMatchObject({ ok: false });
    expect(checkNearAmount('-1')).toMatchObject({ ok: false });
    expect(checkNearAmount('1e3')).toMatchObject({ ok: false });
    expect(checkNearAmount('0.0001')).toMatchObject({ ok: false, message: expect.stringContaining('less than 1 credit') });
    expect(checkNearAmount('20000')).toMatchObject({ ok: false, message: expect.stringContaining('at most') });
  });

  it('takes the server rate, else the default', () => {
    expect(creditsPerNearOf({ creditsPerNear: 2000 }, { creditsPerNear: 500 })).toBe(2000);
    expect(creditsPerNearOf({}, { creditsPerNear: 500 })).toBe(500);
    expect(creditsPerNearOf(undefined, undefined)).toBe(1000);
    expect(creditsPerNearOf({ creditsPerNear: 0 })).toBe(1000);
    expect(checkNearAmount('0.5', 2000)).toEqual({ ok: true, yocto: '500000000000000000000000', credits: 1000 });
    for (const t of ['1.2.3', '1,5', '1.', '..5', '1.0000000000000000000000001'])
      expect(checkNearAmount(t)).toEqual({ ok: false, message: 'Enter a NEAR amount like 0.5 or 2, with at most 24 decimals.' });
  });

  it('builds and reads dev deposit hashes', () => {
    const h = devDepositHash('500000000000000000000000');
    expect(h).toMatch(/^dev:500000000000000000000000:[0-9a-f]{16}$/);
    expect(yoctoFromDevHash(h)).toBe('500000000000000000000000');
    expect(yoctoFromDevHash('dev:42')).toBe('42');
    expect(yoctoFromDevHash('9QxRabc')).toBeNull();
    expect(shortHash(h)).toBe('dev deposit');
    expect(shortHash('9QxRAAAAAAAAAAAAAAAAk2Lm')).toBe('9QxR…k2Lm');
    expect(explorerTxUrl(h)).toBeNull();
    expect(explorerTxUrl('abc')).toBe('https://testnet.nearblocks.io/txns/abc');
  });

  it('counts down to the reset', () => {
    const reset = '2026-10-26T00:00:00.000Z';
    expect(formatCountdown(reset, Date.parse('2026-10-25T18:48:00Z'))).toBe('5 h 12 m');
    expect(formatCountdown(reset, Date.parse('2026-10-25T23:47:30Z'))).toBe('12 m');
    expect(formatCountdown(reset, Date.parse('2026-10-25T23:59:30Z'))).toBe('less than a minute');
    expect(formatCountdown(reset, Date.parse('2026-10-26T01:00:00Z'))).toBe('less than a minute');
  });

  it('formats UTC dates', () => {
    expect(formatUtc('2026-11-12T10:43:00.000Z')).toBe('12 Nov 10:43');
    expect(formatUtc(null)).toBe('–');
  });

  it('reads ledger rows like the artboard', () => {
    expect(
      ledgerDisplay(row({ type: 'topup', amount: 1000, txHash: 'dev:1000000000000000000000000:x' }), null),
    ).toEqual({ type: 'Top-up', detail: '1 NEAR at 1,000 credits per NEAR', from: 'Balance', amount: '+1,000', tone: 'in' });
    // Regression: the client-side rate is a placeholder, so it is not quoted when the server credited
    // a different amount.
    expect(
      ledgerDisplay(row({ type: 'topup', amount: 2000, txHash: 'dev:1000000000000000000000000:x' }), null).detail,
    ).toBe('1 NEAR');
    expect(
      ledgerDisplay(row({ type: 'topup', amount: 2000, txHash: 'dev:1000000000000000000000000:x' }), null, 2000).detail,
    ).toBe('1 NEAR at 2,000 credits per NEAR');
    expect(ledgerDisplay(row({ type: 'free', amount: 60, source: 'free', matchId: 'mat_1' }), 'Copper Hollow match')).toMatchObject({
      type: 'Hold',
      from: 'Free allowance',
      amount: '−60',
      tone: 'out',
      detail: 'Copper Hollow match · held up front',
    });
    expect(ledgerDisplay(row({ type: 'refund', amount: 33, source: 'free', matchId: 'mat_1' }), null)).toMatchObject({
      type: 'Refund',
      amount: '+33',
      detail: 'Match · unused credits returned',
    });
    expect(ledgerDisplay(row({ type: 'charge', amount: 27, matchId: 'mat_1' }), 'Copper Hollow match')).toMatchObject({
      type: 'Charge',
      amount: '27',
      tone: 'neutral',
    });
    expect(ledgerDisplay(row({ type: 'charge', amount: -27, note: 'reversal', matchId: 'mat_r' }), null)).toMatchObject({
      amount: '27',
      detail: 'Match · charge reversed, match aborted',
    });
  });

  it('reads a premium look bought with paid credits', () => {
    expect(ledgerDisplay(row({ type: 'spend', amount: 100, note: 'cosmetic' }), null)).toEqual({
      type: 'Purchase',
      detail: 'Premium look',
      from: 'Balance',
      amount: '−100',
      tone: 'out',
    });
  });
});
