// The debrief's decision timeline as realtime builds and stores it: per agent per tick what it saw,
// the action and what came of it, the skill the model named (by id), the crew plan, the inner voice
// and the key moments; withheld like the live mind panel for bought skills; stored when a match ends.
import { OfficialRepo, SYSTEM_ACCOUNT_ID } from '@skirm/db';
import { createGreedyBrain, type V2Brain } from '@skirm/decision-engine/v2';
import { MAPS_V2, type AgentSpec, type Team } from '@skirm/engine/v2';
import type { V2ServerMessage } from '@skirm/server';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps';
import { RealtimeHub } from '../src/hub';
import { realScheduler } from '../src/timing';
import { V2Match, type V2Credits, type V2Setup } from '../src/v2/match';
import { DecisionTimeline } from '../src/v2/timeline';
import { FakeSocket, makeDeps } from './helpers';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard' });
const FAST = { acceptMs: 60, lockMs: 60, tickMs: 1, actionMs: 40, planMs: 40, replanEvery: 25 };

const noCredits: V2Credits = {
  hold: async () => ({ ok: true }),
  charge: async () => undefined,
  settle: async () => undefined,
  release: async () => undefined,
};

/** A model brain stand-in: greedy moves, a plan with a reason, a thought, and its first skill named whenever it carries one. */
const naming: V2Brain = {
  kind: 'haiku',
  model: 'fake-haiku',
  async act(o, ctx) {
    const d = await createGreedyBrain().act(o, { ...ctx, canSpeak: false });
    return { ...d, thought: 'Following my skill.', ...(ctx.skills.length ? { skill: 0 } : {}) };
  },
  async plan() {
    return { text: 'Wick dams, Moss digs.', why: 'The water comes from the left.' };
  },
};

async function play(over: Partial<V2Setup['sides']['A']> = {}) {
  const setup: V2Setup = {
    matchId: 'mat_timeline',
    map,
    ranked: false,
    sides: {
      A: { accountId: 'acc_a', handle: 'ana', crew: [spec('wick', 'Builder'), spec('moss', 'Digger')], skills: [['Dam first.'], []], skillKeys: [[{ id: 'skl_dam', version: 2 }], []], ...over },
      B: { accountId: 'acc_b', handle: 'ben', crew: [spec('wren', 'Digger')], skills: [[]] },
    },
  };
  let m!: V2Match;
  const answer = (team: Team, msg: V2ServerMessage) => {
    if (msg.type === 'v2_found') queueMicrotask(() => m.accept(team));
    if (msg.type === 'v2_lockin') queueMicrotask(() => m.lockIn(team, []));
  };
  m = new V2Match(setup, { brains: { A: naming, B: createGreedyBrain() }, scheduler: realScheduler, timing: FAST, credits: noCredits, send: answer, log: silentLogger });
  const end = await m.play();
  return { m, end };
}

