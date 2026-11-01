// Regression tests for defects found in review, on the v2 hub: what an unauthenticated socket may and
// may not do, unknown message types, the per-socket watch cap for matches on this instance, live
// rows no instance holds (crash) being voided with their holds released, and /health.
import { OfficialRepo } from '@skirm/db';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_MATCH_WATCHES, RealtimeHub } from '../src/hub';
import { createRealtimeServer, type RealtimeServer } from '../src/server';
import { v2HoldId } from '../src/v2/credits';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 60_000, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };

function socket(hub: RealtimeHub) {
  const s = new FakeSocket();
  const c = hub.connect(s);
  const send = (m: unknown) => hub.message(c, typeof m === 'string' ? m : JSON.stringify(m));
  const last = () => s.inbox.all.at(-1);
  return { s, c, send, last };
}

/** A live v2 row that no hub here runs. */
async function liveRow(deps: TestDeps, id: string, opts: { teamA?: string } = {}) {
  const a = opts.teamA ?? (await deps.repos.accounts.getOrCreate({ handle: 'far_a' }, deps.vault)).account.id;
  const b = await deps.repos.accounts.getOrCreate({ handle: 'far_b' }, deps.vault);
  return deps.repos.v2Matches.create({ id, mapId: 'copper-hollow', ranked: false, teamA: a, teamB: b.account.id, difficulty: 'easy' });
}

