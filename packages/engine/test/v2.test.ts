import { describe, expect, it } from 'vitest';
import {
  CALLOUTS,
  DOWN_TICKS,
  MAPS_V2,
  MATCH_TICKS,
  appendTick,
  createMatch,
  frameFor,
  holdFor,
  legalActions,
  logHash,
  observe,
  parseMapV2,
  startLog,
  stepMatch,
  tickCostPer100,
  verifyLog,
  type Action,
  type AgentSpec,
  type MapDefV2,
  type MatchState,
  type Role,
  type SayInput,
} from '../src/v2';

const agent = (id: string, role: Role = 'Runner', o: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard', ...o });

/** A small mirrored test map (11 wide). Rows are edited per test. */
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
    verbs: [
      { id: 'sandbag', name: 'Sandbag', effect: 'add_solid' },
      { id: 'dig', name: 'Dig', effect: 'remove_solid' },
      { id: 'push', name: 'Push', effect: 'push' },
      { id: 'douse', name: 'Douse', effect: 'extinguish' },
      { id: 'bell', name: 'Ring the bell', effect: 'area_repel' },
    ],
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

const OPEN = ['###########', '#.........#', '#.........#', '#....E....#', '#.........#', '#.........#', '###########'];
const wait: Action = { type: 'wait' };
const mv = (dir: 'N' | 'E' | 'S' | 'W'): Action => ({ type: 'move', dir });
const play = (s: MatchState, actions: Record<string, Action>, says?: SayInput[]) => stepMatch(s, { actions, ...(says ? { says } : {}) });
const pos = (s: MatchState, id: string) => {
  const a = s.agents.find((x) => x.id === id)!;
  return [a.x, a.y];
};
const setTile = (s: MatchState, x: number, y: number, t: MatchState['grid'][number]) => (s.grid[y * s.map.w + x] = t);

describe('v2 maps', () => {
  it('ships the ten maps, mirrored, with goals scaling 2 to 6 by difficulty', () => {
    expect(MAPS_V2.map((m) => m.code)).toEqual(['SW-01', 'AO-02', 'FD-03', 'GR-04', 'CH-05', 'DB-06', 'MT-07', 'SM-08', 'BS-09', 'BH-10']);
    expect(MAPS_V2.map((m) => m.goal)).toEqual([2, 3, 3, 4, 4, 4, 5, 5, 6, 6]);
    for (const m of MAPS_V2) {
      const p = parseMapV2(m);
      expect(p.grid).toHaveLength(p.w * p.h);
      for (const v of m.verbs) expect(v.effect).toMatch(/^[a-z_]+$/);
    }
    expect(MAPS_V2.find((m) => m.id === 'basalt-stair')!.night).toBe(true);
  });

  it('refuses a map whose starts are not mirrored or whose exit is off centre', () => {
    expect(() => parseMapV2({ ...testMap(OPEN), starts: { A: [[1, 1]], B: [[8, 1]] } })).toThrow(/mirrored/);
    expect(() => parseMapV2({ ...testMap(OPEN), exit: [4, 3] })).toThrow(/centre column/);
  });
});

describe('v2 match: moving, digging, carrying', () => {
  it('two agents stepping onto one tile both stay put', () => {
    const s = createMatch(testMap(['###########', '#.........#', '#....E....#', '#.........#', '#.........#', '#.........#', '###########'], { exit: [5, 2], starts: { A: [[4, 1]], B: [[6, 1]] } }), { A: [agent('a')], B: [agent('b')] });
    const ev = play(s, { a: mv('E'), b: mv('W') });
    expect(pos(s, 'a')).toEqual([4, 1]);
    expect(pos(s, 'b')).toEqual([6, 1]);
    expect(ev.filter((e) => e.kind === 'blocked')).toHaveLength(2);
  });

  it('dirt takes three hits by hand and one for a Digger', () => {
    const s = createMatch(testMap(OPEN), { A: [agent('a'), agent('d', 'Digger')], B: [agent('b'), agent('b2')] });
    setTile(s, 2, 1, 'dirt');
    setTile(s, 2, 2, 'dirt');
    play(s, { a: mv('E'), d: mv('E') });
    expect(s.grid[1 * 11 + 2]).toBe('dirt');
    expect(s.grid[2 * 11 + 2]).toBeNull();
    play(s, { a: mv('E') });
    play(s, { a: mv('E') });
    expect(s.grid[1 * 11 + 2]).toBeNull();
  });

  it('picks up items up to capacity and scores them at the delivery point; first to the goal wins', () => {
    const s = createMatch(testMap(OPEN, { starts: { A: [[3, 3]], B: [[7, 3]] } }), { A: [agent('a')], B: [agent('b')] });
    setTile(s, 4, 3, 'item');
    setTile(s, 4, 2, 'item');
    play(s, { a: mv('E') });
    expect(s.agents[0]!.carrying).toHaveLength(1);
    play(s, { a: mv('N') });
    play(s, { a: mv('E') });
    play(s, { a: mv('S') });
    expect(s.score.A).toBe(2);
    expect(s.result).toMatchObject({ winner: 'A', reason: 'goal' });
  });

  it('gives the smaller crew a 10 s head start per agent of difference', () => {
    const s = createMatch(testMap(OPEN), { A: [agent('a1'), agent('a2')], B: [agent('b')] });
    expect(s.holdTicks).toEqual({ A: 5, B: 0 }); // the larger crew waits: B gets the head start
    for (let i = 0; i < 5; i++) play(s, { a1: mv('E'), b: mv('S') });
    expect(pos(s, 'b')).toEqual([9, 5]);
    expect(pos(s, 'a1')).toEqual([1, 1]);
    play(s, { a1: mv('E') });
    expect(pos(s, 'a1')).toEqual([2, 1]);
  });
});

describe('v2 match: verbs by effect class', () => {
  it('lets only the matching role use gated verbs, and spends block supply', () => {
    const s = createMatch(testMap(OPEN), { A: [agent('r'), agent('bld', 'Builder')], B: [agent('b'), agent('b2')] });
    expect(legalActions(s, 'r').some((a) => a.type === 'verb' && a.verb === 'sandbag')).toBe(false);
    const ev = play(s, { r: { type: 'verb', verb: 'sandbag', dir: 'E' }, bld: { type: 'verb', verb: 'sandbag', dir: 'E' } });
    expect(ev).toContainEqual({ kind: 'refused', agent: 'r', reason: 'Sandbag needs a Builder' });
    expect(s.grid[2 * 11 + 2]).toBe('block');
    expect(s.blocks.A).toBe(1);
  });

  it('pushes a crate one tile and douses fire', () => {
    const s = createMatch(testMap(OPEN), { A: [agent('a'), agent('f', 'Firefighter')], B: [agent('b'), agent('b2')] });
    setTile(s, 2, 1, 'crate');
    setTile(s, 2, 2, 'fire');
    play(s, { a: { type: 'verb', verb: 'push', dir: 'E' }, f: { type: 'verb', verb: 'douse', dir: 'E' } });
    expect(s.grid[1 * 11 + 2]).toBeNull();
    expect(s.grid[1 * 11 + 3]).toBe('crate');
    expect(s.grid[2 * 11 + 2]).toBeNull();
  });

  it('area_repel stuns rivals within 2 tiles for 3 ticks, then cools down', () => {
    const s = createMatch(testMap(OPEN, { starts: { A: [[4, 1]], B: [[6, 1]] } }), { A: [agent('sc', 'Scout')], B: [agent('b')] });
    const ev = play(s, { sc: { type: 'verb', verb: 'bell' } });
    expect(ev).toContainEqual({ kind: 'stunned', agent: 'b', by: 'sc' });
    for (let i = 0; i < 3; i++) play(s, { b: mv('S') });
    expect(pos(s, 'b')).toEqual([6, 1]);
    play(s, { b: mv('S') });
    expect(pos(s, 'b')).toEqual([6, 2]);
    expect(play(s, { sc: { type: 'verb', verb: 'bell' } })).toContainEqual({ kind: 'refused', agent: 'sc', reason: 'Ring the bell is cooling down' });
  });
});

describe('v2 match: hazards, knock-downs, switches, drops', () => {
  it('spreads for cap waves, then recedes and restores the tiles', () => {
    const s = createMatch(testMap(OPEN, { hazards: [{ kind: 'water', every: 1, cap: 2 }] }), { A: [agent('a')], B: [agent('b')] });
    setTile(s, 5, 5, 'water');
    play(s, {});
    play(s, {});
    const wet = s.grid.filter((t) => t === 'water').length;
    expect(wet).toBeGreaterThan(5);
    play(s, {});
    play(s, {});
    expect(s.grid.filter((t) => t === 'water').length).toBe(1);
  });

  it('knocks an agent down for 4 ticks, drops its items for anyone to steal, and respawns it at its start', () => {
    const s = createMatch(testMap(OPEN, { steal: true, hazards: [{ kind: 'water', every: 1, cap: 9 }], starts: { A: [[1, 1]], B: [[9, 1]] } }), { A: [agent('a')], B: [agent('b')] });
    const a = s.agents[0]!;
    a.x = 3;
    a.y = 5;
    a.carrying = [0];
    setTile(s, 2, 5, 'water');
    const ev = play(s, {});
    expect(ev).toContainEqual({ kind: 'knocked_down', agent: 'a', by: 'water', dropped: 1 });
    expect(s.dropped[5 * 11 + 3] ?? Object.values(s.dropped)[0]).toBe('A');
    for (let i = 0; i < DOWN_TICKS; i++) play(s, {});
    expect(pos(s, 'a')).toEqual([1, 1]);
  });

  it('lava removes an agent for the match, and a crew with no one left loses', () => {
    const s = createMatch(testMap(OPEN, { hazards: [{ kind: 'lava', every: 1, cap: 9 }] }), { A: [agent('a')], B: [agent('b')] });
    const a = s.agents[0]!;
    a.x = 3;
    a.y = 5;
    setTile(s, 2, 5, 'lava');
    expect(play(s, {})).toContainEqual({ kind: 'eliminated', agent: 'a', by: 'lava' });
    expect(s.result).toMatchObject({ winner: 'B', reason: 'eliminated' });
  });

  it('a shared switch floods the rival lane for 8 ticks, knocks down whoever stands in it, then resets', () => {
    const rows = ['###########', '#.........#', '#...V.....#', '#....E....#', '#.........#', '#.........#', '###########'];
    const lanes = { A: [5 * 11 + 1, 5 * 11 + 2], B: [5 * 11 + 8, 5 * 11 + 9] };
    const s = createMatch(testMap(rows, { switches: [{ at: [4, 2], name: 'Start the pump', kind: 'water', lanes }] }), { A: [agent('a')], B: [agent('b')] });
    const [a, b] = s.agents;
    a!.x = 3;
    a!.y = 2;
    b!.x = 8;
    b!.y = 5;
    const ev = play(s, { a: { type: 'switch' } });
    expect(ev).toContainEqual({ kind: 'switch', agent: 'a', name: 'Start the pump', floods: 'B', until: 9 });
    expect(ev.some((e) => e.kind === 'knocked_down' && e.agent === 'b')).toBe(true);
    expect(s.grid[5 * 11 + 9]).toBe('water');
    for (let i = 0; i < 8; i++) play(s, {});
    expect(s.grid[5 * 11 + 9]).toBeNull();
    expect(legalActions(s, 'a').some((x) => x.type === 'switch')).toBe(false);
  });

  it('lands a supply drop on its tick', () => {
    const s = createMatch(testMap(OPEN, { drops: [{ at: [5, 1], tick: 2 }] }), { A: [agent('a')], B: [agent('b')] });
    play(s, {});
    expect(play(s, {})).toContainEqual({ kind: 'supply_drop', at: [5, 1] });
    expect(s.grid[1 * 11 + 5]).toBe('item');
  });
});

describe('v2 match: talk', () => {
  const crews = () => ({ A: [agent('a', 'Runner', { comms: 1 }), agent('a2', 'Runner', { comms: 1 })], B: [agent('b', 'Runner', { comms: 1 })] });

  it('say reaches agents in range; team reaches teammates anywhere and rivals near the speaker overhear', () => {
    const s = createMatch(testMap(OPEN, { starts: { A: [[4, 1], [1, 5]], B: [[6, 1], [9, 5]] } }), crews());
    const ev = play(s, {}, [{ agent: 'a', channel: 'team', text: 'Middle is ours.' }]);
    expect(ev).toContainEqual({ kind: 'said', agent: 'a', channel: 'team', text: 'Middle is ours.', heardBy: ['a2'], overheardBy: ['b'] });
    expect(s.agents.find((x) => x.id === 'b')!.inbox[0]).toMatchObject({ overheard: true, fromName: 'a' });
    const ev2 = play(s, {}, [{ agent: 'a2', channel: 'say', text: 'Anyone here?' }]);
    expect(ev2).toContainEqual({ kind: 'said', agent: 'a2', channel: 'say', text: 'Anyone here?', heardBy: [], overheardBy: [] });
  });

  it('holds Standard to one message every 5 ticks, Quiet to callouts, and every message to 120 characters', () => {
    const s = createMatch(testMap(OPEN), { A: [agent('a'), agent('q', 'Runner', { tier: 'quiet' })], B: [agent('b')] });
    play(s, {}, [{ agent: 'a', channel: 'team', text: 'x'.repeat(200) }]);
    expect(s.agents.find((x) => x.id === 'q')!.inbox[0]!.text).toHaveLength(120);
    expect(play(s, {}, [{ agent: 'a', channel: 'team', text: 'again' }])[0]).toMatchObject({ kind: 'refused' });
    expect(play(s, {}, [{ agent: 'q', channel: 'team', text: 'I have a plan' }])[0]).toMatchObject({ kind: 'refused', reason: 'Quiet agents speak in callouts only' });
    expect(play(s, {}, [{ agent: 'q', channel: 'team', text: CALLOUTS[0]! }])[0]).toMatchObject({ kind: 'said' });
  });

  it('ranked fixes every tier at Standard; credits follow the tiers', () => {
    const crew = [agent('a', 'Runner', { tier: 'open' }), agent('a2', 'Runner', { tier: 'quiet' })];
    // Open 40 + Quiet 20 credits per 100 agent-ticks over 150 ticks; ranked is 2 x Standard 20.
    expect(MATCH_TICKS).toBe(150);
    expect(holdFor(crew, false)).toBe(90);
    expect(holdFor(crew, true)).toBe(60);
    const s = createMatch(testMap(OPEN), { A: crew, B: [agent('b')] }, { ranked: true });
    expect(s.agents.map((a) => a.tier)).toEqual(['standard', 'standard', 'standard']);
    expect(tickCostPer100(s, 'A')).toBe(40);
    expect(tickCostPer100(s, 'B')).toBe(20);
    s.agents.find((a) => a.id === 'a2')!.out = true;
    expect(tickCostPer100(s, 'A')).toBe(20);
  });

  it('holds whole credits, rounded up once for the whole clock', () => {
    const quiet = [agent('q', 'Runner', { tier: 'quiet' })];
    expect(holdFor(quiet, false)).toBe(30);
    expect(holdFor(quiet, false, 135)).toBe(27);
    expect(holdFor(quiet, false, 1)).toBe(1);
    expect(holdFor([agent('a'), agent('b'), agent('c')], true)).toBe(90);
    expect(holdFor([agent('a', 'Runner', { tier: 'open' }), agent('b', 'Runner', { tier: 'open' })], false)).toBe(120);
    expect(holdFor([agent('a', 'Runner', { tier: 'open' }), agent('q', 'Runner', { tier: 'quiet' })], false, 135)).toBe(81);
  });
});

describe('v2 match: fog and results', () => {
  it('shows a crew only what its agents have seen, and hides rivals out of sight', () => {
    const s = createMatch(testMap(OPEN, { fog: true }), { A: [agent('a', 'Runner', { vision: 1 })], B: [agent('b', 'Runner', { vision: 1 })] });
    const o = observe(s, 'a');
    expect(o.rows[5]).toBe('???????????');
    expect(o.rows[1]!.slice(0, 4)).toBe('#...');
    expect(o.rivals).toEqual([]);
  });

  it('frames a crew through its fog: its agents, rivals in sight, and only the talk it heard', () => {
    const s = createMatch(testMap(OPEN, { fog: true }), { A: [agent('a', 'Runner', { vision: 1, comms: 1 })], B: [agent('b', 'Runner', { vision: 1, comms: 1 })] });
    const ev = play(s, {}, [{ agent: 'b', channel: 'team', text: 'Left lane is clear.' }, { agent: 'a', channel: 'say', text: 'Holding.' }]);
    const fa = frameFor(s, 'A', ev);
    expect(fa.agents.map((x) => x.id)).toEqual(['a']);
    expect(fa.rows[5]).toBe('???????????');
    expect(fa.comms.map((m) => m.text)).toEqual(['Holding.']);
    const fw = frameFor(s, 'watch', ev);
    expect(fw.agents.map((x) => x.id)).toEqual(['a', 'b']);
    expect(fw.comms).toHaveLength(2);
    expect(fw.rows[5]).not.toContain('?');
  });

  it('at time-out the crew with more delivered wins, then the crew with fewer agents', () => {
    const s = createMatch(testMap(OPEN), { A: [agent('a')], B: [agent('b'), agent('b2')] }, { ticks: 3 });
    for (let i = 0; i < 3; i++) play(s, {});
    expect(s.result).toMatchObject({ winner: 'A', reason: 'time', decidedBy: 'fewer_agents' });
  });
});

/** A greedy bot: walk toward the nearest known item, or the exit when carrying (first legal move that gets closer). */
function greedy(s: MatchState, id: string): Action {
  const o = observe(s, id);
  const legal = o.legal.filter((l) => l.type === 'move') as { type: 'move'; dir: 'N' | 'E' | 'S' | 'W' }[];
  let target: [number, number] = o.map.exit;
  if (o.me.carrying === 0) {
    let best = Infinity;
    // Items in sight only: this walker has no pathfinding, and a known item across walls would stall it.
    const inSight = (x: number, y: number) => s.visible[o.me.team][y * o.map.w + x];
    o.rows.forEach((r, y) => [...r].forEach((c, x) => {
      const d = Math.abs(x - o.me.x) + Math.abs(y - o.me.y);
      if (c === '*' && d < best && inSight(x, y)) {
        best = d;
        target = [x, y];
      }
    }));
  }
  const step: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const dist = (dir: string) => Math.abs(o.me.x + step[dir]![0] - target[0]) + Math.abs(o.me.y + step[dir]![1] - target[1]);
  const ranked = [...legal].sort((p, q) => dist(p.dir) - dist(q.dir));
  return ranked[0] ?? { type: 'wait' };
}

describe('v2 match: a full match on Copper Hollow', () => {
  const run = () => {
    const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
    const crews = { A: [agent('wick', 'Builder'), agent('moss', 'Digger')], B: [agent('wren', 'Digger'), agent('kes', 'Runner')] };
    const s = createMatch(map, crews, { ranked: true });
    const log = startLog({ schema: 'skirm.match/v2', map: map.id, crews: { A: crews.A, B: crews.B }, ranked: true, models: { planner: 'test', actor: 'greedy', speech: 'test' } });
    while (!s.result) {
      const actions = Object.fromEntries(s.agents.map((a) => [a.id, greedy(s, a.id)]));
      const says = s.tick % 10 === 0 ? [{ agent: 'wick', channel: 'team' as const, text: `Tick ${s.tick}.` }] : [];
      stepMatch(s, { actions, says });
      appendTick(log, { tick: s.tick, actions, says });
    }
    log.result = s.result;
    return { s, log };
  };

  it('plays to a result within 150 ticks and is the same every time', () => {
    const one = run();
    const two = run();
    expect(one.s.result!.ticks).toBeLessThanOrEqual(MATCH_TICKS);
    expect(one.s.score.A + one.s.score.B).toBeGreaterThan(0);
    expect(logHash(one.log)).toBe(logHash(two.log));
    expect(verifyLog(one.log)).toBeNull();
    one.log.ticks[3]!.actions.wick = { type: 'wait' };
    expect(verifyLog(one.log)).toBe(4);
  });
});
