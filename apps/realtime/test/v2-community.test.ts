// Community maps over the hub: a published one plays in practice (and counts the play); a draft or
// an unknown id is "no such map"; ranked never names a map.
import { OfficialRepo } from '@skirm/db';
import { createGreedyBrain } from '@skirm/decision-engine/v2';
import { blankCommunityMap } from '@skirm/engine/v2';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };

async function player(hub: RealtimeHub, deps: TestDeps, handle: string) {
  const sock = new FakeSocket();
  const c = hub.connect(sock);
  await hub.message(c, JSON.stringify({ type: 'auth', devUser: handle }));
  const acc = (await deps.repos.accounts.byHandle(handle))!;
  const agents = await deps.repos.agents.listByOwner(acc.id);
  const send = (m: unknown) => hub.message(c, JSON.stringify(m));
  return { sock, acc, agents, send, inbox: sock.inbox };
}

describe('v2 community maps', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('plays practice on a published community map and counts the play', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2, v2Brain: createGreedyBrain() });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    hub = new RealtimeHub(deps);
    const p = await player(hub, deps, 'cm_rt');

    const draft = await deps.repos.communityMaps.create(p.acc.id, { name: 'Yard', theme: 'copper-hollow', map: blankCommunityMap(31, 13) });
    const crew = [{ agentId: p.agents[0]!.id, tier: 'standard' }];
    // A draft is not playable.
    await p.send({ type: 'v2_queue', crew, ranked: false, opponent: 'bot', mapId: draft.id });
    expect((await p.inbox.next('error')).code).toBe('invalid_crew');

    await deps.repos.communityMaps.publish(p.acc.id, draft.id, { name: 'Yard', map: { ...blankCommunityMap(31, 13), id: draft.id, name: 'Yard', code: 'CM-TEST' }, balance: null });
    await p.send({ type: 'v2_queue', crew, ranked: false, opponent: 'bot', mapId: draft.id });
    const found = await p.inbox.next('v2_found');
    expect(found.mapId).toBe(draft.id);
    await p.send({ type: 'v2_accept', matchId: found.matchId });
    await p.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
    await p.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    const end = await p.inbox.next('v2_end', (m) => m.matchId === found.matchId, 30_000);
    expect(end.matchId).toBe(found.matchId);
    expect((await deps.repos.v2Matches.get(found.matchId))?.mapId).toBe(draft.id);
    expect((await deps.repos.communityMaps.published(draft.id))!.plays).toBe(1);

    // Unknown community id.
    await p.send({ type: 'v2_queue', crew, ranked: false, opponent: 'bot', mapId: 'cmp_01HZY3M5K2Q8V7R6T4W9X0ABCD' });
    expect((await p.inbox.next('error')).code).toBe('invalid_crew');
  }, 60_000);
});
