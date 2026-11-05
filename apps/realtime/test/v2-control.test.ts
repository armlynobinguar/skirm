// Hybrid control: a player steers one agent of their own crew while the brain runs the rest. The
// steered agent's action comes from the player's input (a wait when none came by the action
// deadline), the brain is never asked for it, the planner is told, every view marks it and the log
// lists it on each tick it was steered. Casual and practice only. Over the hub: v2_control →
// v2_control_ok, v2_steer (no answer).
import { OfficialRepo } from '@skirm/db';
import { createGreedyBrain, type V2Brain, type V2PlanContext } from '@skirm/decision-engine/v2';
import { MAPS_V2, verifyLog, type AgentSpec, type Team } from '@skirm/engine/v2';
import type { V2ServerMessage } from '@skirm/server';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps';
import { RealtimeHub } from '../src/hub';
import { realScheduler } from '../src/timing';
import { V2Match, type V2ControlResult, type V2Credits, type V2Setup } from '../src/v2/match';
import { FakeSocket, makeDeps } from './helpers';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id.toUpperCase(), role, vision: 3, comms: 3, tier: 'standard' });
const FAST = { acceptMs: 60, lockMs: 60, tickMs: 1, actionMs: 20, planMs: 40, replanEvery: 25 };

const credits: V2Credits = {
  hold: async () => ({ ok: true }),
  charge: async () => {},
  settle: async () => {},
  release: async () => {},
};

function setup(ranked = false): V2Setup {
  return {
    matchId: 'mat_ctl',
    map,
    ranked,
    sides: {
      A: { accountId: 'acc_a', handle: 'ana', crew: [spec('wick', 'Builder'), spec('moss', 'Digger')], skills: [[], []] },
      B: { accountId: 'acc_b', handle: 'ben', crew: [spec('wren', 'Digger'), spec('kes', 'Runner')], skills: [[], []] },
    },
  };
}

/** Greedy, recording who the brain was asked to act for and what the planner was told. */
function recorder() {
  const acted: { tick: number; id: string }[] = [];
  const planned: V2PlanContext[] = [];
  const greedy = createGreedyBrain();
  const brain: V2Brain = {
    kind: 'greedy',
    model: 'greedy',
    async act(o, ctx) {
      acted.push({ tick: o.tick, id: o.me.id });
      return greedy.act(o, ctx);
    },
    async plan(o, ctx) {
      planned.push(ctx);
      return greedy.plan(o, ctx);
    },
  };
  return { brain, acted, planned };
}

/** A match whose crew A player runs `onTick[tick]` when its frame for that tick arrives. */
function harness(onTick: Record<number, (m: V2Match) => V2ControlResult>, ranked = false) {
  const inbox: Record<Team | 'watch', V2ServerMessage[]> = { A: [], B: [], watch: [] };
  const results: Record<number, V2ControlResult> = {};
  const rec = recorder();
  const m: V2Match = new V2Match(setup(ranked), {
    brains: { A: rec.brain, B: rec.brain },
    scheduler: realScheduler,
    timing: FAST,
    credits,
    send: (t, msg) => {
      inbox[t].push(msg);
      if (msg.type === 'v2_found') queueMicrotask(() => m.accept(t));
      if (msg.type === 'v2_lockin') queueMicrotask(() => m.lockIn(t, []));
      if (t === 'A' && msg.type === 'v2_frame' && onTick[msg.frame.tick]) results[msg.frame.tick] = onTick[msg.frame.tick]!(m);
    },
    watch: (msg) => inbox.watch.push(msg),
    log: silentLogger,
  });
  return { m, inbox, results, ...rec };
}

const frames = (msgs: V2ServerMessage[]) => msgs.flatMap((x) => (x.type === 'v2_frame' ? [x.frame] : []));

