// v2 spectating across instances: two hubs share one pub/sub and one database, as two realtime
// instances share Redis and Postgres. A watcher on either gets the whole board and v2_end, exactly
// once each; an ended or void match answers at once from its row; unknown ids are refused; the
// per-socket watch cap holds and every channel is let go.
import { OfficialRepo } from '@skirm/db';
import { createGreedyBrain } from '@skirm/decision-engine/v2';
import { v2MatchChannel, v2MatchLastKey, type V2ServerMessage } from '@skirm/server';
import type { V2Frame } from '@skirm/engine/v2';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_MATCH_WATCHES, RealtimeHub } from '../src/hub';
import type { MemoryPubSub } from '../src/pubsub';
import { relayV2Watch, v2EndOf } from '../src/v2/hub';
import { FakeSocket, delay, makeDeps, type TestDeps } from './helpers';

const RELAY_V2 = { acceptMs: 500, lockMs: 500, tickMs: 15, actionMs: 200, planMs: 200 };

/** Two instances: their own hubs over the same database and the same pub/sub. */
async function twoInstances() {
  const deps = await makeDeps({ v2Timing: RELAY_V2, v2Brain: createGreedyBrain() });
  await new OfficialRepo(deps.repos.db).ensureSystem();
  const one = new RealtimeHub(deps);
  const two = new RealtimeHub({ ...deps });
  return { deps, one, two, pubsub: deps.pubsub as MemoryPubSub };
}

async function spectator(hub: RealtimeHub) {
  const sock = new FakeSocket();
  const c = hub.connect(sock);
  const send = (m: unknown) => hub.message(c, JSON.stringify(m));
  return { sock, c, send, inbox: sock.inbox };
}

/** A live v2 row that no hub here runs (a match on some other instance). */
async function liveElsewhere(deps: TestDeps, id: string) {
  const a = await deps.repos.accounts.getOrCreate({ handle: 'far_a' }, deps.vault);
  const b = await deps.repos.accounts.getOrCreate({ handle: 'far_b' }, deps.vault);
  return deps.repos.v2Matches.create({ id, mapId: 'copper-hollow', ranked: false, teamA: a.account.id, teamB: b.account.id, difficulty: 'easy' });
}

const frameAt = (tick: number) => ({ view: 'watch', tick }) as unknown as V2Frame;
const ticksOf = (msgs: Extract<V2ServerMessage, { type: 'v2_frame' }>[]) => msgs.map((m) => m.frame.tick);

