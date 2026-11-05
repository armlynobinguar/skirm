// Gas, ice and electrified water: clouds drift and thin and cost every other action, ice slides a
// mover one more tile, a sparking cable stuns anyone on or next to the water it touches. All of it
// deterministic, in the events, and in the views (fog applies).
import { describe, expect, it } from 'vitest';
import {
  MAPS_V2,
  SHOCK_STUN,
  createMatch,
  frameFor,
  mapV2,
  observe,
  parseMapV2,
  stepMatch,
  type Action,
  type AgentSpec,
  type MapDefV2,
  type MatchEvent,
  type MatchState,
} from '../src/v2';

const agent = (id: string): AgentSpec => ({ id, name: id, role: 'Runner', vision: 2, comms: 3, tier: 'standard' });
const OPEN = ['###########', '#.........#', '#.........#', '#....E....#', '#.........#', '#.........#', '###########'];

function testMap(rows: string[], o: Partial<MapDefV2> = {}): MapDefV2 {
  const w = rows[0]!.length;
  return {
    schema: 'skirm.map/v2',
    id: 'test',
    code: 'TS-00',
    name: 'Test',
    region: 'Test',
    difficulty: 1,
    label: 'Test',
    blurb: '',
    item: 'Gem',
    deliverTo: 'Exit',
    goal: 2,
    rows,
    starts: { A: [[1, 1], [1, 2]], B: [[w - 2, 1], [w - 2, 2]] },
    exit: [(w - 1) / 2, 3],
    verbs: [],
    hazards: [],
    switches: [],
    drops: [],
    blockSupply: 2,
    fog: false,
    steal: false,
    night: false,
    ...o,
  };
}

const mv = (dir: 'N' | 'E' | 'S' | 'W'): Action => ({ type: 'move', dir });
const pos = (s: MatchState, id: string) => {
  const a = s.agents.find((x) => x.id === id)!;
  return [a.x, a.y];
};
const place = (s: MatchState, id: string, x: number, y: number) => {
  const a = s.agents.find((q) => q.id === id)!;
  a.x = x;
  a.y = y;
};
const kinds = (ev: MatchEvent[]) => ev.map((e) => e.kind);

describe('v2 ice', () => {
  const def = testMap(['###########', '#.........#', '#..#...#..#', '#....E....#', '#.........#', '#.........#', '###########'], {
    ice: [[2, 1], [8, 1], [2, 2], [8, 2]],
  });

  it('lays ice from the map and shows it as "=" in the rows', () => {
    const p = parseMapV2(def);
    expect(p.grid[1 * p.w + 2]).toBe('ice');
    const s = createMatch(def, { A: [agent('a')], B: [agent('b')] });
    expect(observe(s, 'a').rows[1]).toBe('#.=.....=.#');
  });

  it('slides a mover one more tile the same way', () => {
    const s = createMatch(def, { A: [agent('a')], B: [agent('b')] });
    const ev = stepMatch(s, { actions: { a: mv('E'), b: mv('W') } });
    expect(pos(s, 'a')).toEqual([3, 1]);
    expect(pos(s, 'b')).toEqual([7, 1]);
    expect(ev).toContainEqual({ kind: 'slid', agent: 'a', from: [2, 1], to: [3, 1] });
  });

  it('stops on the ice when the next tile is a wall or held by an agent', () => {
    const s = createMatch(def, { A: [agent('a'), agent('a2')], B: [agent('b'), agent('b2')] });
    // a2 at 1,2: ice at 2,2, wall at 3,2.
    let ev = stepMatch(s, { actions: { a2: mv('E') } });
    expect(pos(s, 'a2')).toEqual([2, 2]);
    expect(kinds(ev)).not.toContain('slid');
    // b stands where a would slide to.
    place(s, 'b', 3, 1);
    ev = stepMatch(s, { actions: { a: mv('E') } });
    expect(pos(s, 'a')).toEqual([2, 1]);
    expect(kinds(ev)).not.toContain('slid');
  });

  it('refuses ice that is not mirrored or not on open floor', () => {
    expect(() => parseMapV2(testMap(OPEN, { ice: [[2, 1]] }))).toThrow(/not mirrored/);
    expect(() => parseMapV2(testMap(OPEN, { ice: [[1, 1], [9, 1]] }))).toThrow(/away from the starts/);
  });
});

