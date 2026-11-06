// The new roles over the hub: ranked refuses a crew with a Medic, Engineer, Saboteur or Courier
// (DEFAULTS.roles.rankedNewRoles is off); casual and practice play them.
import { OfficialRepo } from '@skirm/db';
import { createGreedyBrain } from '@skirm/decision-engine/v2';
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
  return { sock, acc, agents, send, inbox: sock.inbox };
}

describe('new roles over the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('refuses a ranked search with a new role, with a clear reason; casual queues it', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2 });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    for (const role of ['Medic', 'Engineer', 'Saboteur', 'Courier'] as const) {
      await deps.repos.agents.update(ana.acc.id, ana.agents[0]!.id, { role });
      await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: true });
      const err = await ana.inbox.next('error');
      expect(err).toMatchObject({ code: 'role_unranked' });
      expect(err.message).toContain(`${role} is not in ranked yet`);
      expect(hub.v2.isBusy(ana.acc.id)).toBe(false);
    }
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: false });
    await ana.inbox.next('queue_status');
    expect(hub.v2.matchmaker.has(ana.acc.id)).toBe(true);
  });

  it('plays a practice match with a Saboteur and a Courier to the end', async () => {
    const deps = await makeDeps({ v2Timing: FAST_V2, v2Brain: createGreedyBrain() });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    hub = new RealtimeHub(deps);
    const p = await player(hub, deps, 'sab');
    await deps.repos.agents.update(p.acc.id, p.agents[0]!.id, { role: 'Saboteur' });
    await deps.repos.agents.update(p.acc.id, p.agents[1]!.id, { role: 'Courier' });
    const crew = [0, 1].map((i) => ({ agentId: p.agents[i]!.id, tier: 'standard' }));
    await p.send({ type: 'v2_queue', crew, ranked: false, opponent: 'bot' });
    const found = await p.inbox.next('v2_found');
    await p.send({ type: 'v2_accept', matchId: found.matchId });
    await p.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
    await p.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard', 'standard'] });
    const end = await p.inbox.next('v2_end', (m) => m.matchId === found.matchId, 30_000);
    expect(end.result).not.toBeNull();
    const row = (await deps.repos.v2Matches.get(found.matchId))!;
    expect(row.crews!.A.map((a) => a.role)).toEqual(['Saboteur', 'Courier']);
  });
});
