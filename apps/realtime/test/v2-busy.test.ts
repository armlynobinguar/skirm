// One agent plays one match at a time: two searches cannot hold the same agent (an owner and a
// renter), and a pair whose crew lost an agent to a live match since it queued drops only that search.
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

describe('v2 matchmaking: an agent is in one search or match at a time', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
  });

  it('refuses a renter queueing an agent its owner is already searching with', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2 });
    hub = new RealtimeHub(deps);
    const owner = await player(hub, deps, 'own');
    const renter = await player(hub, deps, 'rent');
    const shared = owner.agents[0]!;
    const offer = (await deps.repos.rentals.setOffer(owner.acc.id, shared.id, '1000'))!;
    await deps.repos.rentals.record({ offerId: offer.id, renterId: renter.acc.id, priceYocto: '1000', feeYocto: '50', ownerProceedsYocto: '950', txHash: 'dev:1000:busy' });

    await owner.send({ type: 'v2_queue', crew: [{ agentId: shared.id, tier: 'standard' }], ranked: false, difficulty: 'easy' });
    expect(hub.v2.matchmaker.has(owner.acc.id)).toBe(true);
    await renter.send({ type: 'v2_queue', crew: [{ agentId: shared.id, tier: 'standard' }], ranked: false, difficulty: 'easy' });
    expect((await renter.inbox.next('error')).code).toBe('agent_busy');
    expect(hub.v2.matchmaker.has(renter.acc.id)).toBe(false);
    expect(owner.inbox.ofType('v2_found')).toHaveLength(0);
  });

  it('at pairing drops only the search whose agent went live elsewhere; the other keeps searching', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2 });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    const cara = await player(hub, deps, 'cara');
    const dan = await player(hub, deps, 'dan');
    const x = ana.agents[0]!;

    // Ana searches with x, then x goes live in a match another instance started.
    await ana.send({ type: 'v2_queue', crew: [{ agentId: x.id, tier: 'standard' }], ranked: false, difficulty: 'easy' });
    await deps.repos.v2Matches.create({ id: 'mat_elsewhere', mapId: 'copper-hollow', ranked: false, teamA: cara.acc.id, teamB: dan.acc.id, difficulty: 'easy', crews: { A: [{ id: x.id }], B: [] } as never });
    expect(await deps.repos.agents.busyAgents([x.id])).toEqual([x.id]);

    await ben.send({ type: 'v2_queue', crew: [{ agentId: ben.agents[0]!.id, tier: 'standard' }], ranked: false, difficulty: 'easy' });
    const err = await ana.inbox.next('error');
    expect(err.code).toBe('agent_busy');
    expect(hub.v2.matchmaker.has(ana.acc.id)).toBe(false);
    expect(hub.v2.isBusy(ana.acc.id)).toBe(false);
    // Ben was not voided: he is back in the queue and pairs with the next search.
    expect(ben.inbox.ofType('error')).toHaveLength(0);
    expect(hub.v2.matchmaker.has(ben.acc.id)).toBe(true);
    await cara.send({ type: 'v2_queue', crew: [{ agentId: cara.agents[0]!.id, tier: 'standard' }], ranked: false, difficulty: 'easy' });
    const found = await ben.inbox.next('v2_found');
    expect((await cara.inbox.next('v2_found')).matchId).toBe(found.matchId);
    expect(ana.inbox.ofType('v2_found')).toHaveLength(0);
  });
});
