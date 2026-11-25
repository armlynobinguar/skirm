import { describe, expect, it } from 'vitest';
import { sealedMatchKey } from '../src/zama/sealed-match';
import { ContractLadderOperator, createLadderOperator, ladderAddress, ladderWinnerSide, type LadderContract } from '../src/zama/private-ladder';

const ADDR = '0x00000000000000000000000000000000000000ee';
const OPERATOR = '0x00000000000000000000000000000000000000aa';
const P1 = '0x0000000000000000000000000000000000000001';
const P2 = '0x0000000000000000000000000000000000000002';
const TIER = '0x' + 'c'.repeat(64);
const CLOSE = '0x' + 'd'.repeat(64);

/** A PrivateLadder fake: records every call. */
function fakeContract() {
  const calls: unknown[][] = [];
  let pending = 0;
  const tx = (name: string, ...args: unknown[]) => {
    calls.push([name, ...args]);
    const n = ++pending;
    return Promise.resolve({
      hash: `0x${name}`,
      wait: async () => {
        // A tx is mined before the next one is sent (the operator serializes its nonce use).
        expect(pending).toBe(n);
      },
    });
  };
  const contract: LadderContract = {
    async playerOf() {
      return { registered: true, tier: 2n, tierPending: true, matches: 7n };
    },
    async reported() {
      return false;
    },
    async tierHandle() {
      return TIER;
    },
    async closeCheck() {
      return CLOSE;
    },
    report: (k, a, b, side) => tx('report', k, a, b, side),
    revealTier: (a, clear, proof) => tx('revealTier', a, clear, proof),
    isCloseMatch: (a, b) => tx('isCloseMatch', a, b),
  };
  return { contract, calls };
}

const signer = { address: OPERATOR, signTypedData: async () => '0xsig' };
const noRelayer = async () => {
  throw new Error('no relayer needed');
};

describe('private ladder operator', () => {
  it('maps winners to contract sides and reads the public player record', async () => {
    expect([ladderWinnerSide('A'), ladderWinnerSide('B'), ladderWinnerSide(null)]).toEqual([0, 1, 255]);
    const op = new ContractLadderOperator(ADDR, fakeContract().contract, signer, noRelayer);
    expect(await op.player(P1)).toEqual({ registered: true, tier: 2, tierPending: true, matches: 7 });
    expect(await op.reported('mat_1')).toBe(false);
  });

  it('reports keyed by keccak256 of the match id, one transaction at a time', async () => {
    const { contract, calls } = fakeContract();
    const op = new ContractLadderOperator(ADDR, contract, signer, noRelayer);
    const [h1, h2] = await Promise.all([op.report('mat_1', P1, P2, 'B'), op.report('mat_2', P1, P2, null)]);
    expect([h1, h2]).toEqual(['0xreport', '0xreport']);
    expect(calls).toEqual([
      ['report', sealedMatchKey('mat_1'), P1, P2, 1],
      ['report', sealedMatchKey('mat_2'), P1, P2, 255],
    ]);
  });

  it('publicly decrypts the pending tier and submits it with the KMS proof', async () => {
    const { contract, calls } = fakeContract();
    const op = new ContractLadderOperator(ADDR, contract, signer, async () => ({
      generateKeypair: () => ({ publicKey: 'pk', privateKey: 'sk' }),
      createEIP712: () => ({ domain: {}, types: { UserDecryptRequestVerification: [] }, message: {} }),
      userDecrypt: async () => ({}),
      async publicDecrypt(handles: string[]) {
        expect(handles).toEqual([TIER]);
        return { clearValues: { [TIER.toUpperCase().replace('0X', '0x')]: 4n }, abiEncodedClearValues: '0xclear', decryptionProof: '0xproof' };
      },
    }));
    expect(await op.revealTier(P1)).toBe(4);
    expect(calls).toEqual([['revealTier', P1, '0xclear', '0xproof']]);
  });

  it('asks isCloseMatch and user-decrypts the one-bit answer as the operator', async () => {
    const { contract, calls } = fakeContract();
    const asked: unknown[][] = [];
    const op = new ContractLadderOperator(ADDR, contract, signer, async () => ({
      generateKeypair: () => ({ publicKey: 'pk', privateKey: 'sk' }),
      createEIP712: () => ({ domain: {}, types: { UserDecryptRequestVerification: [] }, message: {} }),
      async userDecrypt(handles, _sk, _pk, sig, contracts, user) {
        asked.push([handles, sig, contracts, user]);
        return { [CLOSE]: true };
      },
      publicDecrypt: async () => ({ clearValues: {}, abiEncodedClearValues: '0x', decryptionProof: '0x' }),
    }));
    expect(await op.isClose(P1, P2)).toBe(true);
    expect(calls).toEqual([['isCloseMatch', P1, P2]]);
    expect(asked).toEqual([[[{ handle: CLOSE, contractAddress: ADDR }], 'sig', [ADDR], OPERATOR]]);
  });

  it('is off without the flag, the contract or a valid operator key (never logging the key)', () => {
    const lines: string[] = [];
    const log = { warn: (m: string) => void lines.push(m) };
    expect(ladderAddress({ ZAMA_LADDER_ADDRESS: ADDR })).toBe(ADDR);
    expect(createLadderOperator({ ZAMA_LADDER_ADDRESS: ADDR }, log)).toBeNull();
    expect(createLadderOperator({ ZAMA_ENABLED: '1', ZAMA_LADDER_ADDRESS: ADDR }, log)).toBeNull();
    expect(createLadderOperator({ ZAMA_ENABLED: '1', ZAMA_LADDER_ADDRESS: ADDR, ZAMA_OPERATOR_PRIVATE_KEY: 'secret-ish' }, log)).toBeNull();
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).not.toContain('secret-ish');
    const key = '0x' + '1'.repeat(64);
    expect(createLadderOperator({ ZAMA_ENABLED: '1', ZAMA_LADDER_ADDRESS: ADDR, ZAMA_OPERATOR_PRIVATE_KEY: key }, log)).not.toBeNull();
  });
});
