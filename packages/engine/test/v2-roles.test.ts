// The four new roles (roles.ts): Medic, Engineer, Saboteur, Courier.
import { rankedRoleAllowed, rankedRoleRefusal } from '@skirm/shared';
import { describe, expect, it } from 'vitest';
import {
  BLUFF_REACH,
  CLASSIC_ROLES,
  ENGINEER_BRIDGES,
  MAPS_V2,
  MEDIC_COOLDOWN,
  NEW_ROLES,
  ROLES,
  SABOTEUR_DECOYS,
  appendTick,
  carryOf,
  createMatch,
  frameFor,
  legalActions,
  logAgent,
  logHash,
  observe,
  parseAction,
  actionText,
  planBluffs,
  startLog,
  stepMatch,
  type Action,
  type AgentSpec,
  type MapDefV2,
  type MatchState,
  type Role,
} from '../src/v2';

const agent = (id: string, role: Role = 'Runner', o: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard', ...o });

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
    goal: 3,
    rows,
    starts: { A: [[1, 1], [1, 2]], B: [[w - 2, 1], [w - 2, 2]] },
    exit: [(w - 1) / 2, 3],
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

const OPEN = ['###########', '#.........#', '#.........#', '#....E....#', '#.........#', '#.........#', '###########'];
const W = 11;
const play = (s: MatchState, actions: Record<string, Action>) => stepMatch(s, { actions });
const ag = (s: MatchState, id: string) => s.agents.find((a) => a.id === id)!;
const place = (s: MatchState, id: string, x: number, y: number) => Object.assign(ag(s, id), { x, y });
const pos = (s: MatchState, id: string) => [ag(s, id).x, ag(s, id).y];
const mv = (dir: 'N' | 'E' | 'S' | 'W'): Action => ({ type: 'move', dir });
/** A match with no head start (the tests field crews of different sizes). */
const mk = (...args: Parameters<typeof createMatch>) => Object.assign(createMatch(...args), { holdTicks: { A: 0, B: 0 } });

describe('roles: the list and ranked', () => {
  it('keeps the original six first, in their old order, and adds four', () => {
    expect(ROLES.slice(0, 6)).toEqual(CLASSIC_ROLES);
    expect(ROLES.slice(6)).toEqual(NEW_ROLES);
    expect(NEW_ROLES).toEqual(['Medic', 'Engineer', 'Saboteur', 'Courier']);
    expect(ROLES.map(carryOf)).toEqual([2, 2, 2, 2, 2, 3, 2, 2, 2, 1]);
  });

  it('ranked refuses the new roles while DEFAULTS.roles.rankedNewRoles is off; casual takes them', () => {
    const def = MAPS_V2[0]!;
    for (const role of NEW_ROLES) {
      expect(() => createMatch(def, { A: [agent('a', role)], B: [agent('b')] }, { ranked: true })).toThrow(`${role} is not in ranked yet`);
      expect(() => createMatch(def, { A: [agent('a', role)], B: [agent('b')] })).not.toThrow();
    }
    for (const role of CLASSIC_ROLES) expect(() => createMatch(def, { A: [agent('a', role)], B: [agent('b', role)] }, { ranked: true })).not.toThrow();
    expect(rankedRoleAllowed('Medic')).toBe(false);
    expect(rankedRoleAllowed('Medic', true)).toBe(true);
    expect(rankedRoleRefusal(['Runner', 'Hauler'])).toBeNull();
    expect(rankedRoleRefusal(['Runner', 'Courier'])).toMatch(/Courier is not in ranked yet/);
  });

  it('gives only an Engineer and a Saboteur a kit, so the original roles keep their state shape', () => {
    const s = mk(testMap(OPEN), { A: [agent('e', 'Engineer'), agent('s', 'Saboteur')], B: [agent('m', 'Medic'), agent('c', 'Courier')] });
    expect(ag(s, 'e').kit).toBe(ENGINEER_BRIDGES);
    expect(ag(s, 's').kit).toBe(SABOTEUR_DECOYS);
    expect('kit' in ag(s, 'm')).toBe(false);
    const old = mk(testMap(OPEN), { A: [agent('a', 'Hauler')], B: [agent('b', 'Scout')] });
    expect(Object.keys(old.agents[0]!)).not.toContain('kit');
    expect('decoys' in old).toBe(false);
  });
});

describe('Medic', () => {
  const setup = () => {
    const s = mk(testMap(OPEN), { A: [agent('m', 'Medic'), agent('r')], B: [agent('b')] });
    place(s, 'm', 3, 4);
    place(s, 'r', 4, 4);
    return s;
  };

  it('cuts a knock-down by 2 ticks: the crewmate is back at its start 2 ticks sooner', () => {
    const s = setup();
    const plain = setup();
    for (const x of [s, plain]) ag(x, 'r').down = 4;
    expect(legalActions(s, 'm')).toContainEqual({ type: 'tend', agent: 'r' });
    const ev = play(s, { m: { type: 'tend', agent: 'r' } });
    expect(ev).toContainEqual({ kind: 'tended', agent: 'm', target: 'r', was: 'down' });
    expect(ag(s, 'r').down).toBe(1);
    const back = (x: MatchState) => {
      let n = 0;
      while (ag(x, 'r').down) play(x, {}), n++;
      return n;
    };
    play(plain, {});
    expect(back(s) + 2).toBe(back(plain));
    expect(pos(s, 'r')).toEqual([1, 2]);
  });

  it('clears a stun so the crewmate acts next tick', () => {
    const s = setup();
    ag(s, 'r').stun = 3;
    play(s, { m: { type: 'tend', agent: 'r' } });
    expect(ag(s, 'r').stun).toBe(0);
    play(s, { r: mv('S') });
    expect(pos(s, 'r')).toEqual([4, 5]);
  });

  it('only next to a crewmate that needs it, and once every 5 ticks', () => {
    const s = setup();
    ag(s, 'r').down = 2; // 1 left at action time: gets up anyway
    expect(legalActions(s, 'm').some((a) => a.type === 'tend')).toBe(false);
    expect(play(s, { m: { type: 'tend', agent: 'r' } })).toContainEqual({ kind: 'refused', agent: 'm', reason: 'r needs no tending' });

    const t = setup();
    ag(t, 'b').stun = 3;
    place(t, 'b', 3, 5);
    expect(play(t, { m: { type: 'tend', agent: 'b' } })).toContainEqual({ kind: 'refused', agent: 'm', reason: 'no crewmate to tend' });
    place(t, 'r', 6, 4);
    ag(t, 'r').stun = 3;
    expect(play(t, { m: { type: 'tend', agent: 'r' } })).toContainEqual({ kind: 'refused', agent: 'm', reason: 'r is not next to you' });

    const u = setup();
    ag(u, 'r').stun = 3;
    play(u, { m: { type: 'tend', agent: 'r' } });
    ag(u, 'r').stun = 3;
    expect(legalActions(u, 'm').some((a) => a.type === 'tend')).toBe(false);
    expect(play(u, { m: { type: 'tend', agent: 'r' } }).some((e) => e.kind === 'refused')).toBe(true);
    for (let i = 0; i < MEDIC_COOLDOWN; i++) play(u, {});
    ag(u, 'r').stun = 3;
    expect(legalActions(u, 'm')).toContainEqual({ type: 'tend', agent: 'r' });
  });

  it('is not something any other role can do', () => {
    const s = mk(testMap(OPEN), { A: [agent('h', 'Hauler'), agent('r')], B: [agent('b')] });
    place(s, 'h', 3, 4);
    place(s, 'r', 4, 4);
    ag(s, 'r').down = 4;
    expect(legalActions(s, 'h').some((a) => a.type === 'tend')).toBe(false);
    expect(play(s, { h: { type: 'tend', agent: 'r' } })).toContainEqual({ kind: 'refused', agent: 'h', reason: 'only a Medic can tend' });
  });

  it('round-trips its action as text', () => {
    const s = setup();
    ag(s, 'r').stun = 3;
    const legal = legalActions(s, 'm');
    expect(parseAction(actionText({ type: 'tend', agent: 'r' }), legal)).toEqual({ type: 'tend', agent: 'r' });
  });
});

describe('Engineer', () => {
  const VALVE = ['###########', '#.........#', '#...V.....#', '#....E....#', '#.........#', '#.........#', '###########'];
  const lanes = { A: [5 * W + 1], B: [5 * W + 9] };
  const valveMap = testMap(VALVE, { switches: [{ at: [4, 2], name: 'Sluice', kind: 'water', lanes }] });

  it('pulls a valve from 2 tiles away; everyone else needs to stand next to it', () => {
    const s = mk(valveMap, { A: [agent('e', 'Engineer'), agent('r')], B: [agent('b')] });
    place(s, 'e', 2, 2);
    place(s, 'r', 4, 4);
    expect(legalActions(s, 'e')).toContainEqual({ type: 'switch' });
    expect(legalActions(s, 'r')).not.toContainEqual({ type: 'switch' });
    expect(play(s, { r: { type: 'switch' } })).toContainEqual({ kind: 'refused', agent: 'r', reason: 'no switch next to the agent' });
    const ev = play(s, { e: { type: 'switch' } });
    expect(ev).toContainEqual(expect.objectContaining({ kind: 'switch', agent: 'e', floods: 'B' }));
    place(s, 'e', 1, 4);
    expect(legalActions(s, 'e')).not.toContainEqual({ type: 'switch' });
  });

  const WET = ['###########', '#.........#', '#..~~~....#', '#....E....#', '#.........#', '#.........#', '###########'];

  it('lays its own 2 bridges on adjacent water without a tool, then none', () => {
    const s = mk(testMap(WET), { A: [agent('e', 'Engineer')], B: [agent('b')] });
    place(s, 'e', 3, 1);
    expect(legalActions(s, 'e')).toContainEqual({ type: 'use', tool: 'bridge', dir: 'S' });
    expect(play(s, { e: { type: 'use', tool: 'bridge', dir: 'S' } })).toContainEqual({ kind: 'tool_used', agent: 'e', tool: 'bridge', at: [3, 2] });
    expect(s.gear!.placed[2 * W + 3]).toEqual({ kind: 'bridge', team: 'A' });
    expect(ag(s, 'e').kit).toBe(1);
    expect(ag(s, 'e').tool).toBeUndefined();
    play(s, { e: mv('S') });
    expect(pos(s, 'e')).toEqual([3, 2]);
    play(s, { e: { type: 'use', tool: 'bridge', dir: 'E' } });
    expect(ag(s, 'e').kit).toBe(0);
    place(s, 'e', 5, 1);
    expect(legalActions(s, 'e').some((a) => a.type === 'use')).toBe(false);
    expect(observe(s, 'e').me.kit).toBe(0);
  });

  it('lays a bridge it carries from a drop before its own', () => {
    const s = mk(testMap(WET), { A: [agent('e', 'Engineer')], B: [agent('b')] });
    place(s, 'e', 3, 1);
    ag(s, 'e').tool = 'bridge';
    expect(legalActions(s, 'e').filter((a) => a.type === 'use')).toHaveLength(1);
    play(s, { e: { type: 'use', tool: 'bridge', dir: 'S' } });
    expect(ag(s, 'e').tool).toBeUndefined();
    expect(ag(s, 'e').kit).toBe(ENGINEER_BRIDGES);
  });

  it('keeps a held sandbag while it lays its own bridge', () => {
    const s = mk(testMap(WET), { A: [agent('e', 'Engineer')], B: [agent('b')] });
    place(s, 'e', 3, 1);
    ag(s, 'e').tool = 'sandbag';
    const uses = legalActions(s, 'e').filter((a) => a.type === 'use');
    expect(uses).toContainEqual({ type: 'use', tool: 'bridge', dir: 'S' });
    expect(uses).toContainEqual({ type: 'use', tool: 'sandbag', dir: 'E' });
    play(s, { e: { type: 'use', tool: 'bridge', dir: 'S' } });
    expect(ag(s, 'e').tool).toBe('sandbag');
  });

  it('gives a Runner no bridge of its own', () => {
    const s = mk(testMap(WET), { A: [agent('r')], B: [agent('b')] });
    place(s, 'r', 3, 1);
    expect(play(s, { r: { type: 'use', tool: 'bridge', dir: 'S' } })).toContainEqual({ kind: 'refused', agent: 'r', reason: 'you carry no tool' });
  });
});

describe('Saboteur', () => {
  const setup = (o: Partial<MapDefV2> = {}, B: AgentSpec[] = [agent('b')]) => {
    const s = mk(testMap(OPEN, o), { A: [agent('s', 'Saboteur'), agent('a2')], B });
    place(s, 's', 3, 4);
    return s;
  };
  const decoy = 4 * W + 4;

  it('plants a decoy only the rival takes for an item; its own crew sees floor', () => {
    const s = setup();
    expect(legalActions(s, 's')).toContainEqual({ type: 'plant', dir: 'E' });
    const ev = play(s, { s: { type: 'plant', dir: 'E' } });
    expect(ev).toContainEqual({ kind: 'planted', agent: 's', at: [4, 4] });
    expect(s.grid[decoy]).toBeNull();
    expect(s.decoys).toEqual({ [decoy]: 'A' });
    expect(s.seen.B[decoy]).toBe('item');
    expect(s.seen.A[decoy]).toBeNull();
    expect(observe(s, 'b').rows[4]![4]).toBe('*');
    expect(observe(s, 's').rows[4]![4]).toBe('.');
    expect(observe(s, 's').decoys).toEqual([[4, 4]]);
    expect(observe(s, 'b').decoys).toBeUndefined();
    expect(observe(s, 's').me.kit).toBe(SABOTEUR_DECOYS - 1);
    // Frames: the rival never learns it was planted, the crew and watchers do.
    expect(frameFor(s, 'B', ev).events.some((e) => e.kind === 'planted')).toBe(false);
    expect(frameFor(s, 'B', ev).decoys).toBeUndefined();
    expect(frameFor(s, 'B', ev).rows[4]![4]).toBe('*');
    expect(frameFor(s, 'A', ev).decoys).toEqual([{ at: [4, 4], team: 'A' }]);
    expect(frameFor(s, 'watch', ev).decoys).toEqual([{ at: [4, 4], team: 'A' }]);
    expect(s.tally.A.decoys).toBe(1);
  });

  it('springs on a rival reaching for it: nothing picked up, its next action lost, the decoy gone', () => {
    const s = setup();
    play(s, { s: { type: 'plant', dir: 'E' } });
    place(s, 'b', 5, 4);
    const ev = play(s, { b: mv('W') });
    expect(ev).toContainEqual({ kind: 'decoy_sprung', agent: 'b', team: 'A', at: [4, 4] });
    expect(ev.some((e) => e.kind === 'picked')).toBe(false);
    expect(ag(s, 'b').carrying).toEqual([]);
    expect(s.decoys).toEqual({});
    expect(s.seen.B[decoy]).toBeNull();
    expect(frameFor(s, 'A', ev).events).toContainEqual({ kind: 'decoy_sprung', agent: 'b', team: 'A', at: [4, 4] });
    play(s, { b: mv('S') });
    expect(pos(s, 'b')).toEqual([4, 4]);
    play(s, { b: mv('S') });
    expect(pos(s, 'b')).toEqual([4, 5]);
  });

  it('is walked over by its own crew and by a rival with full hands', () => {
    const s = setup({}, [agent('b', 'Courier')]);
    play(s, { s: { type: 'plant', dir: 'E' } });
    place(s, 'a2', 4, 5);
    play(s, { a2: mv('N') });
    expect(pos(s, 'a2')).toEqual([4, 4]);
    expect(s.decoys![decoy]).toBe('A');
    place(s, 'a2', 7, 5);
    ag(s, 'b').carrying = [1];
    ag(s, 'b').tags = [{ origin: 'own', tick: 0 }];
    place(s, 'b', 4, 5);
    expect(play(s, { b: mv('N') }).some((e) => e.kind === 'decoy_sprung')).toBe(false);
    expect(s.decoys![decoy]).toBe('A');
  });

  it('uses the crew bluff budget and its own 2 decoys', () => {
    const s = setup({}, [agent('b')]);
    s.lieCap.A = 1;
    play(s, { s: { type: 'plant', dir: 'E' } });
    expect(legalActions(s, 's').some((a) => a.type === 'plant')).toBe(false);
    expect(play(s, { s: { type: 'plant', dir: 'W' } })).toContainEqual({ kind: 'refused', agent: 's', reason: 'your crew has used all its bluffs' });
    // ...and the crew tells no more bluffs either: a rival closing on a middle item hears none.
    s.tally.A.decoys = 1;
    s.middle = [3 * W + 3];
    s.grid[3 * W + 3] = 'item';
    place(s, 'b', 3, 5);
    ag(s, 's').tier = 'open';
    expect(BLUFF_REACH).toBeGreaterThan(2);
    const byA = () => planBluffs(s, []).filter((b) => b.liar.team === 'A');
    expect(byA()).toEqual([]);
    s.lieCap.A = 3;
    expect(byA()).toHaveLength(1);

    const t = setup();
    play(t, { s: { type: 'plant', dir: 'E' } });
    play(t, { s: { type: 'plant', dir: 'W' } });
    expect(ag(t, 's').kit).toBe(0);
    expect(play(t, { s: { type: 'plant', dir: 'S' } })).toContainEqual({ kind: 'refused', agent: 's', reason: 'no decoys left' });
  });

  it('goes only on open floor, off the starts, with nobody on it', () => {
    const s = setup();
    s.grid[4 * W + 4] = 'grass';
    expect(play(s, { s: { type: 'plant', dir: 'E' } })).toContainEqual({ kind: 'refused', agent: 's', reason: 'a decoy goes on open floor' });
    place(s, 'a2', 3, 5);
    expect(play(s, { s: { type: 'plant', dir: 'S' } })).toContainEqual({ kind: 'refused', agent: 's', reason: 'someone stands there' });
    place(s, 's', 2, 1);
    expect(play(s, { s: { type: 'plant', dir: 'W' } })).toContainEqual({ kind: 'refused', agent: 's', reason: 'not on a start tile' });
  });

  it('respects fog: the rival sees it only when its tile comes into sight', () => {
    const s = setup({ fog: true }, [agent('b', 'Runner', { vision: 1 })]);
    place(s, 'b', 9, 1);
    play(s, { s: { type: 'plant', dir: 'E' } });
    expect(s.visible.B[decoy]).toBe(false);
    expect(s.seen.B[decoy]).not.toBe('item');
    place(s, 'b', 6, 4);
    play(s, {});
    expect(s.seen.B[decoy]).toBe('item');
    // Out of sight again, the crew remembers an item there, as it would a real one.
    place(s, 'b', 9, 1);
    play(s, {});
    expect(s.seen.B[decoy]).toBe('item');
  });

  it('is gone when its tile stops being open floor', () => {
    const s = setup();
    play(s, { s: { type: 'plant', dir: 'E' } });
    s.grid[decoy] = 'water';
    play(s, {});
    expect(s.decoys).toEqual({});
    expect(s.seen.B[decoy]).toBe('water');
  });
});

describe('Courier', () => {
  const setup = () => {
    const s = mk(testMap(OPEN), { A: [agent('c', 'Courier')], B: [agent('b')] });
    place(s, 'c', 1, 4);
    return s;
  };

  it('moves 2 tiles on open ground and carries 1', () => {
    const s = setup();
    const ev = play(s, { c: mv('E') });
    expect(pos(s, 'c')).toEqual([3, 4]);
    expect(ev).toContainEqual({ kind: 'strode', agent: 'c', from: [2, 4], to: [3, 4] });
    expect(observe(s, 'c').me.capacity).toBe(1);
    s.grid[4 * W + 5] = 'item';
    s.grid[4 * W + 6] = 'item';
    play(s, { c: mv('E') });
    expect(pos(s, 'c')).toEqual([5, 4]);
    expect(ag(s, 'c').carrying).toHaveLength(1);
    play(s, { c: mv('E') });
    expect(pos(s, 'c')).toEqual([6, 4]);
    expect(ag(s, 'c').carrying).toHaveLength(1);
    expect(s.grid[4 * W + 6]).toBe('item');
  });

  it('stops on an item, the exit, a wall or another agent', () => {
    const s = setup();
    s.grid[4 * W + 2] = 'item';
    play(s, { c: mv('E') });
    expect(pos(s, 'c')).toEqual([2, 4]);
    const t = setup();
    place(t, 'c', 9, 4);
    play(t, { c: mv('E') });
    expect(pos(t, 'c')).toEqual([9, 4]);
    place(t, 'c', 8, 4);
    play(t, { c: mv('E') });
    expect(pos(t, 'c')).toEqual([9, 4]);
    place(t, 'c', 5, 1);
    play(t, { c: mv('S') });
    expect(pos(t, 'c')).toEqual([5, 3]);
    const u = setup();
    place(u, 'b', 3, 4);
    play(u, { c: mv('E') });
    expect(pos(u, 'c')).toEqual([2, 4]);
  });

  it('does not stride past a rival decoy it takes for an item', () => {
    const s = mk(testMap(OPEN), { A: [agent('s', 'Saboteur')], B: [agent('c', 'Courier')] });
    place(s, 's', 3, 5);
    play(s, { s: { type: 'plant', dir: 'N' } });
    place(s, 'c', 2, 4);
    const ev = play(s, { c: mv('E') });
    expect(pos(s, 'c')).toEqual([3, 4]);
    expect(ev).toContainEqual({ kind: 'decoy_sprung', agent: 'c', team: 'A', at: [3, 4] });
  });

  it('an ordinary Runner still moves 1 tile', () => {
    const s = mk(testMap(OPEN), { A: [agent('r')], B: [agent('b')] });
    place(s, 'r', 1, 4);
    play(s, { r: mv('E') });
    expect(pos(s, 'r')).toEqual([2, 4]);
  });
});

describe('a match with the new roles replays to the same hash', () => {
  it.each(MAPS_V2.map((m) => [m.id] as const))('%s', (id) => {
    const def = MAPS_V2.find((m) => m.id === id)!;
    const run = () => {
      const crews = { A: [agent('a1', 'Medic'), agent('a2', 'Saboteur')], B: [agent('b1', 'Engineer'), agent('b2', 'Courier')] };
      const s = createMatch(def, crews);
      const log = startLog({ schema: 'skirm.match/v2', map: id, crews: { A: crews.A.map((c) => logAgent({ ...c, traits: c.traits ? [...c.traits] : undefined })), B: crews.B.map((c) => logAgent({ ...c, traits: c.traits ? [...c.traits] : undefined })) }, ranked: false, models: { planner: 'p', actor: 'a', speech: 's' } });
      while (!s.result) {
        const actions: Record<string, Action> = {};
        for (const a of s.agents) {
          const legal = legalActions(s, a.id);
          const own = legal.filter((x) => x.type === 'tend' || x.type === 'plant' || x.type === 'use' || x.type === 'switch');
          const moves = legal.filter((x) => x.type === 'move');
          const pool = own.length && s.tick % 3 === 0 ? own : moves.length ? moves : legal;
          actions[a.id] = pool[(s.tick * 7 + a.slot * 3) % pool.length]!;
        }
        stepMatch(s, { actions });
        appendTick(log, { tick: s.tick, actions, says: [] });
      }
      return { hash: logHash(log), result: s.result, tally: s.tally };
    };
    const one = run();
    expect(run()).toEqual(one);
  });
});
