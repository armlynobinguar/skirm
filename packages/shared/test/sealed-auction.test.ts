import { describe, expect, it } from 'vitest';
import { auctionPayout, auctionStatus, evmLinkMessage, skillRefPreimage, vickreyOutcome } from '../src/sealed-auction';

describe('sealed auctions', () => {
  it('names the contract statuses', () => {
    expect(auctionStatus(1)).toBe('open');
    expect(auctionStatus(3n)).toBe('won');
    expect(auctionStatus(9)).toBe('none');
  });

  it('builds the skill reference preimage and rejects bad versions', () => {
    expect(skillRefPreimage('skl_abc', 2)).toBe('skirm-skill:skl_abc:2');
    expect(() => skillRefPreimage('skl_abc', 0)).toThrow();
    expect(() => skillRefPreimage('', 1)).toThrow();
  });

  it('sells to the highest bid at the runner-up price', () => {
    expect(vickreyOutcome([30n, 80n, 50n], 0n)).toEqual({ winner: 1, price: 50n });
  });

  it('lifts the price to the reserve and fails below it', () => {
    expect(vickreyOutcome([30n, 80n], 60n)).toEqual({ winner: 1, price: 60n });
    expect(vickreyOutcome([80n], 10n)).toEqual({ winner: 0, price: 10n });
    expect(vickreyOutcome([30n, 50n], 60n)).toEqual({ winner: null, price: 0n });
  });

  it('breaks ties for the earlier bidder and treats zero bids as no sale', () => {
    expect(vickreyOutcome([70n, 70n], 0n)).toEqual({ winner: 0, price: 70n });
    expect(vickreyOutcome([0n, 0n], 0n)).toEqual({ winner: null, price: 0n });
    expect(vickreyOutcome([], 0n)).toEqual({ winner: null, price: 0n });
  });

  it('splits the price into the fee and the seller share', () => {
    expect(auctionPayout(1_000_000n, 250)).toEqual({ fee: 25_000n, seller: 975_000n });
    expect(auctionPayout(1_000_000n, 250, false)).toEqual({ fee: 0n, seller: 1_000_000n });
  });

  it('binds the EVM link message to the account and a lower-cased address', () => {
    expect(evmLinkMessage('acc_1', '0xABCDEF0000000000000000000000000000000001')).toBe(
      'skirm: link EVM address 0xabcdef0000000000000000000000000000000001 to account acc_1',
    );
  });
});
