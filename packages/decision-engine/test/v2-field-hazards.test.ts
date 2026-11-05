// The greedy brain and the prompts with gas, ice and electrified water: greedy routes around gas and
// live water when it can, plans a step onto ice as landing one tile further, and the turn prompt
// says in plain words what each one does.
import { createMatch, observe, type AgentSpec, type MapDefV2, type MatchState } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { greedyAct, observedSummary, turnPrompt } from '../src/v2';

const spec = (id: string): AgentSpec => ({ id, name: id, role: 'Runner', vision: 3, comms: 3, tier: 'standard' });

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
    starts: { A: [[1, 1]], B: [[w - 2, 1]] },
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

const play = (def: MapDefV2) => createMatch(def, { A: [spec('a')], B: [spec('b')] });
const at = (s: MatchState, x: number, y: number) => y * s.map.w + x;

describe('greedy with gas, ice and live water', () => {
  const rows = ['###########', '#..*...*..#', '#.........#', '#....E....#', '#.........#', '#.........#', '###########'];
  const vents: MapDefV2['gas'] = [
    { at: [4, 5], every: 99, strength: 3 },
    { at: [6, 5], every: 99, strength: 3 },
  ];

  it('walks straight to the item in clear air, and around a gas cloud in its way', () => {
    const s = play(testMap(rows, { gas: vents }));
    expect(greedyAct(observe(s, 'a'))).toEqual({ type: 'move', dir: 'E' });
    s.gas[at(s, 2, 1)] = 2;
    const o = observe(s, 'a');
    expect(o.gas).toEqual([[2, 1]]);
    expect(greedyAct(o)).toEqual({ type: 'move', dir: 'S' });
  });

  it('keeps a tile away from electrified water when there is another way', () => {
    const wet = ['###########', '#..~...~..#', '#.*.....*.#', '#....E....#', '#.........#', '#.........#', '###########'];
    const def = testMap(wet, {
      starts: { A: [[1, 2]], B: [[9, 2]] },
      sparks: [
        { at: [3, 0], name: 'West cable', every: 50, ticks: 3 },
        { at: [7, 0], name: 'East cable', every: 50, ticks: 3 },
      ],
    });
    const s = play(def);
    // The board as both crews have seen it changes with the grid (no tick is played here).
    const set = (x: number, y: number, t: MatchState['grid'][number]) => {
      s.grid[at(s, x, y)] = t;
      s.seen.A[at(s, x, y)] = t;
      s.seen.B[at(s, x, y)] = t;
    };
    // The item at 2,2 is one step east: it goes straight there.
    expect(greedyAct(observe(s, 'a'))).toEqual({ type: 'move', dir: 'E' });
    // Live water at 2,1 (as if it had spread) is next to the item, but the item is the goal: still east.
    set(2, 1, 'water');
    s.shocked = [at(s, 2, 1)];
    const o = observe(s, 'a');
    expect(o.shock).toEqual([[2, 1]]);
    expect(greedyAct(o)).toEqual({ type: 'move', dir: 'E' });
    // An item two steps out past the live bank: around it, not along it.
    set(2, 2, null);
    set(3, 2, 'item');
    s.shocked = [at(s, 2, 1), at(s, 3, 1)];
    expect(greedyAct(observe(s, 'a'))).toEqual({ type: 'move', dir: 'S' });
  });

  it('plans a step onto ice as landing one tile further', () => {
    const icy = ['###########', '#.........#', '#.*.....*.#', '#....E....#', '#.........#', '#.........#', '###########'];
    // Without ice, east then south reaches the item at 2,2; with ice at 2,1 the step east slides on to 3,1.
    expect(greedyAct(observe(play(testMap(icy)), 'a'))).toEqual({ type: 'move', dir: 'E' });
    const s = play(testMap(icy, { ice: [[2, 1], [8, 1]] }));
    expect(observe(s, 'a').rows[1]).toBe('#.=.....=.#');
    expect(greedyAct(observe(s, 'a'))).toEqual({ type: 'move', dir: 'S' });
  });
});

describe('prompts with gas, ice and live water', () => {
  it('names each one and what it does, only on maps that have them', () => {
    const plain = play(testMap(['###########', '#..*...*..#', '#.........#', '#....E....#', '#.........#', '#.........#', '###########']));
    const p0 = turnPrompt(observe(plain, 'a'), null, false);
    expect(p0).not.toMatch(/\b(gas|ice|electrified)\b/i);

    const def = testMap(['###########', '#..*...*..#', '#.........#', '#....E....#', '#.........#', '#~.......~#', '###########'], {
      ice: [[2, 2], [8, 2]],
      gas: [
        { at: [3, 3], every: 99, strength: 3 },
        { at: [7, 3], every: 99, strength: 3 },
      ],
      sparks: [
        { at: [0, 5], name: 'West cable', every: 99, ticks: 3 },
        { at: [10, 5], name: 'East cable', every: 99, ticks: 3 },
      ],
    });
    const s = play(def);
    s.gas[at(s, 1, 1)] = 2;
    s.shocked = [at(s, 1, 5)];
    const o = observe(s, 'a');
    const p = turnPrompt(o, null, false);
    expect(p).toContain('= is ice');
    expect(p).toContain('Gas cloud in sight at 1,1');
    expect(p).toContain('You are standing in gas');
    expect(p).toContain('Electrified water in sight at 1,5');
    expect(observedSummary(o)).toContain('choking in gas');
  });
});
