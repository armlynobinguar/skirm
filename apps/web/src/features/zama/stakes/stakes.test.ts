import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: '', explorerUrl: '', contracts: { credits: null, match: null } },
}));

import { CSKIRM_UNIT, parseCskirm, revealPayout, type ChainEscrow } from './stakes';

const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;
const ZERO = H(0);
const MATCH = '0x00000000000000000000000000000000000000aa';

const escrow = (over: Partial<ChainEscrow> = {}): ChainEscrow => ({
  minStake: 10n * CSKIRM_UNIT,
  feeBps: 250,
  staked: [H(1), H(2)],
  paid: [H(3), H(4)],
  stakeOk: [true, true],
  ...over,
});

/** A relayer instance whose userDecrypt returns `clear` by handle; records what it was asked. */
function fakeInstance(clear: Record<string, bigint>) {
  return {
    generateKeypair: () => ({ publicKey: 'pub', privateKey: 'priv' }),
    createEIP712: () => ({ domain: {}, types: { UserDecryptRequestVerification: [] }, message: {} }),
    userDecrypt: vi.fn(async (refs: { handle: string }[]) => Object.fromEntries(refs.map((r) => [r.handle, clear[r.handle]!]))),
  };
}

const signer = { getAddress: async () => '0x1111111111111111111111111111111111111111', signTypedData: async () => '0xsig' };

describe('parseCskirm', () => {
  it('reads whole and fractional cSKIRM as 6-decimal base units', () => {
    expect(parseCskirm('10')).toBe(10_000_000n);
    expect(parseCskirm(' 12.5 ')).toBe(12_500_000n);
    expect(parseCskirm('0.000001')).toBe(1n);
    expect(parseCskirm('7.')).toBe(7_000_000n);
    expect(parseCskirm('0')).toBe(0n);
  });

  it('refuses negatives, too many decimals and words', () => {
    for (const bad of ['', '-1', '1.0000001', 'ten', '1e3', '1,000']) expect(parseCskirm(bad)).toBeNull();
  });
});

describe('revealPayout', () => {
  it('user-decrypts the side’s stake and payout and returns the net change', async () => {
    const inst = fakeInstance({ [H(2)]: 150n * CSKIRM_UNIT, [H(4)]: 50n * CSKIRM_UNIT });
    const out = await revealPayout(inst as never, signer, MATCH, escrow(), 1);
    expect(out).toEqual({ staked: 150n * CSKIRM_UNIT, paid: 50n * CSKIRM_UNIT, net: -100n * CSKIRM_UNIT });
    const asked = inst.userDecrypt.mock.calls[0]![0] as { handle: string; contractAddress: string }[];
    expect(asked).toEqual([
      { handle: H(2), contractAddress: MATCH },
      { handle: H(4), contractAddress: MATCH },
    ]);
  });

  it('is null before the side is paid (no relayer round trip)', async () => {
    const inst = fakeInstance({});
    expect(await revealPayout(inst as never, signer, MATCH, escrow({ paid: [ZERO, ZERO] }), 0)).toBeNull();
    expect(inst.userDecrypt).not.toHaveBeenCalled();
  });
});
