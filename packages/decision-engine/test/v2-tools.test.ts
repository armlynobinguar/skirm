import { createMatch, observe, stepMatch, type AgentSpec, type MapDefV2, type ToolKind } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { createGreedyBrain, greedyAct, greedyThought, observedSummary, playHeadless, turnPrompt } from '../src/v2';

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

/** Agent a holding `tool` at (x, y) on these rows. */
function holding(rows: string[], tool: ToolKind, x = 1, y = 1) {
  const s = createMatch(testMap(rows), { A: [spec('a')], B: [spec('b')] });
  const a = s.agents[0]!;
  a.tool = tool;
  a.x = x;
  a.y = y;
  return s;
}

describe('greedy with supply tools', () => {
  it('lays a bridge across the water between it and the only item', () => {
    const rows = ['###########', '#.~*......#', '#.~.......#', '#.~.......#', '#.~.......#', '#.~..E....#', '###########'];
    const s = holding(rows, 'bridge');
    const o = observe(s, 'a');
    const act = greedyAct(o);
    expect(act).toEqual({ type: 'use', tool: 'bridge', dir: 'E' });
    expect(greedyThought(o, act)).toMatch(/bridge/);
    stepMatch(s, { actions: { a: act } });
    // Then it walks across the bridge to the item.
    expect(greedyAct(observe(s, 'a'))).toEqual({ type: 'move', dir: 'E' });
  });

  it('pumps a pool that blocks the short way, and keeps the pump when the way is open', () => {
    const rows = ['###########', '#..~~*....#', '#..~~.....#', '#..~~.....#', '#.........#', '#....E....#', '###########'];
    const s = holding(rows, 'pump', 2, 1);
    expect(greedyAct(observe(s, 'a'))).toEqual({ type: 'use', tool: 'pump', dir: 'E' });
    const open = holding(['###########', '#....*....#', '#.........#', '#.........#', '#.........#', '#....E....#', '###########'], 'pump');
    expect(greedyAct(observe(open, 'a'))).toEqual({ type: 'move', dir: 'E' });
  });

  it('sandbags the tile water would cross toward the delivery point', () => {
    const rows = ['###########', '#.........#', '#.........#', '#...~.....#', '#...~.....#', '#....E....#', '###########'];
    const s = holding(rows, 'sandbag', 6, 4);
    expect(greedyAct(observe(s, 'a'))).toEqual({ type: 'use', tool: 'sandbag', dir: 'W' });
    // Far from the delivery point it keeps its sandbags.
    const wide = ['#####################', '#...................#', '#...................#', '#~..................#', '#...................#', '#.........E.........#', '#####################'];
    const far = holding(wide, 'sandbag', 2, 2);
    expect(greedyAct(observe(far, 'a')).type).not.toBe('use');
  });

  it('tells a model about the tool in hand and the gear on the map', () => {
    const rows = ['###########', '#.~*......#', '#.~.......#', '#.~.......#', '#.~.......#', '#.~..E....#', '###########'];
    const s = holding(rows, 'bridge');
    s.gear!.ground[2 * s.map.w + 4] = 'pump';
    const o = observe(s, 'a');
    const p = turnPrompt(o, null, false);
    expect(p).toContain('Your tool: Bridge');
    expect(p).toContain('pump at 4,2');
    expect(p).toMatch(/\d+\. use bridge E/);
    expect(observedSummary(o)).toContain('holding a bridge');
  });

  it('plays a tool map the same twice', async () => {
    const rows = ['###########', '#.........#', '#..~......#', '#.........#', '#.........#', '#....E....#', '###########'];
    const def = testMap(rows, { hazards: [{ kind: 'water', every: 4, cap: 4 }], drops: [{ at: [5, 2], tick: 3, tool: 'sandbag' }] });
    const run = () => playHeadless({ def, difficulty: 'normal', crews: { A: [spec('a')], B: [spec('b')] }, brains: { A: createGreedyBrain(), B: createGreedyBrain() } });
    const [x, y] = [await run(), await run()];
    expect(x.log.hashes.at(-1)).toBe(y.log.hashes.at(-1));
    expect(x.result).toEqual(y.result);
  });
});
