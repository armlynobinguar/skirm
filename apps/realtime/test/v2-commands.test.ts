// Live commands: a crew's few directives during a match. Applied on the next tick, in force for
// DEFAULTS.commands.activeTicks in the targeted agents' brain context, written into the hash-chained
// log, shown in that crew's frames and debrief only, and refused when out of tokens, too soon, aimed
// at someone else's agent, or caught by the speech filter. Over the hub: v2_command → v2_command_ok.
import { OfficialRepo } from '@skirm/db';
import { createGreedyBrain, type V2AgentContext, type V2Brain } from '@skirm/decision-engine/v2';
import { MAPS_V2, verifyLog, type AgentSpec, type Team } from '@skirm/engine/v2';
import type { V2ServerMessage } from '@skirm/server';
import { DEFAULTS } from '@skirm/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps';
import { RealtimeHub } from '../src/hub';
import { realScheduler } from '../src/timing';
import { V2Match, type V2CommandResult, type V2Credits, type V2Setup } from '../src/v2/match';
import { FakeSocket, makeDeps } from './helpers';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({
  id,
  name: id.toUpperCase(),
  role,
  vision: 3,
  comms: 3,
  tier: 'standard',
});
const FAST = { acceptMs: 60, lockMs: 60, tickMs: 1, actionMs: 40, planMs: 40, replanEvery: 25 };
const SKILL = 'Seal the left tunnel with blocks before the pump starts flooding the lane.';

const credits: V2Credits = {
  hold: async () => ({ ok: true }),
  charge: async () => {},
  settle: async () => {},
  release: async () => {},
};

function setup(): V2Setup {
  return {
    matchId: 'mat_cmd',
    map,
    ranked: false,
    sides: {
      A: {
        accountId: 'acc_a',
        handle: 'ana',
        crew: [spec('wick', 'Builder'), spec('moss', 'Digger')],
        skills: [[SKILL], []],
      },
      B: {
        accountId: 'acc_b',
        handle: 'ben',
        crew: [spec('wren', 'Digger'), spec('kes', 'Runner')],
        skills: [[], []],
      },
    },
  };
}

/** Greedy moves, recording each agent's command context by the tick it acts on. */
function recorder() {
  const seen: { tick: number; id: string; command: V2AgentContext['command'] }[] = [];
  const greedy = createGreedyBrain();
  const brain: V2Brain = {
    kind: 'greedy',
    model: 'greedy',
    async act(o, ctx) {
      seen.push({ tick: o.tick, id: o.me.id, command: ctx.command ?? null });
      return greedy.act(o, ctx);
    },
    plan: (o, ctx) => greedy.plan(o, ctx),
  };
  return { brain, seen };
}

/** A match whose crew A player sends `onTick[tick]` when its frame for that tick arrives. */
function harness(onTick: Record<number, (m: V2Match) => V2CommandResult>) {
  const inbox: Record<Team | 'watch', V2ServerMessage[]> = { A: [], B: [], watch: [] };
  const results: Record<number, V2CommandResult> = {};
  const rec = recorder();
  const m: V2Match = new V2Match(setup(), {
    brains: { A: rec.brain, B: rec.brain },
    scheduler: realScheduler,
    timing: FAST,
    credits,
    send: (t, msg) => {
      inbox[t].push(msg);
      if (msg.type === 'v2_found') queueMicrotask(() => m.accept(t));
      if (msg.type === 'v2_lockin') queueMicrotask(() => m.lockIn(t, []));
      if (t === 'A' && msg.type === 'v2_frame' && onTick[msg.frame.tick])
        results[msg.frame.tick] = onTick[msg.frame.tick]!(m);
    },
    watch: (msg) => inbox.watch.push(msg),
    log: silentLogger,
  });
  return { m, inbox, results, seen: rec.seen };
}

const frames = (msgs: V2ServerMessage[]) =>
  msgs.flatMap((x) => (x.type === 'v2_frame' ? [x.frame] : []));

