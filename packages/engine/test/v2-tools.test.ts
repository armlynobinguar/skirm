import { describe, expect, it } from 'vitest';
import {
  MAPS_V2,
  PUMP_TICKS,
  SUPPLY_TOOLS,
  actionText,
  cloneMatch,
  createMatch,
  dropTool,
  frameFor,
  legalActions,
  observe,
  parseAction,
  stepMatch,
  type Action,
  type AgentSpec,
  type MapDefV2,
  type MatchState,
} from '../src/v2';

const agent = (id: string): AgentSpec => ({ id, name: id, role: 'Runner', vision: 3, comms: 3, tier: 'standard' });

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
    exit: [(w - 1) / 2, 5],
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

const OPEN = ['###########', '#.........#', '#.........#', '#.........#', '#.........#', '#....E....#', '###########'];
const play = (s: MatchState, actions: Record<string, Action>) => stepMatch(s, { actions });
const at = (s: MatchState, x: number, y: number) => s.grid[y * s.map.w + x];
const crews = { A: [agent('a')], B: [agent('b')] };

/** A match where agent a holds `tool` from the start (picked off the ground on tick 1). */
function holding(tool: 'sandbag' | 'pump' | 'bridge', def = testMap(OPEN)): MatchState {
  const s = createMatch(def, crews);
  s.gear!.ground[1 * s.map.w + 1] = tool;
  play(s, {});
  expect(s.agents[0]!.tool).toBe(tool);
  return s;
}

