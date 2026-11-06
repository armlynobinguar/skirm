// Bring your own agent in realtime: the external brain asks the program each tick (signed webhook or
// the pull relay) and falls back to greedy on a timeout, an error or an illegal answer; the hub gives
// a bound agent its external brain in practice and casual, refuses it in ranked, and a socket signed
// in with an agent token can only queue casual or practice with that agent.
import { OfficialRepo } from '@skirm/db';
import { greedyAct } from '@skirm/decision-engine/v2';
import { DEFAULT_PRACTICE, MAPS_V2, botCrew, createMatch, observe } from '@skirm/engine/v2';
import {
  ExternalHttpError,
  MemoryExternalTurnStore,
  externalAgentToken,
  newExternalSecret,
  verifyExternalSignature,
  type ExternalTurn,
} from '@skirm/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { Logger } from '../src/deps';
import { RealtimeHub } from '../src/hub';
import { realScheduler } from '../src/timing';
import { ExternalBrain, type WebhookPost } from '../src/v2/external';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };

function recordingLog() {
  const warns: string[] = [];
  const log: Logger = { info: () => undefined, warn: (m) => void warns.push(m), error: () => undefined };
  return { log, warns };
}

/** A fresh observation on the default practice board. */
function anObservation() {
  const map = MAPS_V2.find((m) => m.id === DEFAULT_PRACTICE.mapId)!;
  const s = createMatch(map, { A: botCrew(1, 'a'), B: botCrew(1, 'b') });
  return observe(s, 'a-1');
}

const ctx = { skills: ['SECRET STRATEGY: always hold the north gate'], plan: 'Fetch the nearest crate.', canSpeak: true, recent: [], command: null };