describe('v2 live commands', () => {
  it('applies a command on the next tick, for activeTicks, to the crew it names, logged and hidden from the rival', async () => {
    const h = harness({ 2: (m) => m.command('A', { preset: 'regroup', text: 'stay low' }) });
    const end = await h.m.play();
    expect(h.results[2]).toEqual({ ok: true, left: DEFAULTS.commands.perMatch - 1, tick: 3 });

    // The brain context: both crew A agents from tick 3 for activeTicks ticks, nobody in crew B.
    const active = DEFAULTS.commands.activeTicks;
    const ordered = h.seen.filter((x) => x.command);
    expect(new Set(ordered.map((x) => x.id))).toEqual(new Set(['wick', 'moss']));
    expect(Math.min(...ordered.map((x) => x.tick))).toBe(3);
    expect(Math.max(...ordered.map((x) => x.tick))).toBeLessThanOrEqual(3 + active - 1);
    const first = ordered.find((x) => x.tick === 3)!.command!;
    expect(first).toMatchObject({ preset: 'regroup', ticksLeft: active });
    expect(first.order).toContain('Regroup');
    expect(first.order).toContain('"stay low"');

    // The hash-chained log carries it on the tick it was applied, and the chain still checks.
    const logged = end.log!.ticks.filter((t) => t.commands);
    expect(logged).toEqual([
      expect.objectContaining({
        tick: 3,
        commands: [{ team: 'A', agents: ['wick', 'moss'], preset: 'regroup', text: 'stay low' }],
      }),
    ]);
    expect(verifyLog(end.log!)).toBeNull();

    // Crew A's frames show it; crew B's and the watch view never do.
    const last = frames(h.inbox.A).at(-1)!;
    expect(last.commands).toEqual({
      left: 2,
      log: [
        {
          tick: 3,
          until: 3 + active - 1,
          agents: ['wick', 'moss'],
          preset: 'regroup',
          text: 'stay low',
        },
      ],
    });
    expect(frames(h.inbox.B).every((f) => f.commands?.log.length === 0)).toBe(true);
    expect(frames(h.inbox.watch).every((f) => f.commands === undefined)).toBe(true);
    expect(JSON.stringify(h.inbox.B)).not.toContain('stay low');
    expect(JSON.stringify(h.inbox.watch)).not.toContain('stay low');
    // Not a delivered line: the public transcript (match_messages) never has it.
    expect(JSON.stringify(end.messages)).not.toContain('stay low');

    // The debrief: crew A's lists it with names, crew B's has none.
    const endA = h.inbox.A.find((x) => x.type === 'v2_end');
    const endB = h.inbox.B.find((x) => x.type === 'v2_end');
    expect(endA?.type === 'v2_end' && endA.debrief?.commands).toEqual([
      {
        tick: 3,
        agents: [
          { id: 'wick', name: 'WICK' },
          { id: 'moss', name: 'MOSS' },
        ],
        preset: 'regroup',
        text: 'stay low',
      },
    ]);
    expect(endB?.type === 'v2_end' && endB.debrief).not.toHaveProperty('commands');
  });

  it('refuses commands out of turn, at the rival, through the filter, too soon and past the limit', async () => {
    const cd = DEFAULTS.commands.cooldownTicks;
    const h = harness({
      2: (m) => {
        // A rival's agent, then abuse and a skill leak: refused, no token spent.
        expect(m.command('A', { agentId: 'wren', preset: 'hold_gate' })).toMatchObject({
          ok: false,
          code: 'invalid_command',
        });
        expect(m.command('A', { text: 'kill yourself' })).toMatchObject({
          ok: false,
          code: 'command_refused',
        });
        expect(
          m.command('A', { text: 'seal the left tunnel with blocks before the pump' }),
        ).toMatchObject({ ok: false, code: 'command_refused' });
        expect(m.command('A', { text: 'x'.repeat(DEFAULTS.commands.maxChars + 1) })).toMatchObject({
          ok: false,
          code: 'invalid_command',
        });
        expect(m.command('A', {})).toMatchObject({ ok: false, code: 'invalid_command' });
        const r = m.command('A', { agentId: 'moss', preset: 'go_drop' });
        // One on its way: the next waits.
        expect(m.command('A', { preset: 'regroup' })).toMatchObject({
          ok: false,
          code: 'rate_limited',
        });
        return r;
      },
      [2 + cd - 1]: (m) => m.command('A', { preset: 'regroup' }),
      [2 + cd]: (m) => m.command('A', { preset: 'regroup' }),
      [2 + 2 * cd]: (m) => m.command('A', { preset: 'block_flow' }),
      [2 + 3 * cd]: (m) => m.command('A', { preset: 'hold_gate' }),
    });
    expect(h.m.command('A', { preset: 'regroup' })).toMatchObject({ ok: false, code: 'not_live' });
    const end = await h.m.play();
    expect(end.result!.ticks).toBeGreaterThan(2 + 3 * cd);
    expect(h.results[2]).toEqual({ ok: true, left: 2, tick: 3 });
    expect(h.results[2 + cd - 1]).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(h.results[2 + cd]).toEqual({ ok: true, left: 1, tick: 3 + cd });
    expect(h.results[2 + 2 * cd]).toEqual({ ok: true, left: 0, tick: 3 + 2 * cd });
    expect(h.results[2 + 3 * cd]).toMatchObject({ ok: false, code: 'no_commands' });
    // One agent named: only moss carried the go_drop order, with the drop targets.
    const drop = h.seen.filter((x) => x.command?.preset === 'go_drop');
    expect(new Set(drop.map((x) => x.id))).toEqual(new Set(['moss']));
    expect(drop[0]!.command!.targets).toEqual(expect.any(Array));
    expect(end.log!.ticks.flatMap((t) => t.commands ?? []).map((c) => c.preset)).toEqual([
      'go_drop',
      'regroup',
      'block_flow',
    ]);
    expect(h.m.command('A', { preset: 'regroup' })).toMatchObject({ ok: false, code: 'not_live' });
  });
});