describe('v2 hybrid control', () => {
  it('plays the steered agent from the player, logs and marks it, tells the planner, and releases on request', async () => {
    const h = harness({
      2: (m) => m.control('A', 'wick'),
      3: (m) => m.steer('A', { kind: 'take' }),
      12: (m) => m.control('A', null),
    });
    const end = await h.m.play();
    expect(h.results[2]).toEqual({ ok: true, agentId: 'wick' });
    expect(h.results[3]).toEqual({ ok: true, agentId: 'wick' });
    expect(h.results[12]).toEqual({ ok: true, agentId: null });

    // Ticks 3 to 12 are the player's: the brain is never asked for wick then, and is again after.
    const brainWick = h.acted.filter((x) => x.id === 'wick').map((x) => x.tick);
    for (let t = 3; t <= 12; t++) expect(brainWick).not.toContain(t);
    expect(brainWick.some((t) => t > 12)).toBe(true);
    expect(h.acted.some((x) => x.id === 'moss' && x.tick >= 3 && x.tick <= 12)).toBe(true);

    // The log lists wick on exactly those ticks, and the chain still checks.
    const logged = end.log!.ticks.filter((t) => t.controlled).map((t) => t.tick);
    expect(logged).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(end.log!.ticks.find((t) => t.tick === 3)!.controlled).toEqual(['wick']);
    expect(verifyLog(end.log!)).toBeNull();
    // The take order walks it: it moves on the steered ticks.
    expect(end.log!.ticks.filter((t) => t.controlled).some((t) => t.actions.wick?.type === 'move')).toBe(true);

    // The planner was told by name once control was taken.
    expect(h.planned.some((p) => p.controlled === 'WICK')).toBe(true);

    // Every view marks wick while steered; only crew A's own frames carry the steer state.
    const at = (v: Team | 'watch', tick: number) => frames(h.inbox[v]).find((f) => f.tick === tick)!;
    expect(at('A', 5).agents.find((a) => a.id === 'wick')!.controlled).toBe(true);
    expect(at('A', 5).agents.find((a) => a.id === 'moss')!.controlled).toBeUndefined();
    expect(at('A', 5).steer).toMatchObject({ agentId: 'wick' });
    expect(at('watch', 5).agents.find((a) => a.id === 'wick')!.controlled).toBe(true);
    expect(at('B', 5).steer).toBeUndefined();
    expect(at('A', 13).steer).toBeUndefined();
    expect(at('A', 13).agents.find((a) => a.id === 'wick')!.controlled).toBeUndefined();
  });

  it('waits at the action deadline when the player sends nothing, and plays one-tick inputs once', async () => {
    const h = harness({
      2: (m) => m.control('A', 'moss'),
      5: (m) => m.steer('A', { kind: 'move', dir: 'N' }),
      8: (m) => m.control('A', null),
    });
    const end = await h.m.play();
    const steered = end.log!.ticks.filter((t) => t.controlled);
    expect(steered.map((t) => t.tick)).toEqual([3, 4, 5, 6, 7, 8]);
    // No input on 3 to 5: a wait each (never counted as a brain timeout).
    for (const t of steered.filter((x) => x.tick <= 5)) expect(t.actions.moss).toEqual({ type: 'wait' });
    // The move sent on frame 5 is tick 6's action (when legal), then it waits again.
    const six = steered.find((t) => t.tick === 6)!.actions.moss!;
    expect(['move', 'wait']).toContain(six.type);
    for (const t of steered.filter((x) => x.tick >= 7)) expect(t.actions.moss).toEqual({ type: 'wait' });
    expect(end.stats.A.timeouts).toBe(0);
  });

  it('refuses ranked, someone else’s agent, steering without control and a match that is not live', async () => {
    const r = harness({ 2: (m) => m.control('A', 'wick') }, true);
    await r.m.play();
    expect(r.results[2]).toMatchObject({ ok: false, code: 'control_casual' });

    const h = harness({
      2: (m) => m.control('A', 'wren'),
      3: (m) => m.steer('A', { kind: 'wait' }),
    });
    expect(h.m.control('A', 'wick')).toMatchObject({ ok: false, code: 'not_live' });
    await h.m.play();
    expect(h.results[2]).toMatchObject({ ok: false, code: 'invalid_command' });
    expect(h.results[3]).toMatchObject({ ok: false, code: 'not_controlling' });
    expect(h.m.steer('A', { kind: 'wait' })).toMatchObject({ ok: false, code: 'not_live' });
  });
});

describe('v2_control over the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('answers v2_control_ok, takes v2_steer, refuses spectators, and hands control back', async () => {
    const deps = await makeDeps({
      v2Timing: { acceptMs: 500, lockMs: 500, tickMs: 25, actionMs: 20, planMs: 200 },
      v2Brain: createGreedyBrain(),
    });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    hub = new RealtimeHub(deps);
    const sock = new FakeSocket();
    const c = hub.connect(sock);
    const send = (m: unknown) => hub!.message(c, JSON.stringify(m));
    await send({ type: 'auth', devUser: 'cora' });
    const acc = (await deps.repos.accounts.byHandle('cora'))!;
    const agents = await deps.repos.agents.listByOwner(acc.id);

    await send({ type: 'v2_queue', crew: [{ agentId: agents[0]!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    const found = await sock.inbox.next('v2_found');
    await send({ type: 'v2_accept', matchId: found.matchId });
    await sock.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
    await send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    const first = await sock.inbox.next('v2_frame', (m) => m.matchId === found.matchId);
    const mine = first.frame.agents.find((a) => a.team === found.team)!;

    // A spectator (another player) cannot steer this match.
    const other = new FakeSocket();
    const oc = hub.connect(other);
    await hub.message(oc, JSON.stringify({ type: 'auth', devUser: 'dax' }));
    await hub.message(oc, JSON.stringify({ type: 'v2_control', matchId: found.matchId, agentId: mine.id }));
    expect(other.inbox.ofType('error').at(-1)).toMatchObject({ code: 'not_found' });

    await send({ type: 'v2_steer', matchId: found.matchId, input: { kind: 'wait' } });
    expect(sock.inbox.ofType('error').at(-1)).toMatchObject({ code: 'not_controlling' });

    await send({ type: 'v2_control', matchId: found.matchId, agentId: mine.id });
    expect(await sock.inbox.next('v2_control_ok', (m) => m.matchId === found.matchId)).toMatchObject({ agentId: mine.id });
    await send({ type: 'v2_steer', matchId: found.matchId, input: { kind: 'deliver' } });
    const marked = await sock.inbox.next('v2_frame', (m) => m.matchId === found.matchId && !!m.frame.steer);
    expect(marked.frame.agents.find((a) => a.id === mine.id)!.controlled).toBe(true);

    await send({ type: 'v2_control', matchId: found.matchId, agentId: null });
    expect(await sock.inbox.next('v2_control_ok', (m) => m.matchId === found.matchId && m.agentId === null)).toBeTruthy();

    const end = await sock.inbox.next('v2_end', (m) => m.matchId === found.matchId, 30_000);
    expect(end.matchId).toBe(found.matchId);
    const row = await deps.repos.v2Matches.get(found.matchId);
    expect(JSON.stringify(row?.log)).toContain('"controlled"');
  });
});
