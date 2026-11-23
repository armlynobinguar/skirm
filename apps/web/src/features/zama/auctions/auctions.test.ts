// Sealed-auction helpers with the chain and relayer faked: phase, countdown and roles, the skill
// reference, close → finalize with the KMS-signed outcome, and revealing only the caller's own bid.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: '', explorerUrl: '', contracts: { credits: null, match: null, fog: null, auction: null } },
}));

import { auctionAddress, auctionPhase, auctionSkillRef, closeAndFinalize, countdown, parseAuction, revealMyBid, roleOf, sealedBidsLabel, type AuctionApi, type ChainAuction } from './auctions';

const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;
const ME = '0x1111111111111111111111111111111111111111';
const SELLER = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0x00000000000000000000000000000000000000a7';

function auction(over: Partial<ChainAuction> = {}): ChainAuction {
  return {
    seller: SELLER,
    skillRef: H(9),
    endTime: 1_000,
    status: 'open',
    feeBps: 250,
    reserveEncrypted: false,
    reserve: 0n,
    bidders: 2,
    winner: '0x0000000000000000000000000000000000000000',
    price: 0n,
    ...over,
  };
}

function fakeApi(states: ChainAuction[]): AuctionApi & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    get: vi.fn(async () => states[Math.min(i, states.length - 1)]!),
    bidOf: vi.fn(async () => H(7)),
    refunded: vi.fn(async () => false),
    revealHandles: vi.fn(async () => [H(1), H(2)] as [`0x${string}`, `0x${string}`]),
    create: vi.fn(async () => 1n),
    bid: vi.fn(async () => '0xb1d'),
    close: vi.fn(async () => {
      calls.push('close');
      i++;
      return '0xc1';
    }),
    finalize: vi.fn(async (_id, values: string, proof: string) => {
      calls.push(`finalize ${values} ${proof}`);
      i++;
      return '0xf1';
    }),
    refund: vi.fn(async () => '0xr1'),
  };
}

describe('auction helpers', () => {
  it('derives the phase from the status and the clock', () => {
    expect(auctionPhase(auction(), 999)).toBe('bidding');
    expect(auctionPhase(auction(), 1_000)).toBe('ended');
    expect(auctionPhase(auction({ status: 'closing' }), 0)).toBe('closing');
    expect(auctionPhase(auction({ status: 'won' }), 0)).toBe('won');
    expect(auctionPhase(auction({ status: 'failed' }), 0)).toBe('failed');
  });

  it('formats the countdown and the sealed bid count', () => {
    expect(countdown(1_000, 1_000)).toBe('ended');
    expect(countdown(1_000 + 2 * 86_400 + 4 * 3_600, 1_000)).toBe('2d 4h');
    expect(countdown(1_000 + 3 * 3_600 + 5 * 60, 1_000)).toBe('3h 05m');
    expect(countdown(1_000 + 4 * 60 + 9, 1_000)).toBe('4m 09s');
    expect([0, 1, 3].map(sealedBidsLabel)).toEqual(['No bids yet', '1 sealed bid', '3 sealed bids']);
  });

  it('names the viewer’s role', () => {
    const won = auction({ status: 'won', winner: ME });
    expect(roleOf(won, ME.toUpperCase().replace('0X', '0x'), true)).toBe('winner');
    expect(roleOf(won, SELLER, false)).toBe('seller');
    expect(roleOf(auction({ status: 'won', winner: SELLER.replace('2', '3') }), ME, true)).toBe('loser');
    expect(roleOf(won, null, false)).toBe('viewer');
  });

  it('hashes the skill reference like the server and parses the contract tuple', () => {
    expect(auctionSkillRef('skl_1', 2)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(auctionSkillRef('skl_1', 2)).not.toBe(auctionSkillRef('skl_1', 1));
    const a = parseAuction({ seller: SELLER, skillRef: H(1), endTime: 5n, status: 3n, feeBps: 250n, reserveEncrypted: true, reserve: 0n, bidders: 4n, winner: ME, price: 9n });
    expect(a).toMatchObject({ status: 'won', bidders: 4, feeBps: 250, reserveEncrypted: true, price: 9n });
  });

  it('refuses to run before SkillAuction is deployed', () => {
    expect(() => auctionAddress()).toThrow(/not deployed/);
  });
});

describe('closeAndFinalize', () => {
  const instance = {
    publicDecrypt: vi.fn(async (handles: string[]) => ({
      clearValues: Object.fromEntries(handles.map((h, i) => [h, BigInt(i + 1)])),
      abiEncodedClearValues: '0xabc',
      decryptionProof: '0xdef',
    })),
  } as never;

  it('closes, public-decrypts the two outcome handles and finalizes with the KMS proof', async () => {
    const api = fakeApi([auction({ endTime: 0 }), auction({ status: 'closing' }), auction({ status: 'won', winner: ME, price: 5n })]);
    const out = await closeAndFinalize(api, instance, 1n);
    expect(api.calls).toEqual(['close', 'finalize 0xabc 0xdef']);
    expect(out).toMatchObject({ status: 'won', winner: ME });
  });

  it('only finalizes an auction somebody else closed, and does nothing once it is over', async () => {
    const closing = fakeApi([auction({ status: 'closing' }), auction({ status: 'failed' })]);
    expect((await closeAndFinalize(closing, instance, 1n)).status).toBe('failed');
    expect(closing.calls).toEqual(['finalize 0xabc 0xdef']);
    const done = fakeApi([auction({ status: 'failed' })]);
    await closeAndFinalize(done, instance, 1n);
    expect(done.calls).toEqual([]);
  });
});

describe('revealMyBid', () => {
  it('user-decrypts the signer’s own bid handle, and returns null without a bid', async () => {
    const userDecrypt = vi.fn(async (refs: { handle: string }[]) => ({ [refs[0]!.handle]: 25_000_000n }));
    const instance = {
      generateKeypair: () => ({ publicKey: 'pk', privateKey: 'sk' }),
      createEIP712: () => ({ domain: {}, types: { UserDecryptRequestVerification: [] }, message: {} }),
      userDecrypt,
    } as never;
    const signer = { getAddress: async () => ME, signTypedData: vi.fn(async () => '0x5157') };
    const api = fakeApi([auction()]);
    expect(await revealMyBid(instance, signer, api, CONTRACT, 1n)).toBe(25_000_000n);
    expect(api.bidOf).toHaveBeenCalledWith(1n, ME);
    expect(userDecrypt.mock.calls[0]![0]).toEqual([{ handle: H(7), contractAddress: CONTRACT }]);

    (api.bidOf as ReturnType<typeof vi.fn>).mockResolvedValueOnce(H(0));
    expect(await revealMyBid(instance, signer, api, CONTRACT, 1n)).toBeNull();
  });
});