describe('v2_command over the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('answers v2_command_ok to the player in a live match, and refuses others', async () => {
    const deps = await makeDeps({
      v2Timing: { acceptMs: 500, lockMs: 500, tickMs: 25, actionMs: 200, planMs: 200 },
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

    // Not in any match yet.
    await send({ type: 'v2_command', matchId: 'mat_nope', preset: 'regroup' });
    expect(sock.inbox.ofType('error').at(-1)).toMatchObject({ code: 'not_found' });

    await send({
      type: 'v2_queue',
      crew: [{ agentId: agents[0]!.id, tier: 'standard' }],
      ranked: false,
      opponent: 'bot',
    });
    const found = await sock.inbox.next('v2_found');
    await send({ type: 'v2_accept', matchId: found.matchId });
    await sock.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
    await send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await sock.inbox.next('v2_frame', (m) => m.matchId === found.matchId);

    await send({ type: 'v2_command', matchId: found.matchId, preset: 'go_drop', text: 'quick' });
    const ok = await sock.inbox.next('v2_command_ok', (m) => m.matchId === found.matchId);
    expect(ok.left).toBe(DEFAULTS.commands.perMatch - 1);
    // Straight after: too soon.
    await send({ type: 'v2_command', matchId: found.matchId, preset: 'regroup' });
    expect(sock.inbox.ofType('error').at(-1)).toMatchObject({ code: 'rate_limited' });

    const end = await sock.inbox.next('v2_end', (m) => m.matchId === found.matchId, 30_000);
    expect(end.debrief?.commands).toEqual([
      expect.objectContaining({ tick: ok.tick, preset: 'go_drop', text: 'quick' }),
    ]);
    // Stored with the player's debrief, never in the public messages.
    const row = await deps.repos.v2Matches.get(found.matchId);
    expect(row?.debriefs?.A?.commands).toHaveLength(1);
    expect(row?.debriefs?.B).not.toHaveProperty('commands');
    expect(JSON.stringify(row?.log)).toContain('"go_drop"');
  });
});
