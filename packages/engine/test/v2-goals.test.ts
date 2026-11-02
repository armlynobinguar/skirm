import { describe, expect, it } from 'vitest';
import {
  MAPS_V2,
  appendTick,
  checkGoal,
  createMatch,
  crewReport,
  evaluateGoals,
  frameFor,
  goalFor,
  logHash,
  middleTiles,
  mvpOf,
  observe,
  parseMapV2,
  startLog,
  stepMatch,
  withDifficulty,
  type Action,
  type AgentSpec,
  type Difficulty,
  type MapDefV2,
  type MatchResult,
  type MatchState,
  type Role,
  type SayInput,
} from '../src/v2';

const agent = (id: string, role: Role = 'Runner', o: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard', ...o });

/** 11 wide, difficulty 1: the middle band is columns 4 to 6. */
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
    verbs: [
      { id: 'sandbag', name: 'Sandbag', effect: 'add_solid' },
      { id: 'dig', name: 'Dig', effect: 'remove_solid' },
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
const ITEMS = ['###########', '#.*..*....#', '#.........#', '#....E....#', '#.........#', '#.........#', '###########'];
const play = (s: MatchState, actions: Record<string, Action>, says?: SayInput[]) => stepMatch(s, { actions, ...(says ? { says } : {}) });
const at = (s: MatchState, id: string, x: number, y: number) => {
  const a = s.agents.find((o) => o.id === id)!;
  a.x = x;
  a.y = y;
  return a;
};
const map = (id: string) => MAPS_V2.find((m) => m.id === id)!;
const end = (s: MatchState, winner: MatchResult['winner'], ticks = s.tick) => {
  s.tick = ticks;
  s.result = { winner, reason: 'goal', decidedBy: 'goal', score: { ...s.score }, ticks };
};

describe('v2 difficulty rules', () => {
  it('plays Normal as the map is designed', () => {
    const ch = map('copper-hollow');
    expect(withDifficulty(ch, 'normal')).toBe(ch);
    const s = createMatch(ch, { A: [agent('a')], B: [agent('b')] });
    expect(s.difficulty).toBe('normal');
    expect(s.limit).toBe(150);
    expect(s.map.def.goal).toBe(4);
  });

  it('scales hazards, wave caps, the goal, fog and night by level', () => {
    const ch = map('copper-hollow');
    expect(withDifficulty(ch, 'easy')).toMatchObject({ goal: 3, hazards: [{ kind: 'water', every: 6, cap: 5 }], fog: true, night: false });
    expect(withDifficulty(ch, 'hard')).toMatchObject({ goal: 4, hazards: [{ kind: 'water', every: 3, cap: 8 }] });
    expect(withDifficulty(ch, 'mega')).toMatchObject({ goal: 5, hazards: [{ kind: 'water', every: 2, cap: 10 }], fog: true, night: true });
    // The goal never drops below 2, the cap below 3 or the interval below 1.
    expect(withDifficulty(map('saltmarsh-weir'), 'easy').goal).toBe(2);
    const tiny = testMap(OPEN, { hazards: [{ kind: 'fire', every: 1, cap: 2 }] });
    expect(withDifficulty(tiny, 'easy').hazards[0]).toEqual({ kind: 'fire', every: 2, cap: 3 });
    expect(withDifficulty(tiny, 'mega').hazards[0]).toEqual({ kind: 'fire', every: 1, cap: 5 });
    // Agentic fogs a map without fog of its own.
    const s = createMatch(testMap(OPEN), { A: [agent('a', 'Runner', { vision: 1 })], B: [agent('b', 'Runner', { vision: 1 })] }, { difficulty: 'agentic' });
    expect(observe(s, 'a').rows[5]).toBe('???????????');
  });

  it('sets the clock by level, lets an explicit length win, and keeps ranked on Normal', () => {
    const crews = () => ({ A: [agent('a')], B: [agent('b')] });
    const ch = map('copper-hollow');
    expect(createMatch(ch, crews(), { difficulty: 'hard' }).limit).toBe(135);
    expect(createMatch(ch, crews(), { difficulty: 'mega' }).limit).toBe(120);
    expect(createMatch(ch, crews(), { difficulty: 'mega', ticks: 10 }).limit).toBe(10);
    const ranked = createMatch(ch, crews(), { ranked: true, difficulty: 'mega' });
    expect(ranked).toMatchObject({ difficulty: 'normal', limit: 150 });
    expect(ranked.map.def.goal).toBe(4);
    expect(frameFor(createMatch(ch, crews(), { difficulty: 'agentic' }), 'A', []).goal).toBe(5);
  });
});

describe('v2 middle items and item origins', () => {
  it('finds each official map’s contested items in the middle band', () => {
    expect(MAPS_V2.map((m) => middleTiles(parseMapV2(m)).length)).toEqual([1, 1, 1, 3, 3, 3, 3, 3, 5, 5]);
    expect(middleTiles(parseMapV2(map('copper-hollow')))).toEqual([2 * 41 + 20, 6 * 41 + 20, 16 * 41 + 20]);
  });

  it('tags pickups own, middle and drop, and frames carry them', () => {
    const s = createMatch(testMap(ITEMS, { drops: [{ at: [5, 4], tick: 1 }] }), { A: [agent('a'), agent('a2')], B: [agent('b'), agent('b2')] });
    at(s, 'a', 1, 1);
    at(s, 'a2', 5, 5);
    const ev = play(s, { a: { type: 'move', dir: 'E' }, a2: { type: 'move', dir: 'N' } });
    expect(ev).toContainEqual({ kind: 'picked', agent: 'a', at: [2, 1], stolen: false, origin: 'own' });
    expect(ev).toContainEqual({ kind: 'picked', agent: 'a2', at: [5, 4], stolen: false, origin: 'drop' });
    at(s, 'a', 4, 1);
    play(s, { a: { type: 'move', dir: 'E' } });
    const me = frameFor(s, 'A', []).agents.find((x) => x.id === 'a')!;
    expect(me.items).toEqual([
      { kind: 'item', origin: 'own', tick: 1 },
      { kind: 'item', origin: 'middle', tick: 2 },
    ]);
    expect(s.tally.A.middle).toEqual([1 * 11 + 5]);
    expect(s.agents.find((x) => x.id === 'a')!.picks).toBe(2);
    // Delivering empties the hands and the tags.
    at(s, 'a', 5, 2);
    play(s, { a: { type: 'move', dir: 'S' } });
    expect(s.agents.find((x) => x.id === 'a')!).toMatchObject({ carrying: [], tags: [], delivered: 2 });
  });

  it('a dropped item is stolen by the rival or recovered by its own crew', () => {
    const def = testMap(OPEN, { steal: true, hazards: [{ kind: 'water', every: 1, cap: 9 }], starts: { A: [[1, 1], [1, 2]], B: [[9, 1], [9, 2]] } });
    const s = createMatch(def, { A: [agent('a'), agent('a2')], B: [agent('b'), agent('b2')] });
    const a = at(s, 'a', 3, 5);
    a.carrying = [0, 0];
    a.tags = [{ origin: 'own', tick: 0 }, { origin: 'own', tick: 0 }];
    s.grid[5 * 11 + 2] = 'water';
    play(s, {});
    expect(s.tally.A.swept).toBe(1);
    const drops = Object.keys(s.dropped).map(Number).sort((p, q) => p - q);
    expect(drops).toHaveLength(2);
    s.hazards = {};
    s.map.def.hazards = [];
    const [d1, d2] = drops as [number, number];
    at(s, 'a2', d1 % 11, (d1 / 11) | 0);
    at(s, 'b', d2 % 11, (d2 / 11) | 0);
    const ev = play(s, {});
    expect(ev.filter((e) => e.kind === 'picked').map((e) => (e.kind === 'picked' ? [e.agent, e.origin, e.stolen] : null))).toEqual([
      ['a2', 'recovered', false],
      ['b', 'stolen', true],
    ]);
    expect(s.tally.B.steals).toBe(1);
    expect(s.tally.A.steals).toBe(0);
  });
});

describe('v2 tallies', () => {
  it('counts verbs, switches, a Digger’s finished digs and knock-downs', () => {
    const rows = ['###########', '#..d......#', '#...V.....#', '#....E....#', '#.........#', '#.........#', '###########'];
    const lanes = { A: [5 * 11 + 1, 5 * 11 + 2], B: [5 * 11 + 8, 5 * 11 + 9] };
    const s = createMatch(testMap(rows, { switches: [{ at: [4, 2], name: 'Start the pump', kind: 'water', lanes }] }), { A: [agent('a', 'Builder'), agent('d', 'Digger')], B: [agent('b'), agent('b2')] });
    at(s, 'a', 3, 2);
    at(s, 'd', 2, 1);
    at(s, 'b', 8, 5);
    play(s, { a: { type: 'switch' }, d: { type: 'move', dir: 'E' } });
    play(s, { a: { type: 'verb', verb: 'sandbag', dir: 'S' } });
    play(s, { a: { type: 'verb', verb: 'dig', dir: 'N' } }); // refused: Builders cannot dig
    expect(s.tally.A).toMatchObject({ verbs: 3, switches: 1 });
    expect(s.tally.B.swept).toBe(1);
    expect(s.agents.map((x) => [x.id, x.used])).toEqual([['a', 2], ['d', 1], ['b', 0], ['b2', 0]]);
  });

  it('counts messages sent and rival team talk overheard, and frames who overheard yours', () => {
    const s = createMatch(testMap(OPEN, { starts: { A: [[4, 1], [1, 5]], B: [[6, 1], [9, 5]] } }), {
      A: [agent('a', 'Runner', { comms: 1 }), agent('a2', 'Runner', { comms: 1 })],
      B: [agent('b', 'Runner', { comms: 1, name: 'Wren' })],
    });
    const ev = play(s, {}, [{ agent: 'a', channel: 'team', text: 'Middle is ours.' }, { agent: 'b', channel: 'team', text: 'Going left.' }]);
    expect(s.tally.A).toMatchObject({ sent: 1, overheard: 1 });
    expect(s.tally.B).toMatchObject({ sent: 1, overheard: 1 });
    const fa = frameFor(s, 'A', ev);
    expect(fa.comms.find((m) => m.from === 'a')).toMatchObject({ overheardBy: ['Wren'], overheard: false });
    expect(fa.comms.find((m) => m.from === 'b')).toMatchObject({ overheard: true });
    expect(fa.comms.find((m) => m.from === 'b')!.overheardBy).toBeUndefined();
  });
});

describe('v2 goals', () => {
  const crews = () => ({ A: [agent('a'), agent('a2')], B: [agent('b')] });

  it('judges each check, and the difficulty goal needs the win', () => {
    const s = createMatch(map('copper-hollow'), crews());
    const verb = goalFor('copper-hollow', 'normal');
    s.tally.A.verbs = 2;
    expect(checkGoal(s, 'A', verb)).toEqual({ met: false, available: true, progress: '2/3 verbs' });
    s.tally.A.verbs = 5;
    end(s, 'B');
    expect(checkGoal(s, 'A', verb)).toEqual({ met: false, available: true, progress: '3/3 verbs' });
    end(s, 'A');
    expect(checkGoal(s, 'A', verb).met).toBe(true);
    expect(checkGoal(s, 'A', goalFor('copper-hollow', 'agentic'))).toEqual({ met: false, available: true, progress: '0/1 switches' });
    // Bluff goals read the engine's own bluff tallies (bluff.ts).
    const landed = goalFor('copper-hollow', 'hard');
    expect(landed.check).toBe('bluff');
    expect(checkGoal(s, 'A', landed)).toEqual({ met: false, available: true, progress: '0/1 bluffs landed' });
    s.tally.A.lies = 2;
    s.tally.A.believed = 1;
    expect(checkGoal(s, 'A', landed)).toEqual({ met: true, available: true, progress: '1/1 bluffs landed' });
    const seen = goalFor('copper-hollow', 'mega');
    expect(seen.check).toBe('see');
    s.tally.B.lies = 3;
    s.tally.B.believed = 1;
    expect(checkGoal(s, 'A', seen)).toEqual({ met: true, available: true, progress: '2/2 seen through' });
    expect(checkGoal(s, 'A', { title: 'Steal', text: '', check: 'steal', n: 1 }).progress).toBe('0/1 stolen');
  });

  it('fast, hold, quiet and clean', () => {
    // Basalt Stair on Mega: win with 0:45 left on a 120-tick clock, so by tick 97.
    const s = createMatch(map('basalt-stair'), crews(), { difficulty: 'mega' });
    const fast = goalFor('basalt-stair', 'mega');
    end(s, 'A', 97);
    expect(checkGoal(s, 'A', fast)).toEqual({ met: true, available: true, progress: '0:45+ left' });
    end(s, 'A', 98);
    expect(checkGoal(s, 'A', fast).met).toBe(false);
    const clean = goalFor('basalt-stair', 'hard');
    expect(checkGoal(s, 'A', clean)).toMatchObject({ met: true, progress: 'nobody swept' });
    s.tally.A.swept = 2;
    expect(checkGoal(s, 'A', clean)).toMatchObject({ met: false, progress: '2 swept' });

    const w = createMatch(map('saltmarsh-weir'), crews());
    w.score.B = 1;
    end(w, 'A');
    expect(checkGoal(w, 'A', goalFor('saltmarsh-weir', 'agentic'))).toEqual({ met: true, available: true, progress: 'rival 1/1 max' });
    w.score.B = 2;
    expect(checkGoal(w, 'A', goalFor('saltmarsh-weir', 'agentic')).met).toBe(false);

    const f = createMatch(map('frostline-depot'), crews());
    f.tally.A.sent = 15;
    end(f, 'A');
    expect(checkGoal(f, 'A', goalFor('frostline-depot', 'hard'))).toEqual({ met: false, available: true, progress: '15/14 messages' });
  });

  it('reports the difficulty goal first, then the stars, bluffs included', () => {
    const s = createMatch(map('copper-hollow'), crews(), { difficulty: 'easy' });
    s.score.A = 3;
    s.tally.A.middle = [82];
    end(s, 'A');
    expect(evaluateGoals(s, 'A', 'easy')).toEqual([
      { title: 'Light the way', check: 'win', met: true, available: true, progress: '3/3 delivered' },
      { title: 'Won the match', check: 'win', met: true, available: true, progress: '3/3 delivered' },
      { title: 'Took a middle lamp oil', check: 'mid', met: true, available: true, progress: '1 middle' },
      { title: 'Landed a bluff', check: 'bluff', met: false, available: true, progress: '0 landed' },
      { title: 'Saw through a bluff', check: 'see', met: false, available: true, progress: '0 seen through' },
      { title: 'Nobody swept', check: 'clean', met: true, available: true, progress: 'nobody swept' },
    ]);
    const lost = evaluateGoals(s, 'B', 'easy');
    expect(lost.map((g) => g.met)).toEqual([false, false, false, false, false, true]);
  });
});

describe('v2 debrief numbers', () => {
  it('picks the MVP by delivered × 3 + used + picks, the earlier slot on a tie', () => {
    const s = createMatch(map('copper-hollow'), { A: [agent('a'), agent('a2'), agent('a3')], B: [agent('b')] });
    const [a, a2, a3] = s.agents;
    Object.assign(a!, { delivered: 1, used: 0, picks: 1 }); // 4
    Object.assign(a2!, { delivered: 0, used: 3, picks: 2 }); // 5
    Object.assign(a3!, { delivered: 1, used: 1, picks: 1 }); // 5
    expect(mvpOf(s, 'A')).toBe('a2');
    s.tally.A.sent = 4;
    s.tally.A.overheard = 2;
    s.tally.B.switches = 1;
    const r = crewReport(s, 'A');
    expect(r).toMatchObject({ mvp: 'a2', talk: { sent: 4, overheard: 2 }, switches: { mine: 0, rival: 1 } });
    expect(r.agents).toEqual([
      { agentId: 'a', name: 'a', delivered: 1, used: 0, picks: 1 },
      { agentId: 'a2', name: 'a2', delivered: 0, used: 3, picks: 2 },
      { agentId: 'a3', name: 'a3', delivered: 1, used: 1, picks: 1 },
    ]);
    expect(r.goals[0]!.title).toBe('Shore the tunnels');
  });
});

describe('v2 frames: plans, switches and hazards', () => {
  it('shows a crew its own plans only, and withholds a bought skill’s', () => {
    const s = createMatch(testMap(OPEN), { A: [agent('a'), agent('a2')], B: [agent('b')] });
    const extras = { plans: { a: 'Collect the near gem', a2: 'Hold the middle', b: 'Rush the exit' }, planHidden: ['a2'] };
    const fa = frameFor(s, 'A', [], extras);
    expect(fa.agents.map((x) => [x.id, x.plan, x.planHidden])).toEqual([
      ['a', 'Collect the near gem', undefined],
      ['a2', undefined, true],
      ['b', undefined, undefined],
    ]);
    expect(frameFor(s, 'watch', [], extras).agents.every((x) => x.plan === undefined)).toBe(true);
  });

  it('reports each hazard’s waves and the switches’ reset ticks', () => {
    const rows = ['###########', '#.........#', '#...V.....#', '#....E....#', '#.........#', '#.........#', '###########'];
    const lanes = { A: [5 * 11 + 1], B: [5 * 11 + 9] };
    const s = createMatch(testMap(rows, { hazards: [{ kind: 'water', every: 1, cap: 3 }], switches: [{ at: [4, 2], name: 'Pump', kind: 'water', lanes }] }), { A: [agent('a')], B: [agent('b')] });
    s.grid[4 * 11 + 8] = 'water';
    at(s, 'a', 3, 2);
    const ev = play(s, { a: { type: 'switch' } });
    const f = frameFor(s, 'A', ev);
    expect(f.switchReady).toEqual([27]);
    expect(f.hazards).toEqual([{ kind: 'water', waves: 1, receding: false }]);
  });
});

describe('v2 match log hash', () => {
  const header = (difficulty?: Difficulty) => ({
    schema: 'skirm.match/v2' as const,
    map: 'copper-hollow',
    crews: { A: [{ id: 'a', name: 'a', role: 'Runner', vision: 3, comms: 3, tier: 'standard' }], B: [{ id: 'b', name: 'b', role: 'Runner', vision: 3, comms: 3, tier: 'standard' }] },
    ranked: false,
    ...(difficulty ? { difficulty } : {}),
    models: { planner: 'p', actor: 'a', speech: 's' },
  });
  const tick1 = { tick: 1, actions: { a: { type: 'move', dir: 'E' } as Action, b: { type: 'wait' } as Action }, says: [{ agent: 'a', channel: 'team' as const, text: 'Go.' }] };

  it('is pinned: the same header and ticks always hash the same, and an absent level hashes as before', () => {
    const log = startLog(header());
    appendTick(log, tick1);
    expect(logHash(log)).toBe(PINNED);
    const hard = startLog(header('hard'));
    appendTick(hard, tick1);
    expect(logHash(hard)).not.toBe(PINNED);
  });

  it('replays a whole match on a level to the same hash', () => {
    const run = () => {
      const def = map('copper-hollow');
      const crews = { A: [agent('wick', 'Builder'), agent('moss', 'Digger')], B: [agent('wren', 'Digger'), agent('kes', 'Runner')] };
      const s = createMatch(def, crews, { difficulty: 'hard' });
      const log = startLog({ ...header('hard'), crews: { A: crews.A, B: crews.B } });
      const dirs = ['E', 'S', 'E', 'N', 'W', 'S'] as const;
      while (!s.result) {
        const actions = Object.fromEntries(s.agents.map((a, i): [string, Action] => [a.id, { type: 'move', dir: dirs[(s.tick + i * 2) % dirs.length]! }]));
        const says: SayInput[] = s.tick % 7 === 0 ? [{ agent: 'wren', channel: 'team', text: `Tick ${s.tick}.` }] : [];
        stepMatch(s, { actions, says });
        appendTick(log, { tick: s.tick, actions, says });
      }
      return { s, hash: logHash(log) };
    };
    const one = run();
    const two = run();
    expect(one.s.result!.ticks).toBe(135);
    expect(one.hash).toBe(two.hash);
    expect(one.s.tally).toEqual(two.s.tally);
  });
});

/** The hash of the fixed one-tick log above. Changing it means every stored match hash changes too. */
const PINNED = '3714893d0db9afb5114b6a897e750bdcc065225cbf493949f6dd7d9ea6a7f8c7';
