import { describe, expect, it } from 'vitest';
import { OperatorQueue, operatorQueue } from '../src/zama/operator-queue';
import { ContractPredictionOperator, type PredictionsContract } from '../src/zama/predictions';
import { ContractLadderOperator, type LadderContract } from '../src/zama/private-ladder';
import { ContractMatchSettler } from '../src/zama/settlement';

const P1 = '0x0000000000000000000000000000000000000001';
const P2 = '0x0000000000000000000000000000000000000002';
const noRelayer = async () => {
  throw new Error('no relayer needed');
};

describe('operator queue', () => {
  it('is one queue per account, whatever the case', () => {
    expect(operatorQueue('0xAb')).toBe(operatorQueue('0xaB'));
    expect(operatorQueue('0xAb')).not.toBe(operatorQueue('0xcd'));
  });

  it('never has two transactions of settlement, predictions and the ladder in flight at once', async () => {
    let inFlight = 0;
    let most = 0;
    const order: string[] = [];
    const tx = async (name: string) => {
      most = Math.max(most, ++inFlight);
      order.push(name);
      return {
        hash: `0x${name}`,
        wait: async () => {
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
        },
      };
    };
    const queue = new OperatorQueue();
    const settler = new ContractMatchSettler({ getMatch: async () => ({ status: 4n }), settle: () => tx('settle') }, queue);
    const predictions = new ContractPredictionOperator({ resolve: () => tx('resolve') } as unknown as PredictionsContract, noRelayer, queue);
    const signer = { address: P1, signTypedData: async () => '0x' };
    const ladder = new ContractLadderOperator(P2, { report: () => tx('report') } as unknown as LadderContract, signer, noRelayer, queue);
    await Promise.all([settler.settle('m', 'A', '1'.repeat(64)), predictions.resolve('m', 'A'), ladder.report('m', P1, P2, 'A')]);
    expect(most).toBe(1);
    expect([...order].sort()).toEqual(['report', 'resolve', 'settle']);
  });

  it('goes on after a failed send, and past one that is stuck', async () => {
    const q = new OperatorQueue(20);
    await expect(
      q.run(async () => {
        throw new Error('reverted');
      }),
    ).rejects.toThrow('reverted');
    void q.run(() => new Promise(() => undefined));
    expect(await q.run(async () => 'next')).toBe('next');
  });
});
