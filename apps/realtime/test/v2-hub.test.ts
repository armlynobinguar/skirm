// v2 over the hub: two players queue, accept, lock in and play a whole match with the greedy brain;
// the result and Elo land in v2_matches, the credits settle, the debrief and registry job go out and
// the frames can be replayed. Casual searches pair by map and difficulty; crews change at lock-in.
import { seasonPoints } from '@skirm/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { FakeSocket, delay, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };

async function player(hub: RealtimeHub, deps: TestDeps, handle: string) {
  const sock = new FakeSocket();
  const c = hub.connect(sock);
  await hub.message(c, JSON.stringify({ type: 'auth', devUser: handle }));
  const acc = (await deps.repos.accounts.byHandle(handle))!;
  await deps.repos.ledger.topUp({ accountId: acc.id, credits: 2000 });
  const agents = await deps.repos.agents.listByOwner(acc.id);
  const send = (m: unknown) => hub.message(c, JSON.stringify(m));
  return { sock, c, acc, agents, send, inbox: sock.inbox };
}

describe('v2 matches over the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
  });

  it('queues, accepts, locks in, plays to a result and records Elo and credits', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2, v2PickMap: (f) => f.find((m) => m.id === 'copper-hollow') ?? f[0]! });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    await deps.repos.agents.update(ana.acc.id, ana.agents[0]!.id, { role: 'Hauler', vision: 4 });
    const before = (await deps.repos.ledger.balance(ana.acc.id)).available;

    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'open' }], ranked: true });
    await ben.send({ type: 'v2_queue', crew: [{ agentId: ben.agents[0]!.id, tier: 'quiet' }], ranked: true });
    const found = await ana.inbox.next('v2_found');
    expect(found.team).toBe('A');
    // Ranked: both players' tiers as they queued (new players are still placing).
    const placing = { tier: null, placementsPlayed: 0, placementMatches: 5, nextAt: null };
    expect(found.tiers).toEqual({ you: placing, rival: placing });
    await ben.inbox.next('v2_found');

    // Ana cannot queue again while matched.
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'open' }], ranked: true });
    expect((await ana.inbox.next('error')).code).toBe('in_match');

    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    await ben.send({ type: 'v2_accept', matchId: found.matchId });
    await ana.inbox.next('v2_lockin');
    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['open'] });
    await ben.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['quiet'] });
    const start = await ana.inbox.next('v2_start');
    expect(start.rival.handle).toBe('ben');

    const spectator = new FakeSocket();
    const sc = hub.connect(spectator);
    await hub.message(sc, JSON.stringify({ type: 'v2_watch', matchId: found.matchId }));

    const end = await ana.inbox.next('v2_end', () => true, 30_000);
    expect(end.result).not.toBeNull();
    expect(end.logHash).toMatch(/^[0-9a-f]{64}$/);
    expect(spectator.inbox.ofType('v2_frame').every((f) => f.frame.view === 'watch')).toBe(true);
    expect(spectator.inbox.ofType('v2_end')).toHaveLength(1);

    const row = (await deps.repos.v2Matches.get(found.matchId))!;
    expect(row).toMatchObject({ status: 'ended', ranked: true, logHash: end.logHash, winner: end.result!.winner });
    expect(row.crews!.A[0]).toMatchObject({ role: 'Hauler', vision: 4, tier: 'standard' });
    if (end.result!.winner !== 'draw') expect(row.eloDeltas).toHaveLength(2);
    const after = (await deps.repos.ledger.balance(ana.acc.id));
    expect(after.held).toBe(0);
    // Ranked plays Standard: 20 hundredths of a credit a tick, held as 30 and charged in whole credits.
    const used = Math.ceil((end.result!.ticks * 20) / 100);
    expect(before - after.available).toBe(used);

    // The debrief carries Ana's own numbers and the registry job is queued.
    const delta = row.eloDeltas!.find((d) => d.team === 'A')?.delta ?? null;
    expect(end.debrief).toMatchObject({ eloDelta: delta, registry: 'pending', difficulty: 'normal', credits: { held: 30, used, returned: 30 - used } });
    expect(end.debrief!.agents.map((a) => a.agentId)).toEqual([ana.agents[0]!.id]);
    // Against a player, a rival's mind never reaches the frames (only practice shows it).
    const rivals = ana.inbox.ofType('v2_frame').flatMap((f) => f.frame.agents.filter((a) => a.team !== 'A'));
    expect(rivals.some((a) => a.plan || a.planWhy || a.thought)).toBe(false);
    // The season points the stored result gave Ana arrive with v2_end too.
    const outcome = end.result!.winner === 'draw' ? 'draw' : end.result!.winner === 'A' ? 'win' : 'loss';
    expect(end.debrief!.season).toEqual({ number: 1, points: seasonPoints(outcome) });
    expect((await deps.repos.v2Matches.get(found.matchId))!.debriefs?.A?.season).toEqual(end.debrief!.season);
    expect(deps.registryJobs).toContainEqual({ kind: 'v2_match', id: found.matchId });
    // Rook runs the starter skill, which Ana did not write: her plan is withheld.
    const own = ana.inbox.ofType('v2_frame').flatMap((f) => f.frame.agents.filter((a) => a.team === 'A'));
    expect(own.every((a) => a.planHidden === true)).toBe(true);

    // Replay: Ana gets her own view; anyone else the whole board.
    await ana.send({ type: 'v2_replay', matchId: found.matchId });
    const mine = await ana.inbox.next('v2_frames');
    expect(mine.frames).toHaveLength(end.result!.ticks + 1);
    expect(mine.frames.every((f) => f.view === 'A')).toBe(true);
    await hub.message(sc, JSON.stringify({ type: 'v2_replay', matchId: found.matchId }));
    expect((await spectator.inbox.next('v2_frames')).frames.every((f) => f.view === 'watch')).toBe(true);
    await ana.send({ type: 'v2_replay', matchId: 'mat_unknown' });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'not_found' });
  });

  it('pairs casual searches only on the same map and difficulty, and plays that pick', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2 });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    const cy = await player(hub, deps, 'cy');
    const q = (p: Awaited<ReturnType<typeof player>>, difficulty: string, mapId = 'frostline-depot') =>
      p.send({ type: 'v2_queue', crew: [{ agentId: p.agents[1]!.id, tier: 'standard' }], ranked: false, mapId, difficulty });
    await q(ana, 'hard');
    await q(ben, 'easy');
    await q(cy, 'hard', 'nowhere');
    expect(await cy.inbox.next('error')).toMatchObject({ code: 'invalid_crew' });
    await delay(80);
    expect(ana.inbox.ofType('v2_found')).toHaveLength(0);
    await q(cy, 'hard');
    const found = await ana.inbox.next('v2_found');
    expect(found).toMatchObject({ mapId: 'frostline-depot', difficulty: 'hard', ranked: false });
    expect(found.tiers).toBeUndefined();
    expect((await cy.inbox.next('v2_found')).matchId).toBe(found.matchId);
    expect(ben.inbox.ofType('v2_found')).toHaveLength(0);
    // A search that takes any map pairs with a picked map at the same difficulty, and plays that map.
    const dee = await player(hub, deps, 'dee');
    await dee.send({ type: 'v2_queue', crew: [{ agentId: dee.agents[1]!.id, tier: 'standard' }], ranked: false, difficulty: 'easy' });
    expect(await ben.inbox.next('v2_found')).toMatchObject({ mapId: 'frostline-depot', difficulty: 'easy' });
  });

  it('changes the crew at lock-in: refuses agents that are not yours, then plays the new crew', async () => {
    const deps = await makeDeps({ v2Timing: { ...FAST_V2, lockMs: 2000 }, v2PickMap: (f) => f.find((m) => m.id === 'copper-hollow') ?? f[0]! });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[1]!.id, tier: 'standard' }], ranked: false });
    await ben.send({ type: 'v2_queue', crew: [{ agentId: ben.agents[1]!.id, tier: 'standard' }], ranked: false });
    const found = await ana.inbox.next('v2_found');
    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    await ben.send({ type: 'v2_accept', matchId: found.matchId });
    const lockin = await ben.inbox.next('v2_lockin');
    expect(lockin).toMatchObject({ rival: { agents: 1 }, headStartTicks: { A: 0, B: 0 } });

    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: [], crew: [{ agentId: ben.agents[0]!.id, tier: 'open' }] });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'invalid_crew' });
    const crew = [ana.agents[1]!, ana.agents[2]!].map((a) => ({ agentId: a.id, tier: 'open' }));
    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: [], crew });
    // Ana fields one more agent: her crew holds 5 ticks.
    expect(await ben.inbox.next('v2_lockin')).toMatchObject({ rival: { agents: 2 }, headStartTicks: { A: 5, B: 0 } });
    // A second change after the lock is refused out loud, not dropped.
    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: [], crew: crew.slice(0, 1) });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'not_in_lockin' });
    await ben.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['quiet'] });
    const start = await ana.inbox.next('v2_start');
    expect(start.holdTicks).toEqual({ A: 5, B: 0 });
    const end = await ana.inbox.next('v2_end', () => true, 30_000);
    expect(end.debrief!.agents.map((a) => a.agentId)).toEqual(crew.map((c) => c.agentId));
    const row = (await deps.repos.v2Matches.get(found.matchId))!;
    expect(row.crews!.A.map((a) => [a.id, a.tier])).toEqual(crew.map((c) => [c.agentId, 'open']));
    // Wren and Moss run no skill: the plan is not withheld (the greedy brain writes none).
    expect(ana.inbox.ofType('v2_frame').flatMap((f) => f.frame.agents).some((a) => a.planHidden)).toBe(false);
    expect(deps.registryJobs).toEqual([]);
  });

  it('voids a match nobody accepts and lets both players queue again', async () => {
    const deps = await makeDeps({ v2Timing: { ...FAST_V2, acceptMs: 30 } });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: false });
    await ben.send({ type: 'v2_queue', crew: [{ agentId: ben.agents[0]!.id, tier: 'standard' }], ranked: false });
    const found = await ana.inbox.next('v2_found');
    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    const end = await ben.inbox.next('v2_end');
    expect(end).toMatchObject({ result: null, reason: 'accept_timeout' });
    expect(await deps.repos.v2Matches.get(found.matchId)).toMatchObject({ status: 'void', fault: 'B' });
    await new Promise((r) => setTimeout(r, 20));
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: false });
    expect(ana.inbox.ofType('error')).toHaveLength(0);
  });

  it('refuses a crew with someone else’s agent', async () => {
    const deps = await makeDeps();
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ben.agents[0]!.id, tier: 'standard' }], ranked: false });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'invalid_crew' });
  });
});
