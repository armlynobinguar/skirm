// Private lobbies over the hub: both players ready a crew in the lobby, the match plays on the
// host's settings (talk rule and crew size enforced), unranked with credits held, and the lobby is
// settled at the end; a tournament final moves the bracket to its end.
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

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
type Player = Awaited<ReturnType<typeof player>>;

/** Accepts and locks in for both, then waits for the end. */
async function playThrough(a: Player, b: Player) {
  const found = await a.inbox.next('v2_found');
  await b.inbox.next('v2_found');
  await a.send({ type: 'v2_accept', matchId: found.matchId });
  await b.send({ type: 'v2_accept', matchId: found.matchId });
  await a.inbox.next('v2_lockin');
  await a.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard', 'standard'] });
  await b.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard', 'standard'] });
  const end = await a.inbox.next('v2_end', () => true, 30_000);
  return { found, end };
}

describe('private lobbies over the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
  });

  it('starts once both ready, on the lobby rules, unranked with credits, and opens again after', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2 });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    const lobby = await deps.repos.lobbies.create(ana.acc.id, { mapId: 'copper-hollow', difficulty: 'easy', talk: 'open', crewSize: 1 });

    // No guest yet; then too big a crew; then a stranger.
    await ana.send({ type: 'v2_lobby_ready', lobbyId: lobby.id, crew: [{ agentId: ana.agents[0]!.id, tier: 'quiet' }] });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'lobby_closed' });
    await deps.repos.lobbies.join(lobby.code, ben.acc.id);
    await ana.send({ type: 'v2_lobby_ready', lobbyId: lobby.id, crew: ana.agents.slice(0, 2).map((a) => ({ agentId: a.id, tier: 'quiet' })) });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'invalid_crew' });
    const cy = await player(hub, deps, 'cy');
    await cy.send({ type: 'v2_lobby_ready', lobbyId: lobby.id, crew: [{ agentId: cy.agents[0]!.id, tier: 'quiet' }] });
    expect(await cy.inbox.next('error')).toMatchObject({ code: 'not_found' });

    await ana.send({ type: 'v2_lobby_ready', lobbyId: lobby.id, crew: [{ agentId: ana.agents[0]!.id, tier: 'quiet' }] });
    expect(await ben.inbox.next('v2_lobby')).toMatchObject({ lobbyId: lobby.id, ready: { host: true, guest: false } });
    expect((await deps.repos.lobbies.get(lobby.id))!.hostReadyAt).not.toBeNull();
    // Readied in a lobby: no queueing elsewhere until stepping back.
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: false });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'already_queued' });

    const before = (await deps.repos.ledger.balance(ana.acc.id)).available;
    await ben.send({ type: 'v2_lobby_ready', lobbyId: lobby.id, crew: [{ agentId: ben.agents[0]!.id, tier: 'standard' }] });
    const found = await ana.inbox.next('v2_found');
    expect(found).toMatchObject({ team: 'A', mapId: 'copper-hollow', difficulty: 'easy', ranked: false });
    expect((await ben.inbox.next('v2_found')).team).toBe('B');
    expect(await deps.repos.lobbies.get(lobby.id)).toMatchObject({ status: 'playing', matchId: found.matchId });
    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    await ben.send({ type: 'v2_accept', matchId: found.matchId });
    const lockin = await ana.inbox.next('v2_lockin');
    expect(lockin.crewLimit).toBe(1);
    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await ben.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['quiet'] });
    const end = await ana.inbox.next('v2_end', () => true, 30_000);
    expect(end.result).not.toBeNull();
    // Unranked: no Elo, no registry job; Open talk for everyone (40 a tick) was held and charged.
    expect(end.debrief!.eloDelta).toBeNull();
    expect(deps.registryJobs).toHaveLength(0);
    const row = (await deps.repos.v2Matches.get(found.matchId))!;
    expect(row).toMatchObject({ ranked: false, status: 'ended', eloDeltas: [] });
    expect(row.crews!.A.map((a) => a.tier)).toEqual(['open']);
    expect(row.crews!.B.map((a) => a.tier)).toEqual(['open']);
    expect(end.debrief!.credits.held).toBe(60);
    expect(before - (await deps.repos.ledger.balance(ana.acc.id)).available).toBe(end.debrief!.credits.used);

    // Settled: a friend lobby is open again for a rematch, with the last winner.
    const after = (await deps.repos.lobbies.get(lobby.id))!;
    const winner = end.result!.winner === 'A' ? ana.acc.id : end.result!.winner === 'B' ? ben.acc.id : null;
    expect(after).toMatchObject({ status: 'open', matchId: found.matchId, winnerId: winner, hostReadyAt: null });
  });

  it('steps back with v2_cancel_queue and when the last socket closes', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2 });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    const lobby = await deps.repos.lobbies.join((await deps.repos.lobbies.create(ana.acc.id, { mapId: 'copper-hollow', difficulty: 'easy', talk: 'any', crewSize: 3 })).code, ben.acc.id);
    await ana.send({ type: 'v2_lobby_ready', lobbyId: lobby.id, crew: [{ agentId: ana.agents[0]!.id, tier: 'quiet' }] });
    await ana.send({ type: 'v2_cancel_queue' });
    expect(await ben.inbox.next('v2_lobby', (m) => !m.ready.host)).toMatchObject({ ready: { host: false, guest: false } });
    expect(hub.v2.isBusy(ana.acc.id)).toBe(false);
    await ana.send({ type: 'v2_lobby_ready', lobbyId: lobby.id, crew: [{ agentId: ana.agents[0]!.id, tier: 'quiet' }] });
    await hub.disconnect(ana.c);
    expect(hub.v2.isBusy(ana.acc.id)).toBe(false);
    await ben.send({ type: 'v2_lobby_ready', lobbyId: lobby.id, crew: [{ agentId: ben.agents[0]!.id, tier: 'quiet' }] });
    expect(ben.inbox.ofType('v2_found')).toHaveLength(0);
  });

  it('plays a tournament final to its end and pays the pool', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2 });
    hub = new RealtimeHub(deps);
    const p = [await player(hub, deps, 'ana'), await player(hub, deps, 'ben'), await player(hub, deps, 'cy'), await player(hub, deps, 'dee')];
    const t = await deps.repos.tournaments.create({ creatorId: p[0]!.acc.id, name: 'Cup', size: 4, mapId: 'copper-hollow', difficulty: 'easy', talk: 'standard', crewSize: 2, prizePool: 400, join: true });
    for (const x of p.slice(1)) await deps.repos.tournaments.join(t.id, x.acc.id);
    // Both semi-finals are decided without a match (nobody showed), so the final is made.
    for (const l of (await deps.repos.tournaments.detail(t.id))!.matches) await deps.repos.lobbies.forfeit(l.lobbyId);
    const final = (await deps.repos.tournaments.detail(t.id))!.matches.find((m) => m.round === 2)!;
    const host = p.find((x) => x.acc.id === final.hostId)!;
    const guest = p.find((x) => x.acc.id === final.guestId)!;
    for (const x of [host, guest]) await x.send({ type: 'v2_lobby_ready', lobbyId: final.lobbyId, crew: x.agents.slice(0, 2).map((a) => ({ agentId: a.id, tier: 'open' })) });
    const { end } = await playThrough(host, guest);
    const d = (await deps.repos.tournaments.detail(t.id))!;
    if (end.result && end.result.winner !== 'draw') expect(d.champion!.id).toBe(end.result.winner === 'A' ? host.acc.id : guest.acc.id);
    expect(d.status).toBe('done');
    expect(d.entries.reduce((n, e) => n + e.prize, 0)).toBe(400);
  });
});