describe('ExternalBrain', () => {
  const brain = (over: Partial<ConstructorParameters<typeof ExternalBrain>[0]> = {}) => {
    const { log, warns } = recordingLog();
    const secret = newExternalSecret();
    const b = new ExternalBrain({ agent: { id: 'ext_x', webhookUrl: 'https://agent.example.com/hook' }, secret, matchId: 'mat_1', timeoutMs: 80, scheduler: realScheduler, log, ...over });
    return { b, warns, secret };
  };

  it('POSTs the signed turn to the webhook and plays its legal answer and line', async () => {
    const o = anObservation();
    const move = o.legal.find((a) => a.type === 'move')!;
    let seen: { body: string; headers: Record<string, string>; opts: { timeoutMs: number; maxBytes: number } } | undefined;
    const post: WebhookPost = async (_url, body, headers, opts) => {
      seen = { body, headers, opts };
      return JSON.stringify({ action: move, say: { channel: 'team', text: 'heading out' }, thought: 'crate to the east' });
    };
    const { b, secret } = brain({ post });
    const d = await b.act(o, ctx);
    expect(d).toMatchObject({ action: move, reason: 'chosen', say: { channel: 'team', text: 'heading out' }, thought: 'crate to the east' });
    expect(verifyExternalSignature(secret, seen!.headers['x-skirm-signature'], seen!.body)).toBe(true);
    expect(seen!.headers['x-skirm-agent']).toBe('ext_x');
    expect(seen!.opts).toEqual({ timeoutMs: 80, maxBytes: 16_384 });
    const turn = JSON.parse(seen!.body) as ExternalTurn;
    expect(turn).toMatchObject({ contract: 'skirm.agent/v1', type: 'turn', matchId: 'mat_1', tick: o.tick, agentId: 'a-1', deadlineMs: 80, context: { canSpeak: true, plan: 'Fetch the nearest crate.' } });
    expect(turn.observation.legal).toEqual(o.legal);
    // Skill text never leaves the vault.
    expect(seen!.body).not.toContain('SECRET STRATEGY');
    expect(b.usage).toMatchObject({ calls: 1, misses: 0, seen: true });
  });

  it('falls back to the greedy brain when the webhook misses the deadline, and logs the miss', async () => {
    const o = anObservation();
    const { b, warns } = brain({ post: () => new Promise<string>(() => undefined) });
    const started = Date.now();
    const d = await b.act(o, ctx);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(d.action).toEqual(greedyAct(o));
    expect(d.reason).toBe('chosen');
    expect(b.usage).toMatchObject({ calls: 1, misses: 1, lastError: 'timeout', seen: false });
    expect(warns[0]).toMatch(/external agent ext_x missed tick \d+ \(timeout\); greedy played it/);
  });

  it('falls back on an illegal answer, a broken reply and a refused address', async () => {
    const o = anObservation();
    const illegal = brain({ post: async () => JSON.stringify({ action: { type: 'move', dir: 'X' } }) });
    expect((await illegal.b.act(o, ctx)).action).toEqual(greedyAct(o));
    expect(illegal.b.usage.lastError).toMatch(/^invalid: /);
    const junk = brain({ post: async () => 'not json' });
    await junk.b.act(o, ctx);
    expect(junk.b.usage).toMatchObject({ misses: 1, lastError: 'invalid: reply must be a JSON object' });
    const blocked = brain({
      post: async () => {
        throw new ExternalHttpError('blocked_address', 'private');
      },
    });
    await blocked.b.act(o, ctx);
    expect(blocked.b.usage.lastError).toBe('error: blocked_address');
  });

  it('puts lines through the leak filter and hides the plan when the crew runs a bought skill', async () => {
    const o = anObservation();
    let body = '';
    const leak = brain({
      hidePlan: true,
      post: async (_u, b) => {
        body = b;
        return JSON.stringify({ action: { type: 'wait' }, say: { channel: 'say', text: 'SECRET STRATEGY: always hold the north gate' } });
      },
    });
    const d = await leak.b.act(o, ctx);
    expect(d.say).toBeNull();
    expect(d.refusedSay).toBe('leak');
    expect((JSON.parse(body) as ExternalTurn).context.plan).toBeNull();
  });

  it('pull mode: publishes the turn on the relay and plays the answer submitted to it', async () => {
    const o = anObservation();
    const turns = new MemoryExternalTurnStore();
    const { b } = brain({ agent: { id: 'ext_p', webhookUrl: null }, turns, timeoutMs: 400, pollMs: 5 });
    const move = o.legal.find((a) => a.type === 'move')!;
    const answer = (async () => {
      for (;;) {
        const t = await turns.current('ext_p');
        if (t) return turns.submit('ext_p', t.turnId, { action: move }, 1000);
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    const d = await b.act(o, ctx);
    expect(await answer).toBe('ok');
    expect(d.action).toEqual(move);
    expect(b.usage).toMatchObject({ calls: 1, misses: 0 });
    // Nobody answers the next tick's turn: greedy plays it.
    const o2 = { ...o, tick: o.tick + 1 };
    const d2 = await b.act(o2, ctx);
    expect(d2.action).toEqual(greedyAct(o2));
    expect(b.usage).toMatchObject({ calls: 2, misses: 1, lastError: 'timeout' });
  });
});

describe('external agents in the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  async function setup(over: Partial<TestDeps> = {}) {
    const deps = await makeDeps({ v2Timing: FAST_V2, ...over });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    hub = new RealtimeHub(deps);
    const sock = new FakeSocket();
    const c = hub.connect(sock);
    await hub.message(c, JSON.stringify({ type: 'auth', devUser: 'byo' }));
    const acc = (await deps.repos.accounts.byHandle('byo'))!;
    const agents = await deps.repos.agents.listByOwner(acc.id);
    const secret = newExternalSecret();
    const ext = await deps.repos.externalAgents.create(acc.id, { name: 'my bot', agentId: agents[0]!.id, webhookUrl: over.externalPost ? 'https://agent.example.com/hook' : null }, await deps.vault.encryptSkill(secret));
    const send = (m: unknown) => hub!.message(c, JSON.stringify(m));
    return { deps, sock, acc, agents, ext, secret, send };
  }

  async function playPractice(p: Awaited<ReturnType<typeof setup>>) {
    await p.send({ type: 'v2_queue', crew: [{ agentId: p.agents[0]!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    const found = await p.sock.inbox.next('v2_found');
    await p.send({ type: 'v2_accept', matchId: found.matchId });
    await p.sock.inbox.next('v2_lockin');
    await p.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    return { found, end: await p.sock.inbox.next('v2_end', () => true, 60_000) };
  }

  it('a webhook agent plays a practice match: signed turns each tick, usage counted, crew flagged', async () => {
    let secret = '';
    let calls = 0;
    const externalPost: WebhookPost = async (_url, body, headers) => {
      calls++;
      if (!verifyExternalSignature(secret, headers['x-skirm-signature'], body)) throw new Error('bad signature');
      const t = JSON.parse(body) as ExternalTurn;
      return JSON.stringify({ action: greedyAct(t.observation) });
    };
    const p = await setup({ externalPost });
    secret = p.secret;
    const { found, end } = await playPractice(p);
    expect(end.result).not.toBeNull();
    expect(calls).toBeGreaterThan(0);
    const row = await p.deps.repos.externalAgents.get(p.ext.id);
    expect(row).toMatchObject({ calls, misses: 0 });
    expect(row!.lastSeenAt).not.toBeNull();
    const m = await p.deps.repos.v2Matches.get(found.matchId);
    expect(m!.crews!.A[0]).toMatchObject({ id: p.agents[0]!.id, external: true });
  });

  it('a pull agent that never answers still finishes the match on greedy, every tick a miss', async () => {
    const turns = new MemoryExternalTurnStore();
    const p = await setup({ externalTurns: turns });
    const { end } = await playPractice(p);
    expect(end.result).not.toBeNull();
    const row = await p.deps.repos.externalAgents.get(p.ext.id);
    expect(row!.calls).toBeGreaterThan(0);
    expect(row!.misses).toBe(row!.calls);
    expect(row!.lastError).toBe('timeout');
  });

  it('refuses a ranked search with an agent an external agent plays', async () => {
    const p = await setup();
    await p.send({ type: 'v2_queue', crew: [{ agentId: p.agents[0]!.id, tier: 'standard' }], ranked: true });
    expect(await p.sock.inbox.next('error')).toMatchObject({ code: 'external_unranked' });
    // Its other agents still play ranked.
    await p.send({ type: 'v2_queue', crew: [{ agentId: p.agents[1]!.id, tier: 'standard' }], ranked: true });
    await p.sock.inbox.next('queue_status');
  });

  it('an agent token signs in as the player, for casual and practice with its agent only', async () => {
    const p = await setup();
    const sock = new FakeSocket();
    const c = hub!.connect(sock);
    const send = (m: unknown) => hub!.message(c, JSON.stringify(m));
    await send({ type: 'auth', agentToken: externalAgentToken(p.ext.id, newExternalSecret()) });
    expect(await sock.inbox.next('error')).toMatchObject({ code: 'auth_failed' });
    await send({ type: 'auth', agentToken: externalAgentToken(p.ext.id, p.secret) });
    await send({ type: 'v2_queue', crew: [{ agentId: p.agents[0]!.id, tier: 'standard' }], ranked: true });
    expect(await sock.inbox.next('error')).toMatchObject({ code: 'external_unranked' });
    await send({ type: 'v2_queue', crew: [{ agentId: p.agents[1]!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    expect(await sock.inbox.next('error')).toMatchObject({ code: 'invalid_crew' });
    await send({ type: 'v2_queue', crew: [{ agentId: p.agents[0]!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    const found = await sock.inbox.next('v2_found');
    expect(found.practice).toBe(true);
    await send({ type: 'v2_decline', matchId: found.matchId });
    await sock.inbox.next('v2_end');
  });

  it('an agent token neither sees nor acts on the owner’s matches its agent does not play', async () => {
    const p = await setup();
    const sock = new FakeSocket();
    const c = hub!.connect(sock);
    const send = (m: unknown) => hub!.message(c, JSON.stringify(m));
    await send({ type: 'auth', agentToken: externalAgentToken(p.ext.id, p.secret) });

    // The owner plays practice from the browser with an agent the external agent does not play.
    await p.send({ type: 'v2_queue', crew: [{ agentId: p.agents[1]!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    const found = await p.sock.inbox.next('v2_found');
    await send({ type: 'v2_accept', matchId: found.matchId });
    expect(await sock.inbox.next('error')).toMatchObject({ code: 'not_found' });
    await send({ type: 'v2_decline', matchId: found.matchId });
    expect(await sock.inbox.next('error')).toMatchObject({ code: 'not_found' });
    await send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    expect(await sock.inbox.next('error')).toMatchObject({ code: 'not_found' });
    for (const m of [
      { type: 'v2_command', matchId: found.matchId, preset: 'regroup' },
      { type: 'v2_control', matchId: found.matchId, agentId: p.agents[1]!.id },
      { type: 'v2_lobby_ready', lobbyId: 'lob_x', crew: [{ agentId: p.agents[0]!.id, tier: 'standard' }] },
    ]) {
      await send(m);
      expect(await sock.inbox.next('error')).toMatchObject({ code: 'forbidden' });
    }
    await send({ type: 'v2_cancel_queue' });
    expect(await sock.inbox.next('error')).toMatchObject({ code: 'not_queued' });

    // The owner plays it through; the agent socket hears nothing of it.
    await p.send({ type: 'v2_accept', matchId: found.matchId });
    await p.sock.inbox.next('v2_lockin');
    await p.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await p.sock.inbox.next('v2_end', () => true, 60_000);
    const leaked = sock.inbox.ofType('v2_found').length + sock.inbox.ofType('v2_lockin').length + sock.inbox.ofType('v2_frame').length + sock.inbox.ofType('v2_end').length;
    expect(leaked).toBe(0);
  });
});
