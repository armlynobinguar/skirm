import { describe, expect, it } from 'vitest';
import {
  DOWN_TICKS,
  MAPS_V2,
  STUN_TICKS,
  TRAIT_STAT_MAX,
  appendTick,
  commsOf,
  createMatch,
  logAgent,
  logHash,
  observe,
  specsFromHeader,
  startLog,
  stepMatch,
  traitMods,
  visionOf,
  type Action,
  type AgentSpec,
  type MapDefV2,
  type MatchState,
  type Role,
} from '../src/v2';

const agent = (id: string, role: Role = 'Runner', o: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard', ...o });

const OPEN = ['###########', '#.........#', '#.........#', '#....E....#', '#.........#', '#.........#', '###########'];
function testMap(o: Partial<MapDefV2> = {}): MapDefV2 {
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
    rows: OPEN,
    starts: { A: [[1, 1], [1, 2]], B: [[9, 1], [9, 2]] },
    exit: [5, 3],
    verbs: [{ id: 'bell', name: 'Ring the bell', effect: 'area_repel' }],
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
const get = (s: MatchState, id: string) => s.agents.find((a) => a.id === id)!;

describe('trait effects', () => {
  it('adds one step per trait and caps the total at maxTraits distinct traits', () => {
    expect(traitMods(undefined)).toEqual({ vision: 0, comms: 0, down: 0, stun: 0, cooldown: 0, dig: 0 });
    expect(traitMods(['keen', 'keen'])).toMatchObject({ vision: 1 });
    // Four listed, only two count (catalogue order: keen, clear).
    const m = traitMods(['strong', 'quick', 'clear', 'keen']);
    expect(m).toEqual({ vision: 1, comms: 1, down: 0, stun: 0, cooldown: 0, dig: 0 });
  });

  it('never takes a stat past TRAIT_STAT_MAX', () => {
    expect(visionOf({ vision: 5, comms: 3, traits: ['keen'] })).toBe(TRAIT_STAT_MAX);
    expect(commsOf({ vision: 3, comms: 5, traits: ['clear'] })).toBe(TRAIT_STAT_MAX);
    expect(visionOf({ vision: 3, comms: 3 })).toBe(3);
  });

  it('Keen sees one tile further in fog, and the agent keeps its base stat', () => {
    const s = createMatch(testMap({ fog: true }), { A: [agent('a', 'Runner', { vision: 1, traits: ['keen'] })], B: [agent('b', 'Runner', { vision: 1 })] });
    const a = get(s, 'a');
    expect(a.vision).toBe(1);
    expect(a.traits).toEqual(['keen']);
    // Radius 1 + vision 2 = 3 tiles to the east of (1,1).
    expect(s.visible.A[1 * 11 + 4]).toBe(true);
    expect(s.visible.B[1 * 11 + 6]).toBe(false);
    expect(s.visible.B[1 * 11 + 7]).toBe(true);
  });

  it('Steady gets up a tick sooner, Calm shakes off a stun a tick sooner', () => {
    const s = createMatch(testMap({ hazards: [{ kind: 'water', every: 1, cap: 9 }], starts: { A: [[1, 1]], B: [[9, 1]] } }), {
      A: [agent('a', 'Runner', { traits: ['steady'] })],
      B: [agent('b')],
    });
    const a = get(s, 'a');
    a.x = 3;
    a.y = 5;
    s.grid[5 * 11 + 2] = 'water';
    stepMatch(s, { actions: {} });
    expect(a.down).toBe(DOWN_TICKS - 1);

    const r = createMatch(testMap({ starts: { A: [[4, 1]], B: [[6, 1]] } }), { A: [agent('sc', 'Scout')], B: [agent('b', 'Runner', { traits: ['calm'] })] });
    stepMatch(r, { actions: { sc: { type: 'verb', verb: 'bell' } } });
    expect(get(r, 'b').stun).toBe(STUN_TICKS - 1);
  });

  it('Quick hands shortens the repel cooldown; Strong arm digs by hand in two hits', () => {
    const s = createMatch(testMap({ starts: { A: [[4, 1]], B: [[6, 1]] } }), { A: [agent('sc', 'Scout', { traits: ['quick'] })], B: [agent('b')] });
    stepMatch(s, { actions: { sc: { type: 'verb', verb: 'bell' } } });
    expect(get(s, 'sc').cooldown.bell).toBe(1 + 15 - 2);

    const d = createMatch(testMap({ starts: { A: [[1, 1]], B: [[9, 1]] } }), { A: [agent('a', 'Runner', { traits: ['strong'] })], B: [agent('b')] });
    d.grid[1 * 11 + 2] = 'dirt';
    stepMatch(d, { actions: { a: mv('E') } });
    expect(d.grid[1 * 11 + 2]).toBe('dirt');
    stepMatch(d, { actions: { a: mv('E') } });
    expect(d.grid[1 * 11 + 2]).toBeNull();
  });

  it('ranked plays every agent on base stats (no traits in play or in the log)', () => {
    const s = createMatch(testMap(), { A: [agent('a', 'Runner', { traits: ['keen', 'steady'] })], B: [agent('b')] }, { ranked: true });
    expect(get(s, 'a').traits).toBeUndefined();
    expect(logAgent(get(s, 'a'))).not.toHaveProperty('traits');
  });

  it('tells a model brain its traits', () => {
    const s = createMatch(testMap(), { A: [agent('a', 'Runner', { traits: ['calm'] })], B: [agent('b')] });
    expect(observe(s, 'a').me.traits).toEqual([expect.stringMatching(/^Calm \(/)]);
    expect(observe(s, 'b').me).not.toHaveProperty('traits');
  });
});

describe('trait determinism', () => {
  /** A walker: first legal move toward the nearest item, or the exit when carrying. */
  const walk = (s: MatchState, id: string): Action => {
    const o = observe(s, id);
    const moves = o.legal.filter((l) => l.type === 'move') as { type: 'move'; dir: 'N' | 'E' | 'S' | 'W' }[];
    let target = o.map.exit;
    if (!o.me.carrying) {
      let best = Infinity;
      o.rows.forEach((r, y) =>
        [...r].forEach((c, x) => {
          const dd = Math.abs(x - o.me.x) + Math.abs(y - o.me.y);
          if (c === '*' && dd < best) (best = dd), (target = [x, y]);
        }),
      );
    }
    const step = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;
    const dist = (d: keyof typeof step) => Math.abs(o.me.x + step[d][0] - target[0]) + Math.abs(o.me.y + step[d][1] - target[1]);
    return [...moves].sort((p, q) => dist(p.dir) - dist(q.dir))[0] ?? { type: 'wait' };
  };

  const play = (crews: Record<'A' | 'B', AgentSpec[]>) => {
    const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
    const s = createMatch(map, crews, { difficulty: 'normal' });
    const log = startLog({
      schema: 'skirm.match/v2',
      map: map.id,
      crews: { A: s.agents.filter((a) => a.team === 'A').map(logAgent), B: s.agents.filter((a) => a.team === 'B').map(logAgent) },
      ranked: false,
      models: { planner: 'test', actor: 'walk', speech: 'test' },
    });
    while (!s.result) {
      const actions = Object.fromEntries(s.agents.map((a) => [a.id, walk(s, a.id)]));
      stepMatch(s, { actions });
      appendTick(log, { tick: s.tick, actions, says: [] });
    }
    log.result = s.result;
    return { s, log };
  };

  const crews = {
    A: [agent('wick', 'Builder', { traits: ['steady', 'keen'] }), agent('moss', 'Digger', { traits: ['strong'] })],
    B: [agent('wren', 'Digger', { traits: ['calm'] }), agent('kes', 'Runner')],
  };

  it('records the traits in the log header in one canonical order', () => {
    const { log } = play(crews);
    expect(log.header.crews.A[0]).toMatchObject({ vision: 3, traits: ['keen', 'steady'] });
    expect(log.header.crews.B[1]).not.toHaveProperty('traits');
  });

  it('replaying the logged ticks on the header crews reproduces the match, whatever order the traits were picked in', () => {
    const one = play(crews);
    const two = play({ ...crews, A: [agent('wick', 'Builder', { traits: ['keen', 'steady'] }), crews.A[1]!] });
    expect(logHash(one.log)).toBe(logHash(two.log));

    const re = createMatch(MAPS_V2.find((m) => m.id === 'copper-hollow')!, specsFromHeader(one.log.header), { difficulty: 'normal' });
    for (const t of one.log.ticks) stepMatch(re, { actions: t.actions, says: t.says });
    expect(re.result).toEqual(one.s.result);
    expect(re.agents.map((a) => [a.id, a.x, a.y, a.delivered])).toEqual(one.s.agents.map((a) => [a.id, a.x, a.y, a.delivered]));
  });
});
