// The greedy brain and the prompts with the new roles (engine roles.ts).
import { MAPS_V2, NEW_ROLES, PRACTICE_MAPS, createMatch, mapV2, observe, stepMatch, verifyLog, type AgentSpec, type MapDefV2, type MatchEvent, type Role } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { createGreedyBrain, greedyAct, greedyRoleAct, playHeadless, RULES, roleLines, turnPrompt, parseReply, GREEDY_PLANT_AFTER } from '../src/v2';

const agent = (id: string, role: Role = 'Runner'): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard' });

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
const OPEN = ['###########', '#.........#', '#.........#', '#....E....#', '#.........#', '#.........#', '###########'];
const fresh = (def: MapDefV2, A: AgentSpec[], B: AgentSpec[]) => Object.assign(createMatch(def, { A, B }), { holdTicks: { A: 0, B: 0 } });
const place = (s: ReturnType<typeof createMatch>, id: string, x: number, y: number) => Object.assign(s.agents.find((a) => a.id === id)!, { x, y });

describe('greedy with the new roles', () => {
  it('a Medic tends a knocked-down crewmate next to it at once', () => {
    const s = fresh(testMap(OPEN), [agent('m', 'Medic'), agent('r')], [agent('b')]);
    place(s, 'm', 3, 4);
    place(s, 'r', 4, 4);
    s.agents.find((a) => a.id === 'r')!.down = 4;
    expect(greedyAct(observe(s, 'm'))).toEqual({ type: 'tend', agent: 'r' });
    expect(greedyAct(observe(s, 'r'))).toEqual({ type: 'wait' });
  });

  it('a Saboteur plants in the middle band once the match is under way, with empty hands', () => {
    const s = fresh(testMap(OPEN), [agent('s', 'Saboteur'), agent('r')], [agent('b')]);
    place(s, 's', 4, 5);
    expect(greedyRoleAct(observe(s, 's'))).toBeNull(); // too early
    for (let i = 0; i < GREEDY_PLANT_AFTER; i++) stepMatch(s, { actions: {} });
    expect(greedyRoleAct(observe(s, 's'))).toMatchObject({ type: 'plant' });
    place(s, 's', 1, 5);
    expect(greedyRoleAct(observe(s, 's'))).toBeNull(); // far from the middle
    place(s, 's', 4, 5);
    s.agents.find((a) => a.id === 's')!.carrying = [0];
    expect(greedyRoleAct(observe(s, 's'))).toBeNull(); // racing an item home
  });

  it('an Engineer bridges water in its way with its own bridge', () => {
    const rows = ['###########', '#...~.....#', '#...~.....#', '#...~E....#', '#...~.....#', '#...~.....#', '###########'];
    const s = fresh(testMap(rows, { exit: [5, 3] }), [agent('e', 'Engineer')], [agent('b')]);
    place(s, 'e', 3, 3);
    s.grid[3 * 11 + 7] = s.seen.A[3 * 11 + 7] = 'item';
    expect(greedyAct(observe(s, 'e'))).toEqual({ type: 'use', tool: 'bridge', dir: 'E' });
  });

  it('original roles never get a role move', () => {
    const s = fresh(testMap(OPEN), [agent('h', 'Hauler'), agent('r')], [agent('b')]);
    expect(greedyRoleAct(observe(s, 'h'))).toBeNull();
    expect(roleLines(observe(s, 'h'))).toEqual([]);
  });
});