describe('review regressions', () => {
  let hub: RealtimeHub | undefined;
  let server: RealtimeServer | undefined;
  afterEach(async () => {
    await hub?.close();
    await server?.close();
    hub = undefined;
    server = undefined;
  });

  it('an unauthenticated socket cannot queue or act on a match, but may watch and replay', async () => {
    const deps = await makeDeps();
    hub = new RealtimeHub(deps);
    const anon = socket(hub);
    const crew = [{ agentId: 'agt_1', tier: 'standard' }];
    for (const m of [
      { type: 'v2_queue', crew, ranked: true },
      { type: 'v2_queue', crew, ranked: false, opponent: 'bot' },
      { type: 'v2_cancel_queue' },
      { type: 'v2_accept', matchId: 'mat_1' },
      { type: 'v2_decline', matchId: 'mat_1' },
      { type: 'v2_lock_in', matchId: 'mat_1', tiers: ['quiet'] },
    ]) {
      await anon.send(m);
      expect(anon.last()).toMatchObject({ type: 'error', code: 'unauthenticated' });
    }
    expect(hub.v2.matchmaker.size).toBe(0);
    // Spectating needs no sign-in: an unknown id is refused as not found, not as unauthenticated.
    await anon.send({ type: 'v2_watch', matchId: 'mat_nope' });
    expect(anon.last()).toMatchObject({ type: 'error', code: 'not_found' });
    await anon.send({ type: 'v2_replay', matchId: 'mat_nope' });
    expect(anon.last()).toMatchObject({ type: 'error', code: 'not_found' });
    await liveRow(deps, 'mat_live');
    await anon.send({ type: 'v2_watch', matchId: 'mat_live' });
    expect(anon.c.matches.size).toBe(1);
    expect(anon.s.inbox.ofType('error')).toHaveLength(8);
  });

  it('refuses a second sign-in on one socket and a dev sign-in without a user', async () => {
    const deps = await makeDeps();
    hub = new RealtimeHub(deps);
    const s = socket(hub);
    await s.send({ type: 'auth', token: 'jwt.x.y' });
    expect(s.last()).toMatchObject({ type: 'error', code: 'auth_failed' });
    expect(s.c.user).toBeUndefined();
    await s.send({ type: 'auth', devUser: 'alice' });
    expect(s.c.user?.handle).toBe('alice');
    await s.send({ type: 'auth', devUser: 'bob' });
    expect(s.last()).toMatchObject({ type: 'error', code: 'already_authenticated' });
    expect(s.c.user?.handle).toBe('alice');
  });

  it('answers an unknown message type with unknown_type and opens no channel', async () => {
    const deps = await makeDeps();
    hub = new RealtimeHub(deps);
    const s = socket(hub);
    await s.send({ type: 'auth', devUser: 'alice' });
    await s.send({ type: 'hello', matchId: 'mat_1' });
    expect(s.last()).toMatchObject({ type: 'error', code: 'unknown_type' });
    expect(deps.pubsub.activeChannels()).toEqual([]);
  });

  it('caps watches of matches on this instance per socket; a repeat watch takes no slot', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2 });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    hub = new RealtimeHub(deps);
    // Live matches this hub runs: each player waits in v2_found (nobody accepts in time).
    const ids: string[] = [];
    for (let i = 0; i <= MAX_MATCH_WATCHES; i++) {
      const p = socket(hub);
      await p.send({ type: 'auth', devUser: `p${i}` });
      const agent = (await deps.repos.agents.listByOwner(p.c.user!.accountId))[0]!;
      await p.send({ type: 'v2_queue', crew: [{ agentId: agent.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
      ids.push((await p.s.inbox.next('v2_found')).matchId);
    }
    expect(hub.v2.matches.size).toBe(MAX_MATCH_WATCHES + 1);
    const w = socket(hub);
    for (const id of ids) await w.send({ type: 'v2_watch', matchId: id });
    expect(w.s.inbox.ofType('error')).toEqual([expect.objectContaining({ code: 'too_many_subscriptions' })]);
    expect(w.c.matches.size).toBe(MAX_MATCH_WATCHES);
    await w.send({ type: 'v2_watch', matchId: ids[0] });
    expect(w.c.matches.size).toBe(MAX_MATCH_WATCHES);
    await w.send({ type: 'v2_unwatch', matchId: ids[0] });
    expect(w.c.matches.size).toBe(MAX_MATCH_WATCHES - 1);
    await hub.disconnect(w.c);
    expect(w.c.matches.size).toBe(0);
  });

  it('voids live rows no instance holds (crash) and releases their holds', async () => {
    const deps = await makeDeps();
    hub = new RealtimeHub(deps);
    const { account } = await deps.repos.accounts.getOrCreate({ handle: 'alice' }, deps.vault);
    await deps.repos.ledger.topUp({ accountId: account.id, credits: 500 });
    const before = await deps.repos.ledger.balance(account.id);
    await liveRow(deps, 'mat_orphan', { teamA: account.id });
    const holdId = v2HoldId('mat_orphan', 'A');
    expect((await deps.repos.ledger.hold({ accountId: account.id, runId: holdId, stepLimit: 30, agents: 1 })).ok).toBe(true);
    await deps.repos.ledger.chargeTurns(holdId, [{ agent: 0, reason: null }]);
    expect((await deps.repos.ledger.balance(account.id)).held).toBeGreaterThan(0);

    // Too young to be an orphan: it may still be running on an instance that is shutting down.
    expect(await hub.sweepOrphans()).toEqual([]);
    expect(await hub.sweepOrphans(0)).toEqual(['mat_orphan']);
    expect((await deps.repos.v2Matches.get('mat_orphan'))!).toMatchObject({ status: 'void', reason: 'aborted' });
    const after = await deps.repos.ledger.balance(account.id);
    expect(after.held).toBe(0);
    expect(after.balance + after.allowanceLeft).toBe(before.balance + before.allowanceLeft);
    expect(deps.registryJobs).toEqual([]);
    // Already void: a second sweep leaves it alone.
    expect(await hub.sweepOrphans(0)).toEqual([]);
  });

  it('/health counts sockets and the v2 matches this instance runs', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2 });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    server = createRealtimeServer(deps);
    const port = await server.listen(0, '127.0.0.1');
    const health = async () => (await fetch(`http://127.0.0.1:${port}/health`)).json();
    expect(await health()).toEqual({ ok: true, clients: 0, matches: 0 });
    const p = socket(server.hub);
    await p.send({ type: 'auth', devUser: 'judge' });
    const agent = (await deps.repos.agents.listByOwner(p.c.user!.accountId))[0]!;
    await p.send({ type: 'v2_queue', crew: [{ agentId: agent.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    await p.s.inbox.next('v2_found');
    expect(await health()).toEqual({ ok: true, clients: 1, matches: 1 });
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });
});