describe('supply tools', () => {
  it('a drop lands its tool beside the item; stepping on it takes both, one tool at most', () => {
    const def = testMap(OPEN, { drops: [{ at: [2, 1], tick: 1, tool: 'pump' }, { at: [3, 1], tick: 1, tool: 'bridge' }] });
    const s = createMatch(def, crews);
    const ev = play(s, {});
    expect(ev).toContainEqual({ kind: 'tool_dropped', tool: 'pump', at: [2, 1] });
    expect(frameFor(s, 'A', ev).tools).toEqual([
      { at: [2, 1], kind: 'pump' },
      { at: [3, 1], kind: 'bridge' },
    ]);
    const ev2 = play(s, { a: { type: 'move', dir: 'E' } });
    expect(ev2).toContainEqual({ kind: 'tool_picked', agent: 'a', tool: 'pump', at: [2, 1] });
    expect(s.agents[0]!.carrying.length).toBe(1);
    play(s, { a: { type: 'move', dir: 'E' } });
    // Hands full of tool: the bridge stays on the ground.
    expect(s.agents[0]!.tool).toBe('pump');
    expect(s.gear!.ground[1 * s.map.w + 3]).toBe('bridge');
    expect(observe(s, 'a').me.tool).toBe('pump');
    expect(frameFor(s, 'watch', []).agents.find((a) => a.id === 'a')!.tool).toBe('pump');
  });

  it('sandbags stop water spreading into their tile, and agents step over them', () => {
    const rows = ['###########', '#.........#', '#.........#', '#~........#', '#.........#', '#....E....#', '###########'];
    const s = holding('sandbag', testMap(rows, { hazards: [{ kind: 'water', every: 3, cap: 9 }] }));
    // Next to the water at (1,3): the sandbag goes on (2,3).
    s.agents[0]!.x = 2;
    s.agents[0]!.y = 2;
    const use: Action = { type: 'use', tool: 'sandbag', dir: 'S' };
    expect(legalActions(s, 'a')).toContainEqual(use);
    const ev = play(s, { a: use });
    expect(ev).toContainEqual({ kind: 'tool_used', agent: 'a', tool: 'sandbag', at: [2, 3] });
    expect(s.agents[0]!.tool).toBeUndefined();
    s.agents[0]!.x = 8;
    for (let i = 0; i < 4; i++) play(s, {});
    expect(at(s, 2, 3)).toBeNull();
    expect(at(s, 1, 4)).toBe('water');
    expect(at(s, 2, 2)).toBe('water');
    s.agents[0]!.x = 3;
    s.agents[0]!.y = 3;
    expect(legalActions(s, 'a')).toContainEqual({ type: 'move', dir: 'W' });
  });

  it('a bridge makes a water tile walkable and water there never knocks the agent down', () => {
    const rows = ['###########', '#.~.......#', '#.~.......#', '#.~.......#', '#.~.......#', '#.~..E....#', '###########'];
    const s = holding('bridge', testMap(rows));
    expect(legalActions(s, 'a').some((x) => x.type === 'move' && x.dir === 'E')).toBe(false);
    const use = parseAction('use bridge E', legalActions(s, 'a'))!;
    expect(actionText(use)).toBe('use bridge E');
    play(s, { a: use });
    expect(at(s, 2, 1)).toBe('water');
    play(s, { a: { type: 'move', dir: 'E' } });
    expect([s.agents[0]!.x, s.agents[0]!.y]).toEqual([2, 1]);
    play(s, { a: { type: 'move', dir: 'E' } });
    expect(s.agents[0]!.x).toBe(3);
    expect(frameFor(s, 'B', []).placed).toEqual([{ at: [2, 1], kind: 'bridge' }]);
  });

  it('a pump drains a widening ring for PUMP_TICKS ticks, then is spent', () => {
    const rows = ['###########', '#.........#', '#..~~~~...#', '#..~~~~...#', '#..~~~~...#', '#....E....#', '###########'];
    const s = holding('pump', testMap(rows));
    s.agents[0]!.x = 4;
    s.agents[0]!.y = 1;
    const use: Action = { type: 'use', tool: 'pump', dir: 'S' };
    const ev = play(s, { a: use });
    expect(ev).toContainEqual({ kind: 'pumped', at: [4, 2], drained: 4, done: false });
    expect(observe(s, 'a').gear?.placed).toEqual([{ at: [4, 2], kind: 'pump', ticksLeft: PUMP_TICKS - 1 }]);
    for (let i = 1; i < PUMP_TICKS; i++) play(s, {});
    for (const [x, y] of [[4, 2], [3, 2], [5, 2], [4, 3], [4, 4], [3, 3], [5, 3]]) expect(at(s, x!, y!)).toBeNull();
    expect(at(s, 6, 4)).toBe('water');
    expect(s.gear!.placed).toEqual({});
  });

  it('refuses a tool it does not carry or a tile that does not fit', () => {
    const s = holding('bridge');
    const ev = play(s, { a: { type: 'use', tool: 'bridge', dir: 'E' } });
    expect(ev).toContainEqual({ kind: 'refused', agent: 'a', reason: 'a bridge goes on a water tile' });
    const ev2 = play(s, { a: { type: 'use', tool: 'pump', dir: 'E' } });
    expect(ev2.find((e) => e.kind === 'refused')).toBeTruthy();
    expect(s.agents[0]!.tool).toBe('bridge');
  });

  it('plays the same with tools: a cloned match steps identically', () => {
    const rows = ['###########', '#.........#', '#.~~......#', '#.~~......#', '#.........#', '#....E....#', '###########'];
    const def = testMap(rows, { hazards: [{ kind: 'water', every: 2, cap: 4 }], drops: [{ at: [1, 1], tick: 1, tool: 'pump' }] });
    const s = createMatch(def, crews);
    play(s, {});
    const t = cloneMatch(s);
    const script: Action[] = [{ type: 'wait' }, { type: 'use', tool: 'pump', dir: 'S' }, { type: 'wait' }, { type: 'move', dir: 'S' }];
    for (const a of script) expect(play(t, { a })).toEqual(play(s, { a }));
    expect(t.grid).toEqual(s.grid);
    expect(t.gear).toEqual(s.gear);
  });

  it('the drop table only gives tools on water maps, one per drop at most', () => {
    for (const m of MAPS_V2) {
      const tools = SUPPLY_TOOLS[m.id];
      if (!tools) continue;
      expect(m.hazards.some((h) => h.kind === 'water'), m.id).toBe(true);
      expect(tools.length).toBeLessThanOrEqual(m.drops.length);
      m.drops.forEach((_, k) => expect(dropTool(m, k)).toBe(tools[k] ?? null));
    }
  });
});