describe('v2 spectating across instances', () => {
  let hubs: RealtimeHub[] = [];
  afterEach(async () => {
    await Promise.all(hubs.map((h) => h.close()));
    hubs = [];
  });

  it('a watcher on another instance gets every frame and v2_end of a practice match, and no frame twice', async () => {
    const { deps, one, two, pubsub } = await twoInstances();
    hubs = [one, two];
    const sock = new FakeSocket();
    const pc = one.connect(sock);
    const send = (m: unknown) => one.message(pc, JSON.stringify(m));
    await send({ type: 'auth', devUser: 'judge' });
    const acc = (await deps.repos.accounts.byHandle('judge'))!;
    const agents = await deps.repos.agents.listByOwner(acc.id);
    await send({ type: 'v2_queue', crew: [{ agentId: agents[0]!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    const found = await sock.inbox.next('v2_found');
    const matchId = found.matchId;
    await send({ type: 'v2_accept', matchId });
    await sock.inbox.next('v2_lockin');
    await send({ type: 'v2_lock_in', matchId, tiers: ['standard'] });
    await sock.inbox.next('v2_start');

    const far = await spectator(two);
    const near = await spectator(one);
    await far.send({ type: 'v2_watch', matchId });
    await near.send({ type: 'v2_watch', matchId });
    // The remote watch holds a channel on instance two; the local one holds none.
    expect(far.c.matches.size).toBe(1);
    expect(pubsub.activeChannels()).toEqual([v2MatchChannel(matchId)]);

    const end = await sock.inbox.next('v2_end', (m) => m.matchId === matchId, 30_000);
    const farEnd = await far.inbox.next('v2_end', (m) => m.matchId === matchId, 5_000);
    const nearEnd = await near.inbox.next('v2_end', (m) => m.matchId === matchId, 5_000);
    expect(end.result).not.toBeNull();
    for (const e of [farEnd, nearEnd]) {
      expect(e).toEqual({ type: 'v2_end', matchId, result: end.result, reason: end.reason, logHash: end.logHash });
      expect(e.debrief).toBeUndefined();
    }

    for (const w of [far, near]) {
      const frames = w.inbox.ofType('v2_frame');
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every((f) => f.matchId === matchId && f.frame.view === 'watch')).toBe(true);
      const ticks = ticksOf(frames);
      // Strictly rising: no frame twice, none out of order.
      expect(ticks.every((t, i) => i === 0 || t > ticks[i - 1]!)).toBe(true);
      expect(ticks[ticks.length - 1]).toBe(end.result!.ticks);
      expect(w.inbox.ofType('v2_end')).toHaveLength(1);
      expect(w.c.matches.size).toBe(0);
    }
    // The local watcher saw every frame from where it joined.
    const nearTicks = ticksOf(near.inbox.ofType('v2_frame'));
    expect(nearTicks).toEqual(Array.from({ length: nearTicks.length }, (_, i) => nearTicks[0]! + i));
    // After v2_end the remote watch let go of its channel by itself.
    await delay(10);
    expect(pubsub.activeChannels()).toEqual([]);
    // Every watch message went out on the channel, ending with v2_end, which the last key holds.
    const published = pubsub.published.filter((p) => p.channel === v2MatchChannel(matchId)).map((p) => JSON.parse(p.payload) as V2ServerMessage);
    expect(published[published.length - 1]!.type).toBe('v2_end');
    expect(JSON.parse((await pubsub.get(v2MatchLastKey(matchId)))!)).toMatchObject({ type: 'v2_end', logHash: end.logHash });

    // Once over, a watcher on either instance gets v2_end at once from the row and takes no slot.
    for (const hub of [two, one]) {
      const late = await spectator(hub);
      await late.send({ type: 'v2_watch', matchId });
      expect(late.inbox.all).toEqual([{ type: 'v2_end', matchId, result: end.result, reason: end.reason, logHash: end.logHash }]);
      expect(late.c.matches.size).toBe(0);
    }
    expect(pubsub.activeChannels()).toEqual([]);
  });

  it('a void match answers with its reason and no result; an unknown id is refused', async () => {
    const { deps, one, two } = await twoInstances();
    hubs = [one, two];
    await liveElsewhere(deps, 'mat_void');
    await deps.repos.v2Matches.finish('mat_void', { winner: null, reason: 'declined' });
    const w = await spectator(two);
    await w.send({ type: 'v2_watch', matchId: 'mat_void' });
    expect(w.inbox.all).toEqual([{ type: 'v2_end', matchId: 'mat_void', result: null, reason: 'declined', logHash: null }]);
    await w.send({ type: 'v2_watch', matchId: 'mat_nope' });
    expect(await w.inbox.next('error')).toMatchObject({ code: 'not_found' });
    expect(w.c.matches.size).toBe(0);
  });

  it('a remote watcher reads the last frame first, then skips what it already has', async () => {
    const { deps, one, two, pubsub } = await twoInstances();
    hubs = [one, two];
    await liveElsewhere(deps, 'mat_far');
    const ch = v2MatchChannel('mat_far');
    const pub = (msg: object) => pubsub.publish(ch, JSON.stringify(msg));
    await pubsub.set(v2MatchLastKey('mat_far'), JSON.stringify({ type: 'v2_frame', matchId: 'mat_far', frame: frameAt(3) }), 120);
    const w = await spectator(two);
    await w.send({ type: 'v2_watch', matchId: 'mat_far' });
    expect(ticksOf(w.inbox.ofType('v2_frame'))).toEqual([3]);
    for (const t of [2, 3, 4]) await pub({ type: 'v2_frame', matchId: 'mat_far', frame: frameAt(t) });
    await pub({ type: 'nonsense' });
    await pub({ type: 'v2_end', matchId: 'mat_far', result: null, reason: 'aborted', logHash: null });
    await pub({ type: 'v2_frame', matchId: 'mat_far', frame: frameAt(5) });
    await delay(10);
    expect(ticksOf(w.inbox.ofType('v2_frame'))).toEqual([3, 4]);
    expect(w.inbox.ofType('v2_end')).toEqual([{ type: 'v2_end', matchId: 'mat_far', result: null, reason: 'aborted', logHash: null }]);
    expect(w.c.matches.size).toBe(0);
    expect(pubsub.activeChannels()).toEqual([]);
  });

  it('a watcher that subscribes after the last publish still gets v2_end from the last key', async () => {
    const { deps, one, two, pubsub } = await twoInstances();
    hubs = [one, two];
    await liveElsewhere(deps, 'mat_late');
    await pubsub.set(v2MatchLastKey('mat_late'), JSON.stringify({ type: 'v2_end', matchId: 'mat_late', result: null, reason: 'error', logHash: null }), 120);
    const w = await spectator(two);
    await w.send({ type: 'v2_watch', matchId: 'mat_late' });
    expect(w.inbox.all).toEqual([{ type: 'v2_end', matchId: 'mat_late', result: null, reason: 'error', logHash: null }]);
    await delay(10);
    expect(w.c.matches.size).toBe(0);
    expect(pubsub.activeChannels()).toEqual([]);
  });

  it('a remote watcher of a match whose instance died gets v2_end when the orphan sweep voids it', async () => {
    const { deps, one, two, pubsub } = await twoInstances();
    hubs = [one, two];
    await liveElsewhere(deps, 'mat_orphan');
    await pubsub.set(v2MatchLastKey('mat_orphan'), JSON.stringify({ type: 'v2_frame', matchId: 'mat_orphan', frame: frameAt(7) }), 120);
    const w = await spectator(two);
    await w.send({ type: 'v2_watch', matchId: 'mat_orphan' });
    expect(ticksOf(w.inbox.ofType('v2_frame'))).toEqual([7]);
    expect(w.c.matches.size).toBe(1);
    // Instance one sweeps it: neither hub runs it.
    expect(await one.v2.sweepOrphans(0)).toEqual(['mat_orphan']);
    const end = { type: 'v2_end', matchId: 'mat_orphan', result: null, reason: 'aborted', logHash: null };
    expect(await w.inbox.next('v2_end', undefined, 1_000)).toEqual(end);
    expect(JSON.parse((await pubsub.get(v2MatchLastKey('mat_orphan')))!)).toEqual(end);
    await delay(10);
    expect(w.c.matches.size).toBe(0);
    expect(pubsub.activeChannels()).toEqual([]);
  });

  it('the orphan sweep leaves a match with a fresh heartbeat alone, and voids it once the heartbeat is stale', async () => {
    const { deps, one, two } = await twoInstances();
    hubs = [one, two];
    await liveElsewhere(deps, 'mat_beating');
    // Another instance is still playing it: a heartbeat well after the sweep's clock.
    await deps.repos.v2Matches.heartbeat('mat_beating', new Date(Date.now() + 10 * 60_000));
    expect(await one.v2.sweepOrphans(0)).toEqual([]);
    expect((await deps.repos.v2Matches.get('mat_beating'))?.status).toBe('live');
    // That instance went quiet: its last heartbeat is now older than the staleness window.
    expect(await one.v2.sweepOrphans(0, -24 * 60 * 60_000)).toEqual(['mat_beating']);
    expect((await deps.repos.v2Matches.get('mat_beating'))?.status).toBe('void');
  });

  it('caps remote watches per socket and lets every channel go on disconnect', async () => {
    const { deps, one, two, pubsub } = await twoInstances();
    hubs = [one, two];
    const w = await spectator(two);
    for (let i = 0; i <= MAX_MATCH_WATCHES; i++) {
      await liveElsewhere(deps, `mat_cap_${i}`);
      await w.send({ type: 'v2_watch', matchId: `mat_cap_${i}` });
    }
    expect(w.inbox.ofType('error')).toEqual([expect.objectContaining({ code: 'too_many_subscriptions' })]);
    expect(w.c.matches.size).toBe(MAX_MATCH_WATCHES);
    expect(pubsub.activeChannels()).toHaveLength(MAX_MATCH_WATCHES);
    // A repeat watch takes no second slot.
    await w.send({ type: 'v2_watch', matchId: 'mat_cap_0' });
    expect(w.c.matches.size).toBe(MAX_MATCH_WATCHES);
    await w.send({ type: 'v2_unwatch', matchId: 'mat_cap_0' });
    expect(pubsub.activeChannels()).toHaveLength(MAX_MATCH_WATCHES - 1);
    await two.disconnect(w.c);
    expect(pubsub.activeChannels()).toEqual([]);
  });
});

describe('v2 relay messages', () => {
  it('passes frames and ends under the watched id, drops anything else', () => {
    expect(relayV2Watch('m1', JSON.stringify({ type: 'v2_frame', matchId: 'other', frame: frameAt(2) }))).toEqual({ type: 'v2_frame', matchId: 'm1', frame: frameAt(2) });
    expect(relayV2Watch('m1', JSON.stringify({ type: 'v2_end', matchId: 'm1', result: null, reason: 'aborted', logHash: null, debrief: { secret: 1 } }))).toEqual({ type: 'v2_end', matchId: 'm1', result: null, reason: 'aborted', logHash: null });
    for (const raw of ['nope', 'null', '{}', JSON.stringify({ type: 'v2_frame', frame: {} }), JSON.stringify({ type: 'v2_found', matchId: 'm1' }), JSON.stringify({ type: 'v2_end' })])
      expect(relayV2Watch('m1', raw)).toBeUndefined();
  });

  it('builds v2_end from an ended row', async () => {
    const deps = await makeDeps();
    await liveElsewhere(deps, 'mat_row');
    const row = await deps.repos.v2Matches.finish('mat_row', { winner: 'B', reason: 'goal', decidedBy: 'goal', score: { A: 1, B: 3 }, ticks: 42 });
    expect(v2EndOf(row)).toEqual({ type: 'v2_end', matchId: 'mat_row', result: { winner: 'B', reason: 'goal', decidedBy: 'goal', score: { A: 1, B: 3 }, ticks: 42 }, reason: 'goal', logHash: null });
  });
});