describe('v2 decision timeline', () => {
  it('records every agent every tick, with the skill the model named, the plan and the moments', async () => {
    const { m, end } = await play();
    expect(end.result).not.toBeNull();
    const [a, b] = m.timelines();
    expect(a!.team).toBe('A');
    expect(a!.brain).toBe('haiku');
    expect(b!.brain).toBe('greedy');
    const ticks = end.result!.ticks;
    const wick = a!.decisions.filter((d) => d.agentId === 'wick');
    expect(wick.map((d) => d.tick)).toEqual(Array.from({ length: wick.length }, (_, i) => i + 1));
    expect(wick.at(-1)!.tick).toBeLessThanOrEqual(ticks);
    expect(wick[0]).toMatchObject({ tick: 1, observed: expect.stringContaining('carrying'), reason: 'chosen', thought: 'Following my skill.' });
    // Agents that skip the brain (nothing to choose) name no skill; the ones that asked name skl_dam v2.
    expect(wick.some((d) => d.skill?.id === 'skl_dam' && d.skill.version === 2)).toBe(true);
    expect(a!.decisions.filter((d) => d.agentId === 'moss').every((d) => !d.skill)).toBe(true);
    expect(a!.plans[0]).toEqual({ tick: 1, text: 'Wick dams, Moss digs.', why: 'The water comes from the left.' });
    // Crew B's own record never carries crew A's turns.
    expect(b!.decisions.every((d) => d.agentId === 'wren')).toBe(true);
    // Every delivery is a goal moment for both crews.
    const delivered = a!.decisions.filter((d) => d.outcome?.some((o) => o.startsWith('delivered'))).length;
    expect(a!.moments.filter((x) => x.kind === 'goal' && x.team === 'A')).toHaveLength(delivered);
    expect(b!.moments.filter((x) => x.kind === 'goal' && x.team === 'A')).toHaveLength(delivered);
    // Skill text is never in the timeline.
    expect(JSON.stringify(m.timelines())).not.toContain('Dam first.');
  });

  it('keeps no plan text and no inner voice for an agent on a bought skill', async () => {
    const { m } = await play({ bought: [true, false] });
    const [a] = m.timelines();
    expect(a!.plans.every((p) => p.hidden && p.text === null && p.why === null)).toBe(true);
    expect(a!.decisions.filter((d) => d.agentId === 'wick').every((d) => d.thought === undefined)).toBe(true);
    expect(a!.decisions.filter((d) => d.agentId === 'moss').some((d) => d.thought)).toBe(true);
  });

  it('marks hazard breaches for the agent’s own crew only, and switches and supply drops for both', () => {
    const t = new DecisionTimeline({
      A: { brain: 'haiku', bought: [], skillKeys: [] },
      B: { brain: 'greedy', bought: [], skillKeys: [] },
    });
    const agents = [
      { id: 'wick', name: 'Wick', team: 'A', slot: 0 },
      { id: 'wren', name: 'Wren', team: 'B', slot: 0 },
    ];
    const s = { tick: 7, agents } as unknown as Parameters<DecisionTimeline['resolve']>[0];
    t.turn(agents[0] as never, { action: { type: 'move', dir: 'E' }, reason: 'chosen', say: null });
    t.resolve(s, [
      { kind: 'knocked_down', agent: 'wick', by: 'water', dropped: 1 },
      { kind: 'switch', agent: 'wren', name: 'the north valve', floods: 'A', until: 15 },
      { kind: 'picked', agent: 'wren', at: [3, 3], stolen: false, origin: 'drop' },
    ]);
    const [a, b] = t.records();
    expect(a!.decisions).toEqual([{ tick: 7, agentId: 'wick', observed: '', action: 'move E', reason: 'chosen', outcome: ['knocked down by water'] }]);
    expect(a!.moments.map((x) => x.kind)).toEqual(['hazard_breach', 'switch', 'supply_drop']);
    expect(b!.moments.map((x) => x.kind)).toEqual(['switch', 'supply_drop']);
    expect(a!.moments[0]).toMatchObject({ tick: 7, team: 'A', agentId: 'wick', text: 'water reached Wick, 1 dropped' });
  });
});

describe('v2 decision timeline over the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('stores both crews’ timelines of a practice match before v2_end goes out', async () => {
    const deps = await makeDeps({ v2Timing: { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 }, v2Brain: createGreedyBrain() });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    hub = new RealtimeHub(deps);
    const sock = new FakeSocket();
    const c = hub.connect(sock);
    const send = (msg: unknown) => hub!.message(c, JSON.stringify(msg));
    await send({ type: 'auth', devUser: 'tia' });
    const acc = (await deps.repos.accounts.byHandle('tia'))!;
    const [agent] = await deps.repos.agents.listByOwner(acc.id);
    await send({ type: 'v2_queue', crew: [{ agentId: agent!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    const found = await sock.inbox.next('v2_found');
    await send({ type: 'v2_accept', matchId: found.matchId });
    await sock.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
    await send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await sock.inbox.next('v2_end', (m) => m.matchId === found.matchId, 30_000);
    const rows = await deps.repos.matchTimelines.list(found.matchId);
    expect(rows.map((r) => [r.team, r.brain])).toEqual([
      ['A', 'greedy'],
      ['B', 'greedy'],
    ]);
    expect(rows[0]!.decisions.length).toBeGreaterThan(0);
    expect(rows[0]!.decisions.every((d) => d.agentId === agent!.id)).toBe(true);
    const match = (await deps.repos.v2Matches.get(found.matchId))!;
    expect(match.teamBAccountId).toBe(SYSTEM_ACCOUNT_ID);
  });
});