describe('v2 gas', () => {
  const rows = ['###########', '#.........#', '#.........#', '#....E....#', '#...#.#...#', '#.........#', '###########'];
  const def = testMap(rows, { gas: [{ at: [3, 4], every: 5, strength: 3 }, { at: [7, 4], every: 5, strength: 3 }] });
  const at = (s: MatchState, x: number, y: number) => s.gas[y * s.map.w + x];

  it('puffs on its beat, drifts a tile a tick, thins and clears; walls stop it', () => {
    const s = createMatch(def, { A: [agent('a')], B: [agent('b')] });
    let ev: MatchEvent[] = [];
    for (let t = 1; t <= 5; t++) ev = stepMatch(s, { actions: {} });
    expect(ev).toContainEqual({ kind: 'gas_vent', at: [3, 4] });
    expect(at(s, 3, 4)).toBe(3);
    stepMatch(s, { actions: {} });
    expect([at(s, 3, 4), at(s, 2, 4), at(s, 3, 5), at(s, 3, 3)]).toEqual([2, 2, 2, 2]);
    expect(at(s, 4, 4)).toBeUndefined(); // a wall
    stepMatch(s, { actions: {} });
    expect(at(s, 4, 3)).toBe(1);
    expect(at(s, 5, 4)).toBeUndefined(); // only reachable through the wall
    stepMatch(s, { actions: {} });
    expect(Object.keys(s.gas).filter((j) => Number(j) % s.map.w < 5)).toEqual([]);
  });

  it('costs an agent standing in it every other action', () => {
    const s = createMatch(testMap(rows, { gas: [{ at: [3, 4], every: 99, strength: 3 }, { at: [7, 4], every: 99, strength: 3 }] }), { A: [agent('a')], B: [agent('b')] });
    place(s, 'a', 2, 5);
    s.gas[5 * s.map.w + 2] = 5;
    s.gas[5 * s.map.w + 1] = 5;
    expect(observe(s, 'a').choking).toBe(true);
    let ev = stepMatch(s, { actions: { a: mv('W') } });
    expect(ev).toContainEqual({ kind: 'choked', agent: 'a' });
    expect(pos(s, 'a')).toEqual([2, 5]);
    expect(observe(s, 'a').choking).toBe(false);
    ev = stepMatch(s, { actions: { a: mv('W') } });
    expect(pos(s, 'a')).toEqual([1, 5]);
    // Still in the cloud: the next action is lost again.
    ev = stepMatch(s, { actions: { a: mv('N') } });
    expect(ev).toContainEqual({ kind: 'choked', agent: 'a' });
    expect(pos(s, 'a')).toEqual([1, 5]);
  });

  it('shows only the gas the crew can see, as tiles in the observation and indexes in the frame', () => {
    const s = createMatch({ ...def, fog: true }, { A: [agent('a')], B: [agent('b')] });
    s.gas[4 * s.map.w + 2] = 2; // drifts into crew A's sight (its agent at 1,1 sees 3 tiles)
    s.gas[5 * s.map.w + 8] = 2; // across the map: out of A's sight
    stepMatch(s, { actions: {} }); // sight updates; the gas thins and drifts
    const o = observe(s, 'a');
    expect(o.gas!.length).toBeGreaterThan(0);
    expect(o.gas!.every(([x, y]) => s.visible.A[y * s.map.w + x])).toBe(true);
    expect(o.gas!.some(([x]) => x >= 7)).toBe(false);
    const f = frameFor(s, 'A', []);
    expect(f.gas).toEqual(o.gas!.map(([x, y]) => y * s.map.w + x));
    expect(frameFor(s, 'watch', []).gas!.some((j) => j % s.map.w >= 7)).toBe(true);
    // Maps without gas or sparks keep their frames and observations as they were.
    const plain = createMatch(testMap(OPEN), { A: [agent('a')], B: [agent('b')] });
    expect('gas' in frameFor(plain, 'A', [])).toBe(false);
    expect('shock' in observe(plain, 'a')).toBe(false);
  });
});

