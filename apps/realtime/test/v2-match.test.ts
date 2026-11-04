import { createGreedyBrain, type V2Brain } from '@skirm/decision-engine/v2';
import { MAPS_V2, createMatch, frameFor, holdFor, verifyLog, type AgentSpec, type Difficulty, type MatchEvent, type Team } from '@skirm/engine/v2';
import type { V2ServerMessage } from '@skirm/server';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps';
import { LedgerV2Credits } from '../src/v2/credits';
import { makeDeps } from './helpers';
import { realScheduler } from '../src/timing';
import { V2Match, crewLimitOf, withOwnCrew, type V2Credits, type V2MatchDeps, type V2Setup } from '../src/v2/match';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role'], tier: AgentSpec['tier'] = 'standard'): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier });
const TEAMS: Team[] = ['A', 'B'];
const both = (b: V2Brain) => ({ A: b, B: b });
const FAST = { acceptMs: 60, lockMs: 60, tickMs: 1, actionMs: 40, planMs: 40, replanEvery: 25 };

function setup(ranked = false, over: Partial<V2Setup> = {}): V2Setup {
  return {
    matchId: 'mat_v2test',
    map,
    ranked,
    sides: {
      A: { accountId: 'acc_a', handle: 'ana', crew: [spec('wick', 'Builder'), spec('moss', 'Digger')], skills: [['Dam first.'], []] },
      B: { accountId: 'acc_b', handle: 'ben', crew: [spec('wren', 'Digger'), spec('kes', 'Runner')], skills: [[], []] },
    },
    ...over,
  };
}

class FakeCredits implements V2Credits {
  holds: Record<string, number> = {};
  charged: Record<string, number> = { A: 0, B: 0 };
  settled: Team[] = [];
  released: Team[] = [];
  constructor(private readonly short: Team | null = null) {}
  async hold(team: Team, _acc: string, amount: number) {
    if (team === this.short) return { ok: false as const, need: amount, have: 0 };
    this.holds[team] = amount;
    return { ok: true as const };
  }
  async charge(team: Team, n: number) {
    this.charged[team]! += n;
  }
  async settle(team: Team) {
    this.settled.push(team);
  }
  async release(team: Team) {
    this.released.push(team);
  }
}

function harness(over: Partial<V2MatchDeps> = {}, ranked = false, setupOver: Partial<V2Setup> = {}) {
  const inbox: Record<Team | 'watch', V2ServerMessage[]> = { A: [], B: [], watch: [] };
  const credits = (over.credits as FakeCredits | undefined) ?? new FakeCredits();
  const m = new V2Match(setup(ranked, setupOver), {
    brains: both(createGreedyBrain()),
    scheduler: realScheduler,
    timing: FAST,
    credits,
    send: (t, msg) => inbox[t].push(msg),
    watch: (msg) => inbox.watch.push(msg),
    log: silentLogger,
    ...over,
  });
  // Both players answer as soon as they are asked.
  const answer = (team: Team, msg: V2ServerMessage) => {
    if (msg.type === 'v2_found') queueMicrotask(() => m.accept(team));
    if (msg.type === 'v2_lockin') queueMicrotask(() => m.lockIn(team, team === 'A' ? ['open', 'quiet'] : []));
  };
  return { m, inbox, credits, answer };
}

