// Sealed supply drops in the realtime match: the chain is read ahead of a drop's tick without
// blocking the loop, a revealed value places the drop, a late one delays it, and the seed stands in
// once the grace runs out.
import { createMatch, mapV2, sealedDropTile, seedDropValue, type AgentSpec } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { ChainDrops, DROP_GRACE_TICKS, DROP_LOOKAHEAD_TICKS, DROP_POLL_MS } from '../src/v2/chain-drops';

const copper = mapV2('copper-hollow')!;
const TICK = copper.drops[0]!.tick;
const agent = (id: string): AgentSpec => ({ id, name: id, role: 'Runner', vision: 3, comms: 3, tier: 'standard' });
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(value: () => number | null) {
  let now = 0;
  const reads: number[] = [];
  const source = {
    seed: '42',
    async dropValue(slot: number) {
      reads.push(slot);
      return value();
    },
  };
  const drops = new ChainDrops(source, () => now, quiet, 'test');
  const s = createMatch(copper, { A: [agent('a')], B: [agent('b')] }, { seed: '42', sealedDrops: true });
  /** Places for tick `next`, as the match loop does (the state is one tick before it). */
  const placeAt = (next: number) => {
    s.tick = next - 1;
    return drops.place(s, next);
  };
  return { s, placeAt, reads, advance: (ms: number) => (now += ms) };
}

describe('ChainDrops', () => {
  it('reads only once a drop is near, then places it on its tick', async () => {
    const { s, placeAt, reads } = setup(() => 513);
    expect(placeAt(TICK - DROP_LOOKAHEAD_TICKS - 1)).toEqual([]);
    expect(reads).toEqual([]);
    expect(placeAt(TICK - DROP_LOOKAHEAD_TICKS)).toEqual([]);
    expect(reads).toEqual([0]);
    await flush();
    expect(placeAt(TICK - 1)).toEqual([]);
    expect(placeAt(TICK)).toEqual([{ slot: 0, value: 513, at: sealedDropTile(s.map, 513) }]);
    expect(s.drops![0]).toMatchObject({ tick: TICK, value: 513 });
    expect(s.drops![0]!.sealed).toBeUndefined();
  });

  it('waits for a late reveal, reading at most every DROP_POLL_MS', async () => {
    let revealed: number | null = null;
    const { s, placeAt, reads, advance } = setup(() => revealed);
    placeAt(TICK);
    await flush();
    expect(placeAt(TICK + 1)).toEqual([]);
    expect(reads).toHaveLength(1);
    advance(DROP_POLL_MS);
    revealed = 9;
    placeAt(TICK + 2);
    await flush();
    expect(reads).toHaveLength(2);
    expect(placeAt(TICK + 3)).toEqual([{ slot: 0, value: 9, at: sealedDropTile(s.map, 9) }]);
    expect(s.drops![0]!.tick).toBe(TICK + 3);
  });

  it('falls back to the seed once the grace runs out', async () => {
    const { s, placeAt } = setup(() => null);
    placeAt(TICK);
    await flush();
    expect(placeAt(TICK + DROP_GRACE_TICKS - 1)).toEqual([]);
    const v = seedDropValue('42', 0);
    expect(placeAt(TICK + DROP_GRACE_TICKS)).toEqual([{ slot: 0, value: v, at: sealedDropTile(s.map, v), fromSeed: true }]);
  });
});
