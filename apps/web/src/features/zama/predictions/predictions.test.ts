import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: 'http://127.0.0.1:1', explorerUrl: 'https://sepolia.etherscan.io', contracts: { credits: null, match: null, fog: null, auction: null, predictions: null } },
}));

import { id } from 'ethers';
import { encryptPrediction, marketKey, marketPhase, oddsLabel, parseMarket, predictionsAddress, revealMine, sealedPredictionsLabel } from './predictions';

const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;

describe('predictions helpers', () => {
  it('keys a market by keccak256 of the match id, and needs a deployed contract', () => {
    expect(marketKey('mat_1')).toBe(id('mat_1'));
    expect(() => predictionsAddress()).toThrow(/not deployed/);
  });

  it('parses the market tuple', () => {
    expect(parseMarket({ closesAt: 10n, status: 3n, winner: 255n, feeBps: 500n, predictors: 4n, totalA: 40n, totalB: 20n })).toEqual({
      status: 'revealed',
      closesAt: 10,
      winner: 255,
      feeBps: 500,
      predictors: 4,
      totalA: 40n,
      totalB: 20n,
    });
  });

  it('stops betting on screen at the close tick or closesAt, before the chain says so', () => {
    const open = { status: 'open' as const, closesAt: 1_000 };
    expect(marketPhase(null, 0, 0)).toBe('none');
    expect(marketPhase(open, 29, 999)).toBe('open');
    expect(marketPhase(open, 30, 999)).toBe('closing');
    expect(marketPhase(open, 5, 1_000)).toBe('closing');
    expect(marketPhase({ status: 'closed', closesAt: 0 }, 40, 0)).toBe('closing');
    expect(marketPhase({ status: 'resolved', closesAt: 0 }, 40, 0)).toBe('resolved');
  });

  it('labels counts and odds', () => {
    expect(sealedPredictionsLabel(0)).toBe('No predictions yet');
    expect(sealedPredictionsLabel(1)).toBe('1 sealed prediction');
    expect(sealedPredictionsLabel(5)).toBe('5 sealed predictions');
    expect(oddsLabel(1.5)).toBe('×1.50');
    expect(oddsLabel(null)).toBe('—');
  });

  it('encrypts the side as a bool and the amount as a uint64 under one proof', async () => {
    const added: unknown[] = [];
    const input = {
      addBool: (v: boolean) => added.push(['bool', v]),
      add64: (v: bigint) => added.push(['u64', v]),
      encrypt: async () => ({ handles: [new Uint8Array([1]), new Uint8Array([2])], inputProof: new Uint8Array([3]) }),
    };
    const instance = { createEncryptedInput: vi.fn(() => input) };
    const enc = await encryptPrediction(instance, '0xc', '0xu', 'B', 5n);
    expect(instance.createEncryptedInput).toHaveBeenCalledWith('0xc', '0xu');
    expect(added).toEqual([['bool', true], ['u64', 5n]]);
    expect(enc).toEqual({ side: '0x01', amount: '0x02', inputProof: '0x03' });
    await expect(encryptPrediction(instance, '0xc', '0xu', 'A', -1n)).rejects.toThrow(RangeError);
  });

  it('reveals nothing for a wallet that never predicted', async () => {
    const instance = {} as Parameters<typeof revealMine>[0];
    const signer = { getAddress: async () => '0x1', signTypedData: async () => '0x' };
    expect(await revealMine(instance, signer, '0xc', { side: H(0), stake: H(0), payout: H(0), claimed: false })).toBeNull();
  });
});