describe('v2 match server', () => {
  it('runs accept, lock-in and a whole match, with fogged frames per crew and a verifiable log', async () => {
    const h = harness({ send: (t, msg) => (h.inbox[t].push(msg), h.answer(t, msg)) });
    const end = await h.m.play();
    expect(end.result).not.toBeNull();
    expect(end.log && verifyLog(end.log)).toBeNull();
    const types = h.inbox.A.map((x) => x.type);
    expect(types.slice(0, 3)).toEqual(['v2_found', 'v2_accepted', 'v2_accepted']);
    expect(types).toContain('v2_lockin');
    expect(types).toContain('v2_start');
    expect(types.at(-1)).toBe('v2_end');
    const start = h.inbox.A.find((x) => x.type === 'v2_start');
    expect(start).toMatchObject({ rival: { handle: 'ben' } });
    const lockin = h.inbox.A.find((x) => x.type === 'v2_lockin');
    expect(JSON.stringify(lockin)).not.toContain('ben');
    const framesA = h.inbox.A.filter((x) => x.type === 'v2_frame');
    expect(framesA.length).toBe(end.result!.ticks + 1);
    expect(framesA.every((f) => f.type === 'v2_frame' && f.frame.view === 'A')).toBe(true);
    expect(framesA[0]!.type === 'v2_frame' && framesA[0]!.frame.rows.join('')).toContain('?');
    expect(JSON.stringify(h.inbox.A)).not.toContain('Dam first.');
    expect(h.inbox.watch.filter((x) => x.type === 'v2_frame').every((f) => f.type === 'v2_frame' && f.frame.view === 'watch')).toBe(true);
    const end2 = h.inbox.B.at(-1);
    expect(end2).toMatchObject({ type: 'v2_end', logHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('holds every tick at the locked tiers, charges per tick and settles both crews', async () => {
    const h = harness({ send: (t, msg) => (h.inbox[t].push(msg), h.answer(t, msg)) });
    const end = await h.m.play();
    const s = h.m.state!;
    expect(s.agents.filter((a) => a.team === 'A').map((a) => a.tier)).toEqual(['open', 'quiet']);
    expect(h.credits.holds).toEqual({ A: holdFor(s.agents.filter((a) => a.team === 'A'), false), B: holdFor(setup().sides.B.crew, false) });
    // Open 40 + Quiet 20 = 60 hundredths of a credit a tick, charged in whole credits.
    expect(h.credits.holds.A).toBe(90);
    expect(h.credits.charged.A).toBe(Math.ceil((end.result!.ticks * 60) / 100));
    expect(h.credits.charged.A).toBeLessThanOrEqual(h.credits.holds.A!);
    expect(end.stats.A.charged).toBe(h.credits.charged.A);
    expect(h.credits.settled.sort()).toEqual(['A', 'B']);
    expect(h.credits.released).toEqual([]);
  });

  it('never holds or charges a free crew, and tells it so with the practice rival named', async () => {
    const h = harness({ send: (t, msg) => (h.inbox[t].push(msg), h.answer(t, msg)) }, false, { practice: true, free: { B: true } });
    const end = await h.m.play();
    expect(end.result).not.toBeNull();
    expect(Object.keys(h.credits.holds)).toEqual(['A']);
    expect(h.credits.charged.B).toBe(0);
    expect(end.stats.B.charged).toBe(0);
    expect(h.credits.settled).toEqual(['A']);
    expect(h.inbox.A[0]).toMatchObject({ type: 'v2_found', practice: true, rivalHandle: 'ben' });
    expect(h.inbox.A[0]).not.toHaveProperty('free');
    expect(h.inbox.B[0]).toMatchObject({ type: 'v2_found', practice: true, free: true, rivalHandle: 'ana' });
    expect(of(h.inbox.B, 'v2_lockin')[0]!.free).toBe(true);
    expect(of(h.inbox.A, 'v2_lockin')[0]!.free).toBeUndefined();
    expect(of(h.inbox.B, 'v2_end')[0]!.debrief!.credits).toEqual({ held: 0, used: 0, returned: 0 });
  });

  it('collects every delivered line, and plays each crew with its own brain', async () => {
    const talker: V2Brain = {
      kind: 'model',
      model: 'talker',
      act: async (o, ctx) => ({ action: o.legal[0] ?? { type: 'wait' }, reason: 'chosen', say: ctx.canSpeak ? { channel: 'team', text: 'Holding.' } : null }),
      plan: async () => ({ text: null }),
    };
    const h = harness({ brains: { A: talker, B: createGreedyBrain() }, send: (t, msg) => (h.inbox[t].push(msg), h.answer(t, msg)) });
    const end = await h.m.play();
    const said = end.log!.ticks.flatMap((t) => t.says.map((x) => ({ tick: t.tick, ...x })));
    expect(end.messages.length).toBeGreaterThan(0);
    // Every line the engine took is collected once, in order (crew B's greedy brain only calls out deliveries).
    expect(end.messages.map((m) => [m.tick, m.agentId, m.text])).toEqual(said.map((x) => [x.tick, x.agent, x.text]));
    // Wick talks Open (every tick); Moss is on Quiet, so it never gets a free-text turn.
    const mine = end.messages.filter((m) => m.team === 'A');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((m) => m.agentId === 'wick' && m.agentName === 'wick' && m.text === 'Holding.' && m.channel === 'team')).toBe(true);
    expect(end.messages[0]!.heardBy).toEqual(expect.any(Array));
    expect(end.log!.header.models.actor).toBe('A:talker B:greedy');
  });

  it('plays Standard for everyone in ranked', async () => {
    const h = harness({ send: (t, msg) => (h.inbox[t].push(msg), h.answer(t, msg)) }, true);
    await h.m.play();
    expect(h.m.state!.agents.every((a) => a.tier === 'standard')).toBe(true);
    expect(h.credits.holds.A).toBe(holdFor(setup().sides.A.crew, true));
  });

  it('is void, naming the crew, when a player does not accept or declines', async () => {
    const h = harness({ send: (t, msg) => (h.inbox[t].push(msg), t === 'A' && h.answer(t, msg)) });
    expect(await h.m.play()).toMatchObject({ result: null, reason: 'accept_timeout', fault: 'B' });
    expect(h.credits.holds).toEqual({});

    const d = harness({ send: (t, msg) => (d.inbox[t].push(msg), msg.type === 'v2_found' && t === 'B' && queueMicrotask(() => d.m.decline('B'))) });
    expect(await d.m.play()).toMatchObject({ result: null, reason: 'declined', fault: 'B' });
    expect(d.inbox.A.at(-1)).toMatchObject({ type: 'v2_end', reason: 'declined', logHash: null });
  });

  it('is void when a crew cannot cover its hold, returning the other crew’s hold', async () => {
    const credits = new FakeCredits('B');
    const h = harness({ credits, send: (t, msg) => (h.inbox[t].push(msg), h.answer(t, msg)) });
    expect(await h.m.play()).toMatchObject({ reason: 'credits', fault: 'B' });
    expect(credits.released).toEqual(['A']);
  });

  it('turns a brain that misses the deadline into waits, and an abort into a void with every credit returned', async () => {
    const slow: V2Brain = { kind: 'model', model: 'slow', act: () => new Promise(() => undefined), plan: async () => ({ text: null }) };
    const h = harness({ brains: both(slow), timing: { ...FAST, actionMs: 2 }, send: (t, msg) => {
      h.inbox[t].push(msg);
      h.answer(t, msg);
      if (msg.type === 'v2_frame' && msg.frame.tick === 12) h.m.abort('test');
    } });
    const end = await h.m.play();
    expect(end).toMatchObject({ result: null, reason: 'aborted' });
    expect(end.stats.A.timeouts).toBeGreaterThan(0);
    expect(h.credits.released.sort()).toEqual(['A', 'B']);
    expect(h.m.state!.score).toEqual({ A: 0, B: 0 });
  });
});

describe('v2 match: whole-credit charges never exceed the hold', () => {
  /** Every agent waits, so a match runs its whole clock. */
  const idle: V2Brain = { kind: 'model', model: 'idle', act: async () => ({ action: { type: 'wait' }, reason: 'chosen', say: null }), plan: async () => ({ text: null }) };

  class RecordingCredits extends FakeCredits {
    calls: Record<Team, number[]> = { A: [], B: [] };
    override async charge(team: Team, n: number) {
      this.calls[team].push(n);
      await super.charge(team, n);
    }
  }

  async function playClock(o: { tiers: Record<Team, AgentSpec['tier'][]>; difficulty: Difficulty; ranked?: boolean; outAt?: { tick: number; agent: string } }) {
    const credits = new RecordingCredits();
    const sides = setup().sides;
    const crew = (t: Team) => o.tiers[t].map((tier, i) => spec(`${t.toLowerCase()}${i}`, 'Runner', tier));
    const h = harness(
      {
        brains: both(idle),
        credits,
        send: (t, msg) => {
          h.inbox[t].push(msg);
          if (msg.type === 'v2_found') queueMicrotask(() => h.m.accept(t));
          if (msg.type === 'v2_lockin') queueMicrotask(() => h.m.lockIn(t, []));
          if (o.outAt && t === 'A' && msg.type === 'v2_frame' && msg.frame.tick === o.outAt.tick) h.m.state!.agents.find((a) => a.id === o.outAt!.agent)!.out = true;
        },
      },
      o.ranked ?? false,
      {
        difficulty: o.difficulty,
        sides: {
          A: { ...sides.A, crew: crew('A'), skills: o.tiers.A.map(() => []) },
          B: { ...sides.B, crew: crew('B'), skills: o.tiers.B.map(() => []) },
        },
      },
    );
    const end = await h.m.play();
    return { end, credits, s: h.m.state! };
  }

  const MIXES: Record<Team, AgentSpec['tier'][]>[] = [
    { A: ['quiet'], B: ['open'] },
    { A: ['standard', 'standard'], B: ['open', 'quiet'] },
    { A: ['open', 'open'], B: ['quiet', 'standard', 'open'] },
    { A: ['open', 'open', 'open'], B: ['quiet', 'quiet', 'quiet'] },
  ];

  // Each case plays every crew mix over the whole clock, which outruns the default 5 s on a slow machine.
  for (const [difficulty, ticks] of [['normal', 150], ['hard', 135], ['mega', 120]] as const) {
    it(`charges only positive whole credits, at most the hold, over the ${ticks}-tick ${difficulty} clock`, { timeout: 30_000 }, async () => {
      for (const tiers of MIXES) {
        const { end, credits, s } = await playClock({ tiers, difficulty });
        expect(s.limit).toBe(ticks);
        expect(end.result!.ticks).toBe(ticks);
        for (const t of TEAMS) {
          const calls = credits.calls[t];
          expect(calls.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
          const sum = calls.reduce((n, c) => n + c, 0);
          expect(sum).toBe(credits.charged[t]);
          expect(sum).toBe(end.stats[t].charged);
          expect(credits.holds[t]).toBe(holdFor(s.agents.filter((a) => a.team === t), false, ticks));
          expect(sum).toBeLessThanOrEqual(credits.holds[t]!);
          // Nobody went out, so the whole clock was used and the hold is charged exactly.
          expect(s.agents.filter((a) => a.team === t).some((a) => a.out)).toBe(false);
          expect(sum).toBe(credits.holds[t]);
        }
      }
    });
  }

  it('holds and charges ranked crews at Standard', async () => {
    const { credits } = await playClock({ tiers: { A: ['open', 'open'], B: ['quiet'] }, difficulty: 'hard', ranked: true });
    expect(credits.holds).toEqual({ A: 60, B: 30 });
    expect(credits.charged).toEqual({ A: 60, B: 30 });
  });

  it('stops charging an agent once it is out, and still never exceeds the hold', async () => {
    // A: Open (40) + Quiet (20); the Open agent is out after tick 10 of 150.
    const { credits, s } = await playClock({ tiers: { A: ['open', 'quiet'], B: ['standard'] }, difficulty: 'normal', outAt: { tick: 10, agent: 'a0' } });
    expect(s.agents.find((a) => a.id === 'a0')!.out).toBe(true);
    expect(credits.holds.A).toBe(90);
    expect(credits.charged.A).toBe(Math.ceil((10 * 60 + 140 * 20) / 100));
    expect(credits.charged.A).toBeLessThan(credits.holds.A!);
    expect(credits.calls.A.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    expect(credits.charged.B).toBe(30);
  });
});

const of = <T extends V2ServerMessage['type']>(list: V2ServerMessage[], type: T) =>
  list.filter((x): x is Extract<V2ServerMessage, { type: T }> => x.type === type);
const planner = (text: string): V2Brain => ({ ...createGreedyBrain(), plan: async () => ({ text }) });

describe('v2 match: difficulty, lock-in crew changes, plans, debrief and frames', () => {
  it('sends the difficulty with v2_found; ranked always plays Normal', async () => {
    const casual = harness({}, false, { difficulty: 'hard' });
    casual.m.abort('test');
    await casual.m.play();
    expect(casual.inbox.A[0]).toMatchObject({ type: 'v2_found', difficulty: 'hard' });
    const ranked = harness({}, true, { difficulty: 'hard' });
    ranked.m.abort('test');
    await ranked.m.play();
    expect(ranked.inbox.A[0]).toMatchObject({ type: 'v2_found', difficulty: 'normal' });
  });

  it('takes a new crew at lock-in, re-sends both head starts, and plays the new crew', async () => {
    const h = harness({
      send: (t, msg) => {
        h.inbox[t].push(msg);
        if (msg.type === 'v2_found') queueMicrotask(() => h.m.accept(t));
        // A drops moss and plays wick alone on Open; B keeps its crew. A locks in first.
        if (msg.type === 'v2_lockin' && t === 'A' && of(h.inbox.A, 'v2_lockin').length === 1)
          queueMicrotask(() => {
            expect(() => h.m.lockIn('A', [], { crew: [1, 2, 3, 4].map((i) => spec(`x${i}`, 'Runner')), skills: [] })).toThrow();
            h.m.lockIn('A', ['quiet'], { crew: [spec('wick', 'Builder', 'open')], skills: [['Dam first.']] });
          });
        if (msg.type === 'v2_locked' && msg.team === 'A' && t === 'B') queueMicrotask(() => h.m.lockIn('B', []));
      },
    });
    const end = await h.m.play();
    const first = of(h.inbox.B, 'v2_lockin')[0]!;
    expect(first).toMatchObject({ crewLimit: crewLimitOf(map), rival: { agents: 2 }, headStartTicks: { A: 0, B: 0 } });
    const again = of(h.inbox.B, 'v2_lockin')[1]!;
    // The bigger crew holds 5 ticks per extra agent.
    expect(again).toMatchObject({ rival: { agents: 1 }, headStartTicks: { A: 0, B: 5 } });
    expect(again.lockMs).toBeLessThanOrEqual(first.lockMs);
    expect(of(h.inbox.A, 'v2_lockin')[1]).toMatchObject({ rival: { agents: 2 }, headStartTicks: { A: 0, B: 5 } });
    expect(of(h.inbox.A, 'v2_start')[0]!.holdTicks).toEqual({ A: 0, B: 5 });
    const s = h.m.state!;
    expect(s.agents.filter((a) => a.team === 'A').map((a) => [a.id, a.tier])).toEqual([['wick', 'open']]);
    expect(end.log!.header.crews.A.map((a) => a.id)).toEqual(['wick']);
    expect(h.credits.holds.A).toBe(holdFor([spec('wick', 'Builder', 'open')], false));
    // A second lock-in is refused.
    expect(h.m.lockIn('A', [])).toBe(false);
  });

  it('shows each crew its own plan only, and hides it when the crew runs a bought skill', async () => {
    const h = harness({ brains: both(planner('Hold the lift.')), send: (t, msg) => (h.inbox[t].push(msg), h.answer(t, msg)) });
    await h.m.play();
    const own = (t: Team) => of(h.inbox[t], 'v2_frame').flatMap((f) => f.frame.agents.filter((a) => a.team === t));
    const rival = (t: Team) => of(h.inbox[t], 'v2_frame').flatMap((f) => f.frame.agents.filter((a) => a.team !== t));
    expect(own('A').every((a) => a.plan === 'Hold the lift.' && !a.planHidden)).toBe(true);
    expect(rival('A').some((a) => a.plan !== undefined)).toBe(false);
    expect(of(h.inbox.watch, 'v2_frame').some((f) => f.frame.agents.some((a) => a.plan !== undefined))).toBe(false);

    const b = harness(
      { brains: both(planner('Hold the lift.')), send: (t, msg) => (b.inbox[t].push(msg), b.answer(t, msg)) },
      false,
      { sides: { ...setup().sides, A: { ...setup().sides.A, bought: [false, true] } } },
    );
    await b.m.play();
    const ownB = of(b.inbox.A, 'v2_frame').flatMap((f) => f.frame.agents.filter((a) => a.team === 'A'));
    expect(ownB.length).toBeGreaterThan(0);
    // One crew plan is written with every skill, so the whole crew's plan is withheld.
    expect(ownB.every((a) => a.planHidden === true && a.plan === undefined)).toBe(true);
    expect(JSON.stringify(b.inbox.A)).not.toContain('Hold the lift.');
    expect(of(b.inbox.B, 'v2_frame').flatMap((f) => f.frame.agents).filter((a) => a.team === 'B').every((a) => a.plan === 'Hold the lift.')).toBe(true);
  });

  it('ends with each crew’s debrief (Elo, credits, talk, MVP) and keeps every frame for replay', async () => {
    const h = harness({
      send: (t, msg) => (h.inbox[t].push(msg), h.answer(t, msg)),
      finish: async () => ({ eloDelta: { A: 12, B: -12 }, registry: 'pending', season: { A: { number: 3, points: 25 }, B: { number: 3, points: 5 } } }),
    });
    const end = await h.m.play();
    const endA = of(h.inbox.A, 'v2_end')[0]!;
    const d = endA.debrief!;
    const held = holdFor(h.m.state!.agents.filter((a) => a.team === 'A'), false);
    expect(d).toMatchObject({ eloDelta: 12, registry: 'pending', difficulty: 'normal', season: { number: 3, points: 25 } });
    const used = h.credits.charged.A!;
    expect(d.credits).toEqual({ held, used, returned: held - used });
    expect(d.agents.map((a) => a.agentId)).toEqual(['wick', 'moss']);
    expect(d.agents.reduce((n, a) => n + a.delivered, 0)).toBe(end.result!.score.A);
    expect(['wick', 'moss']).toContain(d.mvp);
    const said = of(h.inbox.watch, 'v2_frame').flatMap((f) => f.frame.events).filter((e) => e.kind === 'said' && ['wick', 'moss'].includes(e.agent));
    expect(d.talk.sent).toBe(said.length);
    expect(of(h.inbox.B, 'v2_end')[0]!.debrief).toMatchObject({ eloDelta: -12, season: { number: 3, points: 5 } });
    expect(of(h.inbox.watch, 'v2_end')[0]!.debrief).toBeUndefined();

    expect(h.m.framesOf('A')).toHaveLength(end.result!.ticks + 1);
    expect(h.m.framesOf('watch')).toHaveLength(end.result!.ticks + 1);
    expect(h.m.framesOf('B').every((f) => f.view === 'B')).toBe(true);
  });

  it('gives a void match a debrief with every credit returned and no Elo', async () => {
    const credits = new FakeCredits('B');
    const h = harness({ credits, send: (t, msg) => (h.inbox[t].push(msg), h.answer(t, msg)), finish: async () => ({ eloDelta: { A: 9 }, registry: 'pending' }) });
    await h.m.play();
    const d = of(h.inbox.A, 'v2_end')[0]!.debrief!;
    const held = holdFor(setup().sides.A.crew.map((a, i) => ({ ...a, tier: (['open', 'quiet'] as const)[i]! })), false);
    expect(d).toMatchObject({ eloDelta: null, registry: null, mvp: null, agents: [], goals: [] });
    expect(d.credits).toEqual({ held, used: 0, returned: held });
    expect(of(h.inbox.B, 'v2_end')[0]!.debrief!.credits).toEqual({ held: 0, used: 0, returned: 0 });
    expect(h.m.framesOf('A')).toEqual([]);
  });

  it('names the rival agents that overheard a crew’s own team message', () => {
    const s = createMatch(map, { A: setup().sides.A.crew, B: setup().sides.B.crew });
    const said: MatchEvent = { kind: 'said', agent: 'wick', channel: 'team', text: 'Lift is clear', heardBy: ['moss'], overheardBy: ['wren'] };
    const f = withOwnCrew(frameFor(s, 'A', [said]), s, 'A', [said], null, []);
    expect(f.comms).toEqual([expect.objectContaining({ from: 'wick', overheardBy: ['wren'] })]);
    const quiet: MatchEvent = { ...said, overheardBy: [] };
    expect(withOwnCrew(frameFor(s, 'A', [quiet]), s, 'A', [quiet], null, []).comms[0]!.overheardBy).toBeUndefined();
  });

  it('gives a crew its plan, the planner trace and each agent’s inner voice, never the rival’s, and withholds them for bought skills', () => {
    const s = createMatch(map, { A: setup().sides.A.crew, B: setup().sides.B.crew });
    const thoughts = new Map([
      ['wick', 'Lift is mine.'],
      ['moss', 'Dig, dig.'],
      ['wren', 'Rival secret.'],
    ]);
    const mind = { why: 'The pump floods our side first.', thoughts };
    const f = withOwnCrew(frameFor(s, 'A', []), s, 'A', [], 'Wick shores, Moss digs.', [false, false], mind);
    const wick = f.agents.find((a) => a.id === 'wick')!;
    expect(wick).toMatchObject({ plan: 'Wick shores, Moss digs.', planWhy: 'The pump floods our side first.', thought: 'Lift is mine.' });
    expect(f.agents.find((a) => a.id === 'moss')!.thought).toBe('Dig, dig.');
    // Rivals in sight never carry a plan or a thought.
    for (const a of f.agents.filter((x) => x.team === 'B')) expect(a.thought ?? a.plan ?? a.planWhy).toBeUndefined();
    // Moss runs a bought skill: the crew plan and its reason go for everyone, and Moss's own thought too.
    const b = withOwnCrew(frameFor(s, 'A', []), s, 'A', [], 'Wick shores, Moss digs.', [false, true], mind);
    const bw = b.agents.find((a) => a.id === 'wick')!;
    expect(bw).toMatchObject({ planHidden: true, thought: 'Lift is mine.' });
    expect(bw.plan ?? bw.planWhy).toBeUndefined();
    expect(b.agents.find((a) => a.id === 'moss')!.thought).toBeUndefined();
  });
});

describe('v2 credits on the ledger', () => {
  it('holds the whole match, charges each tick and returns the rest', async () => {
    const deps = await makeDeps();
    const repos = deps.repos;
    const { account } = await repos.accounts.getOrCreate({ handle: 'ana' }, deps.vault);
    await repos.ledger.topUp({ accountId: account.id, credits: 1000 });
    const before = await repos.ledger.balance(account.id);
    const c = new LedgerV2Credits(repos.ledger, 'mat_ledger', silentLogger);
    expect(await c.hold('A', account.id, 300)).toEqual({ ok: true });
    expect((await repos.ledger.balance(account.id)).held).toBe(300);
    await c.charge('A', 2);
    await c.charge('A', 2);
    await c.settle('A');
    const after = await repos.ledger.balance(account.id);
    expect(after.held).toBe(0);
    expect(before.available - after.available).toBe(4);

    expect(await c.hold('B', account.id, 100_000)).toMatchObject({ ok: false });
    expect(await c.hold('B', account.id, 50)).toEqual({ ok: true });
    await c.charge('B', 4);
    await c.release('B');
    expect((await repos.ledger.balance(account.id)).available).toBe(after.available);
  });
});
