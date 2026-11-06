// A result is announced only once it is stored: a failed write is retried, and a write that never
// lands ends the match void on v2_end instead of showing a win the orphan sweep later voids.
import { OfficialRepo } from '@skirm/db';
import { createGreedyBrain } from '@skirm/decision-engine/v2';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };

async function setupHub(failures: number) {
  const errors: string[] = [];
  const deps: TestDeps = await makeDeps({ v2Timing: FAST_V2, v2Brain: createGreedyBrain(), log: { info() {}, warn() {}, error: (m) => errors.push(m) } });
  await new OfficialRepo(deps.repos.db).ensureSystem();
  const repo = deps.repos.v2Matches;
  const real = repo.finish.bind(repo);
  let calls = 0;
  // Only the result write fails (a void from setup still goes through).
  repo.finish = async (id, input) => {
    if (input.winner !== null || input.score) {
      calls++;
      if (calls <= failures) throw new Error('connection terminated');
    }
    return real(id, input);
  };
  const hub = new RealtimeHub(deps);
  const sock = new FakeSocket();
  const c = hub.connect(sock);
  await hub.message(c, JSON.stringify({ type: 'auth', devUser: 'ana' }));
  const acc = (await deps.repos.accounts.byHandle('ana'))!;
  const agents = await deps.repos.agents.listByOwner(acc.id);
  const send = (m: unknown) => hub.message(c, JSON.stringify(m));
  const play = async () => {
    await send({ type: 'v2_queue', crew: [{ agentId: agents[0]!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    const found = await sock.inbox.next('v2_found');
    await send({ type: 'v2_accept', matchId: found.matchId });
    await sock.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
    await send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    const end = await sock.inbox.next('v2_end', (m) => m.matchId === found.matchId, 30_000);
    return { found, end };
  };
  return { hub, deps, errors, play, calls: () => calls };
}

describe('v2 match result: stored before it is announced', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('retries a failed result write and announces the result once it is stored', async () => {
    const h = await setupHub(2);
    hub = h.hub;
    const { found, end } = await h.play();
    expect(h.calls()).toBe(3);
    expect(end.result).not.toBeNull();
    expect(end.logHash).toMatch(/^[0-9a-f]{64}$/);
    const row = (await h.deps.repos.v2Matches.get(found.matchId))!;
    expect(row.status).toBe('ended');
    expect(h.errors.filter((e) => e.includes('record failed'))).toHaveLength(2);
  });

  it('ends the match void on v2_end when the result can never be stored', async () => {
    const h = await setupHub(99);
    hub = h.hub;
    const { found, end } = await h.play();
    expect(h.calls()).toBe(3);
    expect(end).toMatchObject({ result: null, reason: 'error', logHash: null });
    expect(end.debrief).toMatchObject({ eloDelta: null, registry: null });
    expect((await h.deps.repos.v2Matches.get(found.matchId))!.status).not.toBe('ended');
    expect(h.errors.some((e) => e.includes('result not stored'))).toBe(true);
  });
});
