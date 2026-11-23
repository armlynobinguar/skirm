// Supply drops from randomness (Zama matches): the value → tile mapping, a drop schedule given up
// front, sealed drops placed mid-match, the match seed, and that all of it stays deterministic.
import { describe, expect, it } from 'vitest';
import {
  DROP_VALUE_MAX,
  MAPS_V2,
  createMatch,
  dropCandidates,
  dropsOf,
  mapV2,
  parseMapV2,
  placeSealedDrop,
  sealedDropTile,
  sealedDropsDue,
  seedDropValue,
  startLog,
  stepMatch,
  type AgentSpec,
  type LogHeader,
  type MatchEvent,
  type MatchState,
} from '../src/v2';
import { canonicalJson as rootCanonical } from '../src/canonical';

const snapshot = (s: MatchState) => JSON.stringify({ ...s, map: undefined });

const agent = (id: string): AgentSpec => ({ id, name: id, role: 'Runner', vision: 3, comms: 3, tier: 'standard' });
const crews = () => ({ A: [agent('a1')], B: [agent('b1')] });
const copper = mapV2('copper-hollow')!;
const parsed = parseMapV2(copper);

/** Waits out `n` ticks; returns every event. */
function run(s: MatchState, n: number): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (let i = 0; i < n && !s.result; i++) ev.push(...stepMatch(s, { actions: {} }));
  return ev;
}

const drops = (ev: MatchEvent[]) => ev.filter((e): e is Extract<MatchEvent, { kind: 'supply_drop' }> => e.kind === 'supply_drop');

describe('dropCandidates and sealedDropTile', () => {
  it('lists open centre-column floor, top to bottom, the map drop tile among them', () => {
    const c = dropCandidates(parsed);
    const mid = (parsed.w - 1) / 2;
    expect(c.length).toBeGreaterThan(1);
    for (const [x, y] of c) {
      expect(x).toBe(mid);
      expect(parsed.grid[y * parsed.w + x]).toBeNull();
    }
    expect(c.map(([, y]) => y)).toEqual([...c.map(([, y]) => y)].sort((a, b) => a - b));
    expect(c).toContainEqual(copper.drops[0]!.at);
    expect(c).not.toContainEqual(copper.exit);
  });

  it('gives every official map with supply drops somewhere to put them', () => {
    for (const def of MAPS_V2) if (def.drops.length) expect(dropCandidates(parseMapV2(def)).length, def.id).toBeGreaterThan(0);
  });

  it('maps a value to candidates[value mod their number], the same every time', () => {
    const c = dropCandidates(parsed);
    expect(sealedDropTile(parsed, 0)).toEqual(c[0]);
    expect(sealedDropTile(parsed, c.length)).toEqual(c[0]);
    expect(sealedDropTile(parsed, c.length + 1)).toEqual(c[1 % c.length]);
    expect(sealedDropTile(parsed, DROP_VALUE_MAX)).toEqual(c[DROP_VALUE_MAX % c.length]);
    expect(sealedDropTile(parsed, 12345)).toEqual(sealedDropTile(parseMapV2(copper), 12345));
  });

  it('refuses a value that is not a non-negative integer', () => {
    expect(() => sealedDropTile(parsed, -1)).toThrow();
    expect(() => sealedDropTile(parsed, 1.5)).toThrow();
  });

  it('derives a stand-in value from the seed, in uint16 range and stable', () => {
    const v = seedDropValue('1234567890123456789', 0);
    expect(v).toBe(seedDropValue('1234567890123456789', 0));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(DROP_VALUE_MAX);
    expect(seedDropValue('1234567890123456789', 1)).not.toBe(v);
  });
});

