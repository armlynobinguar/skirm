// The randomness client logic with the chain faked: when each drop may open, the value → tile
// mapping the server uses, and the reveal driver (team A sends, team B only as fallback).
import { dropCandidates, mapV2, parseMapV2 } from '@skirm/engine/v2';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: '', explorerUrl: 'https://sepolia.etherscan.io', contracts: { credits: null, match: null } },
}));

import {
  DROP_FALLBACK_POLLS,
  DROP_INTERVAL_S,
  driveDropReveals,
  dropDueAt,
  dropTileOf,
  explorerUrl,
  isDrawn,
  nextDropAction,
  shortSeed,
  type ChainRandomness,
  type RandomnessApi,
} from './randomness';

const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as const;
const START = 1_800_000_000;

const rnd = (o: Partial<ChainRandomness> = {}): ChainRandomness => ({
  seedHandle: H(1),
  dropHandles: [H(2), H(3), H(4)],
  seed: '42',
  drops: [null, null, null],
  startedAt: START,
  dropsRequested: 0,
  dropsRevealed: 0,
  ...o,
});

/** An in-memory SkirmMatch randomness with the contract's ordering rules. */
function fakeChain(values = [11, 22, 33]) {
  const r = rnd();
  const calls: string[] = [];
  const api: RandomnessApi = {
    read: vi.fn(async () => ({ ...r, drops: [...r.drops] })),
    txs: vi.fn(async () => ({ seed: null, drops: [null, null, null] })),
    revealDrop: vi.fn(async (_k, slot) => {
      calls.push(`reveal:${slot}`);
      if (slot !== r.dropsRequested || r.dropsRequested !== r.dropsRevealed) throw new Error('DropOutOfOrder');
      r.dropsRequested++;
    }),
    finalizeDrop: vi.fn(async (_k, slot) => {
      calls.push(`finalize:${slot}`);
      r.drops[slot] = values[slot]!;
      r.dropsRevealed++;
    }),
  };
  return { r, api, calls };
}

const instance = { publicDecrypt: vi.fn(async (h: string[]) => ({ clearValues: { [h[0]!]: 1n }, abiEncodedClearValues: '0x01', decryptionProof: '0x02' })) } as never;

describe('nextDropAction', () => {
  it('waits for the reveal, then for each slot to come due, in order', () => {
    expect(nextDropAction(rnd({ startedAt: 0, seed: null }), START)).toEqual({ kind: 'wait', slot: 0, untilSec: null });
    expect(dropDueAt(rnd(), 1)).toBe(START + 2 * DROP_INTERVAL_S);
    expect(nextDropAction(rnd(), START + DROP_INTERVAL_S - 1)).toEqual({ kind: 'wait', slot: 0, untilSec: START + DROP_INTERVAL_S });
    expect(nextDropAction(rnd(), START + DROP_INTERVAL_S)).toEqual({ kind: 'reveal', slot: 0 });
    expect(nextDropAction(rnd({ dropsRequested: 1 }), START + 999)).toEqual({ kind: 'finalize', slot: 0 });
    expect(nextDropAction(rnd({ dropsRequested: 1, dropsRevealed: 1 }), START + 999)).toEqual({ kind: 'reveal', slot: 1 });
  });

  it('stops at the slots asked for', () => {
    expect(nextDropAction(rnd({ dropsRequested: 1, dropsRevealed: 1 }), START + 999, 1)).toEqual({ kind: 'done' });
    expect(nextDropAction(rnd({ dropsRequested: 3, dropsRevealed: 3 }), START + 999)).toEqual({ kind: 'done' });
  });
});

describe('helpers', () => {
  it('maps a value to the tile the server lands the drop on', () => {
    const c = dropCandidates(parseMapV2(mapV2('copper-hollow')!));
    expect(dropTileOf('copper-hollow', 0)).toEqual(c[0]);
    expect(dropTileOf('copper-hollow', c.length + 2)).toEqual(c[2 % c.length]);
    expect(dropTileOf('no-such-map', 1)).toBeNull();
  });

  it('links a transaction, else the contract, and shortens a seed', () => {
    expect(explorerUrl(H(5))).toBe(`https://sepolia.etherscan.io/tx/${H(5)}`);
    expect(explorerUrl(null, '0xabc')).toBe('https://sepolia.etherscan.io/address/0xabc');
    expect(explorerUrl(null)).toBeNull();
    expect(shortSeed('18446744073709551615')).toBe('184467…1615');
    expect(shortSeed('42')).toBe('42');
    expect(isDrawn(rnd({ seedHandle: `0x${'0'.repeat(64)}` }))).toBe(false);
  });
});

describe('driveDropReveals', () => {
  it('team A opens each due drop: reveal, public decrypt, finalize', async () => {
    const { api, calls } = fakeChain();
    const r = await driveDropReveals({ api, instance, key: H(9), team: 'A', slots: 2, nowSec: () => START + 999, sleep: async () => undefined });
    expect(calls).toEqual(['reveal:0', 'finalize:0', 'reveal:1', 'finalize:1']);
    expect(r.drops).toEqual([11, 22, null]);
  });

  it('team B waits for team A, and steps in after the fallback polls', async () => {
    const { api, calls } = fakeChain();
    let now = START + DROP_INTERVAL_S;
    const sleeps: number[] = [];
    await driveDropReveals({
      api,
      instance,
      key: H(9),
      team: 'B',
      slots: 1,
      nowSec: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += 1;
      },
    });
    expect(calls).toEqual(['reveal:0', 'finalize:0']);
    // It held back DROP_FALLBACK_POLLS polls before each of its own transactions.
    expect(sleeps.length).toBeGreaterThanOrEqual(2 * DROP_FALLBACK_POLLS);
  });

  it('does not send before a drop is due', async () => {
    const { api, calls } = fakeChain();
    let now = START;
    await driveDropReveals({ api, instance, key: H(9), team: 'A', slots: 1, nowSec: () => now, sleep: async (ms) => void (now += Math.ceil(ms / 1000)) });
    expect(calls).toEqual(['reveal:0', 'finalize:0']);
    expect(now).toBeGreaterThanOrEqual(START + DROP_INTERVAL_S);
  });
});
