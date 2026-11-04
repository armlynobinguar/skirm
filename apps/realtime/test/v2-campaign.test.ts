// Campaign missions over the hub: a mission is practice on its own map and difficulty (whatever the
// client asked), a locked mission or a crew over the mission's size is refused, and the result is
// recorded for the player when the match ends.
import { OfficialRepo } from '@skirm/db';
import { createGreedyBrain } from '@skirm/decision-engine/v2';
import { campaignMission } from '@skirm/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { parseClientMessage } from '../src/protocol';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };

async function player(hub: RealtimeHub, deps: TestDeps, handle: string) {
  const sock = new FakeSocket();
  const c = hub.connect(sock);
  await hub.message(c, JSON.stringify({ type: 'auth', devUser: handle }));
  const acc = (await deps.repos.accounts.byHandle(handle))!;
  const agents = await deps.repos.agents.listByOwner(acc.id);
  const send = (m: unknown) => hub.message(c, JSON.stringify(m));
  return { acc, agents, send, inbox: sock.inbox };
}

describe('v2 campaign missions', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('parses mission only with the bot as opponent', () => {
    const crew = [{ agentId: 'agt_x', tier: 'standard' }];
    expect(parseClientMessage(JSON.stringify({ type: 'v2_queue', crew, ranked: false, opponent: 'bot', mission: 'c1-m1' }))).toMatchObject({ ok: true, msg: { mission: 'c1-m1' } });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_queue', crew, ranked: false, mission: 'c1-m1' }))).toMatchObject({ ok: false });
    expect(parseClientMessage(JSON.stringify({ type: 'v2_queue', crew, ranked: false, opponent: 'bot', mission: 'c9-m9' }))).toMatchObject({ ok: false });
  });

  it('plays the first mission on its own board and records the result; a locked one is refused', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2, v2Brain: createGreedyBrain() });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    hub = new RealtimeHub(deps);
    const p = await player(hub, deps, 'cora');
    const one = [{ agentId: p.agents[0]!.id, tier: 'standard' }];

    await p.send({ type: 'v2_queue', crew: one, ranked: false, opponent: 'bot', mission: 'c1-m2' });
    expect(await p.inbox.next('error')).toMatchObject({ code: 'mission_locked' });

    const two = [...one, { agentId: p.agents[1]!.id, tier: 'standard' }];
    await p.send({ type: 'v2_queue', crew: two, ranked: false, opponent: 'bot', mission: 'c1-m1' });
    expect(await p.inbox.next('error')).toMatchObject({ code: 'invalid_crew' });

    const m = campaignMission('c1-m1')!;
    // The mission's map and difficulty win over the ones sent.
    await p.send({ type: 'v2_queue', crew: one, ranked: false, opponent: 'bot', mission: m.id, mapId: 'basalt-stair', difficulty: 'mega' });
    const found = await p.inbox.next('v2_found');
    expect(found).toMatchObject({ practice: true, mapId: m.mapId, difficulty: m.difficulty });
    await p.send({ type: 'v2_accept', matchId: found.matchId });
    await p.inbox.next('v2_lockin', (x) => x.matchId === found.matchId);
    await p.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    const end = await p.inbox.next('v2_end', (x) => x.matchId === found.matchId, 30_000);
    expect(end.result).not.toBeNull();

    const [row] = await deps.repos.campaign.progress(p.acc.id);
    expect(row).toMatchObject({ missionId: m.id, attempts: 1, lastMatchId: found.matchId });
    expect(!!row!.clearedAt).toBe(end.result!.winner === 'A');
  });
});
