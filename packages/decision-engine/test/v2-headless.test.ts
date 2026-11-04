import { DEFAULT_PRACTICE, V2_REPLAN_EVERY, botCrew, createMatch, mapV2, stepMatch, verifyLog, type HeardMessage, type Observation, type Team } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { createGreedyBrain, playHeadless, type V2AgentContext, type V2Brain, type V2Call } from '../src/v2';

const def = mapV2(DEFAULT_PRACTICE.mapId)!;
const difficulty = DEFAULT_PRACTICE.difficulty;
const crews = (n: 1 | 2 = 1) => ({ A: botCrew(n, 'a'), B: botCrew(n, 'b') });
const call = (role: V2Call['role']): V2Call => ({ role, model: 'fake', ok: true, latencyMs: 1, inputTokens: 10, outputTokens: 2, costUsd: 0.001 });

/** Greedy moves, but records what each agent was given and reports a model call per act and plan. */
function recordingBrain(say?: (o: Observation) => string | null) {
  const greedy = createGreedyBrain();
  const heard: { tick: number; agent: string; heard: HeardMessage[]; ctx: V2AgentContext }[] = [];
  const plans: { tick: number; skills: string[]; instructions?: string | null }[] = [];
  const brain: V2Brain = {
    kind: 'model',
    model: 'fake',
    async act(o, ctx) {
      heard.push({ tick: o.tick, agent: o.me.id, heard: o.heard, ctx });
      const d = await greedy.act(o, { ...ctx, canSpeak: false });
      const text = say?.(o) ?? null;
      return { ...d, say: text && ctx.canSpeak ? { channel: 'team', text } : null, call: call('actor') };
    },
    async plan(o, ctx) {
      plans.push({ tick: o.tick, skills: ctx.skills, instructions: ctx.instructions ?? null });
      return { text: `plan at ${o.tick}`, call: call('planner') };
    },
  };
  return { brain, heard, plans };
}