describe('headless greedy with the new roles on every practice map', () => {
  it.each(PRACTICE_MAPS.map((id) => [id] as const))('%s plays to a result with a valid log, the same twice', async (id) => {
    const def = mapV2(id)!;
    const n = Math.min(3, def.starts.A.length);
    const crew = (p: string, roles: Role[]) => roles.slice(0, n).map((r, i) => agent(`${p}${i}`, r));
    const run = async () => {
      const events: MatchEvent[] = [];
      const r = await playHeadless({
        def,
        difficulty: 'normal',
        crews: { A: crew('a', ['Medic', 'Saboteur', 'Courier']), B: crew('b', ['Engineer', 'Courier', 'Medic']) },
        brains: { A: createGreedyBrain(), B: createGreedyBrain() },
        onTick: (ev) => void events.push(...ev),
      });
      return { r, events };
    };
    const one = await run();
    const two = await run();
    expect(one.r.result).not.toBeNull();
    expect(verifyLog(one.r.log)).toBeNull();
    expect(two.r.logHash).toBe(one.r.logHash);
    // Replaying the log on a fresh match reproduces it.
    const s = createMatch(def, { A: crew('a', ['Medic', 'Saboteur', 'Courier']), B: crew('b', ['Engineer', 'Courier', 'Medic']) }, { difficulty: 'normal' });
    for (const t of one.r.log.ticks) stepMatch(s, { actions: t.actions, says: t.says });
    expect(s.result).toEqual(one.r.result);
    // Couriers stride on every map (open ground everywhere).
    expect(one.events.some((e) => e.kind === 'strode')).toBe(true);
  });

  it('the new roles do their thing across the atlas', async () => {
    const seen = new Set<string>();
    for (const def of MAPS_V2) {
      const n = Math.min(3, def.starts.A.length);
      const crew = (p: string, roles: Role[]) => roles.slice(0, n).map((r, i) => agent(`${p}${i}`, r));
      await playHeadless({
        def,
        difficulty: 'normal',
        crews: { A: crew('a', ['Saboteur', 'Medic', 'Courier']), B: crew('b', ['Courier', 'Engineer', 'Runner']) },
        brains: { A: createGreedyBrain(), B: createGreedyBrain() },
        onTick: (ev) => ev.forEach((e) => seen.add(e.kind)),
      });
    }
    expect(seen).toContain('planted');
    expect(seen).toContain('strode');
  }, 120000);
});

describe('prompts know the new roles', () => {
  it('the rules explain each one', () => {
    for (const r of NEW_ROLES) expect(RULES).toContain(`${r}:`);
    expect(RULES).toContain('tend <agent id>');
    expect(RULES).toContain('plant <dir>');
    expect(RULES).toContain('use bridge <dir>');
  });

  it('a Saboteur sees its decoys and stock, and can name its plant as an action', () => {
    const s = fresh(testMap(OPEN), [agent('s', 'Saboteur'), agent('r')], [agent('b')]);
    place(s, 's', 4, 5);
    stepMatch(s, { actions: { s: { type: 'plant', dir: 'E' } } });
    const o = observe(s, 's');
    expect(roleLines(o)).toEqual(['You have 1 decoy left to plant.', "Your crew's decoys (floor to you, items to rivals): 5,5."]);
    const text = turnPrompt(o, null, false);
    const n = o.legal.findIndex((a) => a.type === 'plant') + 1;
    expect(text).toContain(`${n}. plant `);
    expect(parseReply(`ACTION: ${n}`, o.legal, false).action).toMatchObject({ type: 'plant' });
    // The rival's prompt shows an item there and nothing else.
    const rival = observe(s, 'b');
    expect(rival.rows[5]![5]).toBe('*');
    expect(turnPrompt(rival, null, false)).not.toContain('decoy left');
  });

  it('a Medic lists who it can tend and an Engineer its bridges', () => {
    const s = fresh(testMap(OPEN), [agent('m', 'Medic'), agent('r')], [agent('e', 'Engineer')]);
    place(s, 'm', 3, 4);
    place(s, 'r', 4, 4);
    s.agents.find((a) => a.id === 'r')!.down = 4;
    const o = observe(s, 'm');
    expect(roleLines(o)[0]).toContain('r (r) at 4,4');
    expect(turnPrompt(o, null, false)).toMatch(/\d+\. tend r/);
    expect(roleLines(observe(s, 'e'))).toEqual(['You have 2 bridges of your own left; you reach switches from 2 tiles away.']);
  });
});
