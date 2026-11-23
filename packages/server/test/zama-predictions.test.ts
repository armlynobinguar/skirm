import { describe, expect, it } from 'vitest';
import { sealedMatchKey } from '../src/zama/sealed-match';
import {
  ContractPredictionOperator,
  createPredictionOperator,
  parseChainMarket,
  predictionWinnerSide,
  predictionsAddress,
  type PredictionsContract,
} from '../src/zama/predictions';

const ADDR = '0x00000000000000000000000000000000000000dd';
const HA = '0x' + 'a'.repeat(64);
const HB = '0x' + 'b'.repeat(64);

/** A MatchPredictions fake: records every call. */
function fakeContract() {
  const calls: unknown[][] = [];
  const tx = (name: string, ...args: unknown[]) => {
    calls.push([name, ...args]);
    return Promise.resolve({ hash: `0x${name}`, wait: async () => undefined });
  };
  const contract: PredictionsContract = {
    async getMarket() {
      return { closesAt: 100n, status: 3n, winner: 255n, predictors: 4n, totalA: 40n, totalB: 20n };
    },
    async totalHandles() {
      return [HA, HB];
    },
    openMarket: (k, at) => tx('openMarket', k, at),
    close: (k) => tx('close', k),
    revealTotals: (k, clear, proof) => tx('revealTotals', k, clear, proof),
    resolve: (k, side) => tx('resolve', k, side),
  };
  return { contract, calls };
}

describe('prediction market operator', () => {
  it('maps winners to contract sides and parses the market tuple', () => {
    expect([predictionWinnerSide('A'), predictionWinnerSide('B'), predictionWinnerSide(null)]).toEqual([0, 1, 255]);
    expect(parseChainMarket({ closesAt: 100n, status: 4n, winner: 1n, predictors: 3n, totalA: 5n, totalB: 6n })).toEqual({
      status: 'resolved',
      closesAt: 100,
      predictors: 3,
      totalA: 5n,
      totalB: 6n,
      winner: 1,
    });
  });

  it('sends open, close and resolve keyed by keccak256 of the match id', async () => {
    const { contract, calls } = fakeContract();
    const op = new ContractPredictionOperator(contract, async () => {
      throw new Error('no relayer needed');
    });
    const key = sealedMatchKey('mat_1');
    expect(await op.open('mat_1', 1234)).toBe('0xopenMarket');
    expect(await op.close('mat_1')).toBe('0xclose');
    expect(await op.resolve('mat_1', 'B')).toBe('0xresolve');
    await op.resolve('mat_1', null);
    expect(calls).toEqual([
      ['openMarket', key, 1234],
      ['close', key],
      ['resolve', key, 1],
      ['resolve', key, 255],
    ]);
    expect((await op.read('mat_1')).status).toBe('revealed');
  });

  it('publicly decrypts both totals and submits them with the KMS proof', async () => {
    const { contract, calls } = fakeContract();
    const asked: string[][] = [];
    const op = new ContractPredictionOperator(contract, async () => ({
      async publicDecrypt(handles: string[]) {
        asked.push(handles);
        return { clearValues: { [HA.toUpperCase().replace('0X', '0x')]: 40n, [HB]: 20n }, abiEncodedClearValues: '0xclear', decryptionProof: '0xproof' };
      },
    }));
    const r = await op.revealTotals('mat_1');
    expect(asked).toEqual([[HA, HB]]);
    expect(r).toEqual({ txHash: '0xrevealTotals', totalA: 40n, totalB: 20n });
    expect(calls).toEqual([['revealTotals', sealedMatchKey('mat_1'), '0xclear', '0xproof']]);
  });

  it('is off without the flag, the contract or a valid operator key (never logging the key)', () => {
    const lines: string[] = [];
    const log = { warn: (m: string) => void lines.push(m) };
    expect(predictionsAddress({ ZAMA_PREDICTIONS_ADDRESS: ADDR })).toBe(ADDR);
    expect(createPredictionOperator({ ZAMA_PREDICTIONS_ADDRESS: ADDR }, log)).toBeNull();
    expect(createPredictionOperator({ ZAMA_ENABLED: '1', ZAMA_PREDICTIONS_ADDRESS: ADDR }, log)).toBeNull();
    expect(createPredictionOperator({ ZAMA_ENABLED: '1', ZAMA_PREDICTIONS_ADDRESS: ADDR, ZAMA_OPERATOR_PRIVATE_KEY: 'secret-ish' }, log)).toBeNull();
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).not.toContain('secret-ish');
    const key = '0x' + '1'.repeat(64);
    expect(createPredictionOperator({ ZAMA_ENABLED: '1', ZAMA_PREDICTIONS_ADDRESS: ADDR, ZAMA_OPERATOR_PRIVATE_KEY: key }, log)).not.toBeNull();
  });
});