describe('createMatch drop inputs', () => {
  it('leaves a match without them exactly as before', () => {
    const s = createMatch(copper, crews());
    expect(s.drops).toBeUndefined();
    expect(s.seed).toBeUndefined();
    expect(dropsOf(s)).toBe(s.map.def.drops);
    expect(drops(run(s, copper.drops[0]!.tick)).map((e) => e.at)).toEqual([copper.drops[0]!.at]);
  });

  it('lands a scheduled drop on the tile its value maps to, at the map tick', () => {
    const value = 40_001;
    const s = createMatch(copper, crews(), { dropSchedule: [{ value }] });
    const at = sealedDropTile(s.map, value);
    expect(s.drops).toEqual([{ at, tick: copper.drops[0]!.tick, value }]);
    const ev = run(s, copper.drops[0]!.tick);
    expect(drops(ev).map((e) => e.at)).toEqual([at]);
    expect(s.grid[at[1] * s.map.w + at[0]]).toBe('item');
  });

  it('takes a scheduled tile and tick, and refuses an illegal tile or a wrong count', () => {
    const at = dropCandidates(parsed)[0]!;
    const s = createMatch(copper, crews(), { dropSchedule: [{ at, tick: 5 }] });
    expect(drops(run(s, 5)).map((e) => e.at)).toEqual([at]);
    expect(() => createMatch(copper, crews(), { dropSchedule: [{ at: [1, 1] }] })).toThrow(/cannot land/);
    expect(() => createMatch(copper, crews(), { dropSchedule: [] })).toThrow(/1 supply drops/);
  });

  it('records a valid seed and refuses anything that is not a decimal uint64', () => {
    expect(createMatch(copper, crews(), { seed: '18446744073709551615' }).seed).toBe('18446744073709551615');
    for (const bad of ['', 'abc', '-1', '01', '18446744073709551616', '1e3']) expect(() => createMatch(copper, crews(), { seed: bad }), bad).toThrow();
  });
});

describe('sealed drops', () => {
  it('does not land a sealed drop until it is placed', () => {
    const s = createMatch(copper, crews(), { sealedDrops: true });
    const tick = copper.drops[0]!.tick;
    expect(sealedDropsDue(s, tick - 1)).toEqual([]);
    expect(sealedDropsDue(s, tick)).toEqual([0]);
    expect(drops(run(s, tick + 3))).toEqual([]);
    // Placed late: it lands on the next tick, on the tile its value maps to.
    const placed = placeSealedDrop(s, 0, 7);
    expect(placed).toEqual({ at: sealedDropTile(s.map, 7), tick: s.tick + 1, value: 7 });
    expect(drops(run(s, 1)).map((e) => e.at)).toEqual([placed.at]);
    expect(sealedDropsDue(s, s.tick)).toEqual([]);
    expect(() => placeSealedDrop(s, 0, 7)).toThrow(/not sealed/);
  });

  it('lands a drop placed early on its map tick, not before', () => {
    const s = createMatch(copper, crews(), { sealedDrops: true });
    placeSealedDrop(s, 0, 3);
    const tick = copper.drops[0]!.tick;
    expect(drops(run(s, tick - 1))).toEqual([]);
    expect(drops(run(s, 1))).toHaveLength(1);
  });

  it('refuses to place a drop in a match without sealed drops', () => {
    expect(() => placeSealedDrop(createMatch(copper, crews()), 0, 1)).toThrow(/not sealed/);
  });

  it('plays the same match from the same seed and drop values', () => {
    const play = () => {
      const s = createMatch(copper, crews(), { seed: '42', sealedDrops: true });
      run(s, 20);
      placeSealedDrop(s, 0, 999);
      run(s, 40);
      return snapshot(s);
    };
    expect(play()).toBe(play());
    const live = createMatch(copper, crews(), { seed: '42', sealedDrops: true });
    run(live, 20);
    placeSealedDrop(live, 0, 999);
    run(live, 40);
    const replay = createMatch(copper, crews(), { seed: '42', dropSchedule: [{ value: 999 }] });
    run(replay, 60);
    expect(live.grid).toEqual(replay.grid);
  });
});

describe('match log header', () => {
  const header: LogHeader = { schema: 'skirm.match/v2', map: copper.id, crews: { A: [], B: [] }, ranked: false, models: { planner: 'm', actor: 'm', speech: 'm' } };

  it('commits to the seed when there is one, and hashes as before when there is none', () => {
    const plain = startLog(header).hashes[0];
    expect(startLog({ ...header }).hashes[0]).toBe(plain);
    expect(rootCanonical({ ...header })).toBe(rootCanonical(header));
    const seeded = startLog({ ...header, seed: '42', sealedDrops: true }).hashes[0];
    expect(seeded).not.toBe(plain);
    expect(startLog({ ...header, seed: '43', sealedDrops: true }).hashes[0]).not.toBe(seeded);
  });
});