describe('v2 electrified water', () => {
  const rows = ['###########', '#.........#', '#.........#', '#....E....#', '#.........#', '#~~.....~~#', '###########'];
  const def = testMap(rows, {
    sparks: [
      { at: [1, 6], name: 'West cable', every: 4, ticks: 2 },
      { at: [9, 6], name: 'East cable', every: 4, ticks: 2 },
    ],
  });

  it('electrifies the water the cable touches and stuns anyone on or next to it', () => {
    const s = createMatch(def, { A: [agent('a'), agent('a2')], B: [agent('b')] });
    place(s, 'a', 3, 5); // next to 2,5
    place(s, 'a2', 4, 5); // two tiles off: safe
    let ev: MatchEvent[] = [];
    for (let t = 1; t <= 4; t++) ev = stepMatch(s, { actions: {} });
    expect(ev).toContainEqual({ kind: 'sparked', name: 'West cable', at: [1, 6], until: 6, tiles: 2 });
    expect(ev).toContainEqual({ kind: 'shocked', agent: 'a', by: 'West cable' });
    expect(kinds(ev).filter((k) => k === 'shocked')).toHaveLength(1);
    expect(s.agents.find((a) => a.id === 'a')!.stun).toBe(SHOCK_STUN);
    const w = s.map.w;
    expect(s.shocked).toEqual([5 * w + 1, 5 * w + 2, 5 * w + 8, 5 * w + 9]);
    expect(observe(s, 'a2').shock).toEqual([[1, 5], [2, 5], [8, 5], [9, 5]]);
    expect(observe(s, 'a').legal).toEqual([{ type: 'wait' }]);
    // The stunned agent loses its moves; the water goes dead after `ticks`.
    stepMatch(s, { actions: { a: mv('N') } });
    expect(pos(s, 'a')).toEqual([3, 5]);
    stepMatch(s, { actions: { a: mv('N') } });
    expect(s.shocked).toEqual([]);
    expect(pos(s, 'a')).toEqual([3, 5]);
    stepMatch(s, { actions: { a: mv('N') } });
    expect(pos(s, 'a')).toEqual([3, 4]);
  });

  it('refuses a cable off a wall or away from water', () => {
    expect(() => parseMapV2(testMap(rows, { sparks: [{ at: [5, 6], name: 'X', every: 4, ticks: 2 }] }))).toThrow(/touches no water/);
    expect(() => parseMapV2(testMap(rows, { sparks: [{ at: [3, 5], name: 'X', every: 4, ticks: 2 }, { at: [7, 5], name: 'Y', every: 4, ticks: 2 }] }))).toThrow(/not on a wall/);
    expect(() => parseMapV2(testMap(rows, { sparks: [{ at: [1, 6], name: 'X', every: 4, ticks: 2 }] }))).toThrow(/not mirrored/);
  });
});

describe('v2 field hazards on the official maps', () => {
  it('Frostline Depot has mirrored ice; Sunken Metro has gas vents and live rails', () => {
    expect(mapV2('frostline-depot')!.ice!.length).toBeGreaterThan(0);
    expect(mapV2('sunken-metro')!.gas).toHaveLength(2);
    expect(mapV2('sunken-metro')!.sparks).toHaveLength(2);
    // The other maps have none.
    for (const m of MAPS_V2) if (m.id !== 'frostline-depot' && m.id !== 'sunken-metro') expect([m.ice, m.gas, m.sparks]).toEqual([undefined, undefined, undefined]);
  });

  it('plays Sunken Metro the same way twice, with vents and sparks in the events', () => {
    const run = () => {
      const s = createMatch(mapV2('sunken-metro')!, { A: [agent('a'), agent('a2')], B: [agent('b'), agent('b2')] });
      const all: MatchEvent[] = [];
      const dirs = ['E', 'S', 'E', 'N', 'S', 'E', 'W', 'S'] as const;
      for (let t = 0; t < 60; t++)
        all.push(...stepMatch(s, { actions: { a: mv(dirs[t % 8]!), a2: mv(dirs[(t + 3) % 8]!), b: mv('W'), b2: mv(dirs[(t + 5) % 8]!) } }));
      return { all, gas: s.gas, shocked: s.shocked, agents: s.agents.map((a) => [a.x, a.y, a.stun]) };
    };
    const one = run();
    expect(run()).toEqual(one);
    expect(kinds(one.all)).toContain('gas_vent');
    expect(kinds(one.all)).toContain('sparked');
  });
});