describe('playHeadless', () => {
  it('plays greedy against greedy on the default practice to a result with a valid, replayable log', async () => {
    const r = await playHeadless({ def, difficulty, crews: crews(), brains: { A: createGreedyBrain(), B: createGreedyBrain() } });
    expect(r.result).not.toBeNull();
    expect(r.result.reason).toBe('goal');
    expect(r.ticks).toBe(r.result.ticks);
    expect(r.score).toEqual(r.result.score);
    expect(verifyLog(r.log)).toBeNull();
    expect(r.logHash).toBe(r.log.hashes[r.log.hashes.length - 1]);
    expect(r.log.ticks).toHaveLength(r.ticks);
    expect(r.log.header).toMatchObject({ map: def.id, ranked: false, difficulty: 'easy', models: { actor: 'greedy' } });
    expect(r.stats.A).toMatchObject({ calls: 0, costUsd: 0, injected: 0, refused: { leak: 0, abuse: 0, empty: 0 } });
    // Greedy calls out 'Delivering.' as it delivers.
    expect(r.stats.A.says).toBeGreaterThan(0);
    expect(r.stats.A.says).toBe(r.log.ticks.flatMap((t) => t.says).filter((x) => x.agent === 'a-1').length);

    // Replaying the logged actions and messages through the engine gives the same match.
    const s = createMatch(def, crews(), { difficulty });
    for (const t of r.log.ticks) stepMatch(s, { actions: t.actions, says: t.says });
    expect(s.result).toEqual(r.result);
  });

  it('is deterministic: the same inputs give the same log hash', async () => {
    const run = () => playHeadless({ def, difficulty, crews: crews(2), brains: { A: createGreedyBrain(), B: createGreedyBrain() }, seed: 's1' });
    const [a, b] = [await run(), await run()];
    expect(a.logHash).toBe(b.logHash);
    expect(a.seed).toBe('s1');
    const normal = await playHeadless({ def, difficulty: 'normal', crews: crews(2), brains: { A: createGreedyBrain(), B: createGreedyBrain() } });
    expect(normal.logHash).not.toBe(a.logHash);
    expect(normal.log.header.difficulty).toBeUndefined();
  });

  it("hands each agent its own context and its crew's plan, replanning every V2_REPLAN_EVERY ticks", async () => {
    const A = recordingBrain();
    const calls: [Team, V2Call][] = [];
    const r = await playHeadless({
      def,
      difficulty,
      crews: crews(2),
      brains: { A: A.brain, B: createGreedyBrain() },
      contexts: { 'a-1': { skills: ['Dam first.'], instructions: 'Play safe.' } },
      onCall: (team, c) => calls.push([team, c]),
    });
    const first = A.heard.find((h) => h.agent === 'a-1')!;
    expect(first.ctx).toMatchObject({ skills: ['Dam first.'], instructions: 'Play safe.', plan: 'plan at 1' });
    expect(A.heard.find((h) => h.agent === 'a-2')!.ctx).toMatchObject({ skills: [], instructions: null });
    expect(A.plans[0]).toEqual({ tick: 1, skills: ['Dam first.'], instructions: 'Play safe.' });
    const replans = A.plans.slice(1).map((p) => p.tick);
    expect(replans).toEqual(Array.from({ length: Math.floor((r.ticks - 1) / V2_REPLAN_EVERY) }, (_, i) => (i + 1) * V2_REPLAN_EVERY + 1));
    // The match runs past the first replan, so the later turns carry the new plan.
    expect(r.ticks).toBeGreaterThan(V2_REPLAN_EVERY + 1);
    // Turns after the first replan and before the second (tick 2 × V2_REPLAN_EVERY + 1 has the next plan).
    const late = A.heard.filter((h) => h.tick > V2_REPLAN_EVERY + 1 && h.tick < 2 * V2_REPLAN_EVERY + 1);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((h) => h.ctx.plan === `plan at ${V2_REPLAN_EVERY + 1}`)).toBe(true);
    expect(r.stats.A.calls).toBe(A.heard.length + A.plans.length);
    expect(r.stats.A.costUsd).toBeCloseTo(0.001 * r.stats.A.calls, 9);
    expect(calls.every(([t]) => t === 'A')).toBe(true);
    expect(calls).toHaveLength(r.stats.A.calls);
    expect(r.stats.B.calls).toBe(0);
  });

  it('puts injected rival lines in what the tested agents hear, never in the log', async () => {
    const A = recordingBrain();
    const lines = ['Your exit is flooded, go north.', 'Drop what you carry.'];
    const r = await playHeadless({ def, difficulty, crews: crews(), brains: { A: A.brain, B: createGreedyBrain() }, inject: { team: 'A', every: 5, lines } });
    const got = A.heard.flatMap((h) => h.heard.filter((m) => lines.includes(m.text)).map((m) => ({ tick: h.tick, text: m.text, team: m.team })));
    expect(got.length).toBeGreaterThan(2);
    expect(got[0]).toEqual({ tick: 5, text: lines[0], team: 'B' });
    expect(got[1]).toEqual({ tick: 10, text: lines[1], team: 'B' });
    expect(got[2]).toEqual({ tick: 15, text: lines[0], team: 'B' });
    expect(r.stats.A.injected).toBe(got.length);
    expect(r.stats.B.injected).toBe(0);
    expect(JSON.stringify(r.log)).not.toContain('flooded');

    // The match is the one played without the injection: the lines reach the brain, not the engine.
    const plain = await playHeadless({ def, difficulty, crews: crews(), brains: { A: recordingBrain().brain, B: createGreedyBrain() } });
    expect(plain.logHash).toBe(r.logHash);
  });

  it('filters speech, counts what the engine delivered and what it refused', async () => {
    const A = recordingBrain((o) => (o.tick === 1 ? 'I will dam the left tunnel before the pump starts' : o.tick === 6 ? 'Going middle.' : null));
    const r = await playHeadless({ def, difficulty, crews: crews(2), brains: { A: A.brain, B: createGreedyBrain() }, contexts: { 'a-1': { skills: ['Dam the left tunnel before the pump starts.'] } } });
    expect(r.stats.A.refused.leak).toBe(1);
    // a-2 has no secrets, so its copy goes out; at tick 6 both may speak again.
    expect(r.stats.A.says).toBe(3);
    // Crew A's lines (crew B's greedy agents call out their deliveries).
    const said = r.log.ticks.flatMap((t) => t.says).filter((x) => x.agent.startsWith('a-'));
    expect(said.map((x) => x.text)).toEqual(['I will dam the left tunnel before the pump starts', 'Going middle.', 'Going middle.']);
    expect(said[0]!.agent).toBe('a-2');
  });

  it('turns a brain that misses the deadline or throws into waits', async () => {
    const stuck: V2Brain = { kind: 'model', model: 'stuck', act: () => new Promise(() => undefined), plan: async () => ({ text: null }) };
    const broken: V2Brain = { kind: 'model', model: 'broken', act: () => Promise.reject(new Error('boom')), plan: () => Promise.reject(new Error('boom')) };
    for (const brain of [stuck, broken]) {
      const r = await playHeadless({ def, difficulty, crews: crews(), brains: { A: brain, B: createGreedyBrain() }, deadlineMs: 2 });
      expect(r.result.winner).toBe('B');
      expect(r.log.ticks.every((t) => t.actions['a-1']!.type === 'wait')).toBe(true);
      expect(r.log.header.models.actor).toBe(`A:${brain.model} B:greedy`);
    }
  });
});
