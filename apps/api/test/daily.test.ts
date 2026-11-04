// /daily*: the daily challenge (attempts are played by the worker; here they stay queued, and the
// board is filled by finishing rows through the repo as the worker would).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dailyChallenge } from '@skirm/engine/v2';
import { setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let alice: UserClient;
let bob: UserClient;
let cara: UserClient;

const TODAY = '2026-11-03';

beforeAll(async () => {
  h = await setup({ config: { DAILY_ATTEMPTS: 2 }, now: `${TODAY}T08:00:00Z` });
  h.deps.now = () => new Date(h.clock.now);
  alice = await h.as('daily-alice');
  bob = await h.as('daily-bob');
  cara = await h.as('daily-cara');
});
afterAll(() => h.close());

async function finish(id: string, points: number, ticks: number) {
  await h.repos.daily.claim(id);
  return h.repos.daily.finish(id, { status: 'done', brain: 'greedy', points, outcome: points >= 10_000 ? 'win' : 'loss', ticks, logHash: `hash-${id}`, result: {} });
}

describe('daily', () => {
  it("GET /daily: today's challenge from the date, free on greedy, attempts and time left", async () => {
    const res = await alice.get('/daily');
    expect(res.status).toBe(200);
    const c = dailyChallenge(TODAY);
    expect(res.body.challenge).toMatchObject({ date: TODAY, seed: c.seed, mapId: c.mapId, difficulty: c.difficulty, twist: c.twist, crewSize: c.crewSize });
    expect(res.body.challenge.mapName).toEqual(expect.any(String));
    expect(res.body).toMatchObject({ brain: 'greedy', free: true, costCredits: 0, attempts: { perDay: 2, used: 0, left: 2 }, mine: [] });
    expect(res.body.msLeft).toBe(16 * 3_600_000);
    expect(res.body.endsAt).toBe('2026-11-04T00:00:00.000Z');
  });

  it('queues an attempt with the default crew, snapshotted without prompt text', async () => {
    const res = await alice.post('/daily/attempts', {});
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ date: TODAY, status: 'queued', points: null, logHash: null });
    expect(res.body.crew).toHaveLength(dailyChallenge(TODAY).crewSize);
    expect(h.benchmarks.jobs).toContainEqual({ kind: 'daily', attemptId: res.body.id });
    const row = await h.repos.daily.get(res.body.id);
    expect(row).toMatchObject({ seed: dailyChallenge(TODAY).seed, mapId: dailyChallenge(TODAY).mapId });
    expect(JSON.stringify(row)).not.toContain('SECRET');
  });

  it('caps attempts per day; failed attempts give theirs back; the next day starts afresh', async () => {
    const second = await alice.post('/daily/attempts', {});
    expect(second.status).toBe(202);
    const third = await alice.post('/daily/attempts', {});
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('daily_limit');

    // A run that never played does not count.
    await h.repos.daily.finish(second.body.id, { status: 'failed', error: 'boom' });
    expect((await alice.get('/daily')).body.attempts).toMatchObject({ used: 1, left: 1 });
    expect((await alice.post('/daily/attempts', {})).status).toBe(202);
    expect((await alice.post('/daily/attempts', {})).status).toBe(429);

    const mine = (await alice.get('/daily')).body.mine as { status: string }[];
    expect(mine.map((m) => m.status)).toEqual(['queued', 'failed', 'queued']);
  });

  it('refuses a crew that is not yours or too big', async () => {
    const theirs = (await bob.get('/agents')).body as { id: string }[];
    const r1 = await cara.post('/daily/attempts', { agentIds: [theirs[0]!.id] });
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe('invalid_crew');
    const own = (await cara.get('/agents')).body as { id: string }[];
    const r2 = await cara.post('/daily/attempts', { agentIds: [own[0]!.id, own[0]!.id] });
    expect(r2.status).toBe(400);
    const size = dailyChallenge(TODAY).crewSize;
    if (size < 3) {
      const r3 = await cara.post('/daily/attempts', { agentIds: own.slice(0, size + 1).map((a) => a.id) });
      expect(r3.status).toBe(400);
    }
    const ok = await cara.post('/daily/attempts', { agentIds: [own[0]!.id] });
    expect(ok.status).toBe(202);
    expect(ok.body.crew).toHaveLength(1);
  });

  it("the board: each player's best attempt, ties to fewer ticks then first to finish, and your rank", async () => {
    const [a1, , a3] = (await h.repos.daily.listOn(alice.accountId, TODAY)).reverse();
    await finish(a1!.id, 10_150, 90);
    await finish(a3!.id, 10_300, 100); // Alice's best
    const b1 = (await bob.post('/daily/attempts', {})).body.id;
    const b2 = (await bob.post('/daily/attempts', {})).body.id;
    await finish(b1, 10_300, 100); // ties Alice's best exactly, finished later
    await finish(b2, 4_900, 150);
    const c1 = (await h.repos.daily.listOn(cara.accountId, TODAY))[0]!.id;
    await finish(c1, 10_300, 80); // same points, fewer ticks: ahead of both

    const res = await bob.get('/daily/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.players).toBe(3);
    expect(res.body.top.map((r: { handle: string; points: number; rank: number }) => [r.rank, r.handle, r.points])).toEqual([
      [1, 'daily-cara', 10_300],
      [2, 'daily-alice', 10_300],
      [3, 'daily-bob', 10_300],
    ]);
    expect(res.body.top[0]).toMatchObject({ ticks: 80, logHash: `hash-${c1}`, you: false });
    expect(res.body.top[0].crew[0]).toEqual({ name: expect.any(String), role: expect.any(String), skills: expect.any(Array) });
    expect(res.body.me).toMatchObject({ rank: 3, handle: 'daily-bob', you: true, attemptId: b1 });

    const small = await bob.get('/daily/leaderboard?limit=1');
    expect(small.body.top).toHaveLength(1);
    expect(small.body.me.rank).toBe(3);
  });

  it('reads past days and refuses future or malformed ones', async () => {
    const past = await alice.get('/daily/leaderboard?date=2026-11-01');
    expect(past.status).toBe(200);
    expect(past.body).toMatchObject({ date: '2026-11-01', players: 0, top: [], me: null });
    expect(past.body.challenge.seed).toBe(dailyChallenge('2026-11-01').seed);
    expect((await alice.get('/daily/leaderboard?date=2026-11-04')).status).toBe(400);
    expect((await alice.get('/daily/leaderboard?date=2026-02-30')).status).toBe(400);
  });

  it('a new UTC day is a new challenge with fresh attempts', async () => {
    h.clock.now = Date.parse('2026-11-04T00:00:01Z');
    try {
      const res = await alice.get('/daily');
      expect(res.body.challenge.date).toBe('2026-11-04');
      expect(res.body.attempts).toMatchObject({ used: 0, left: 2 });
      expect(res.body.mine).toEqual([]);
    } finally {
      h.clock.now = Date.parse(`${TODAY}T08:00:00Z`);
    }
  });

  it("the account export carries the caller's attempts", async () => {
    const res = await bob.get('/me/export');
    expect(res.status).toBe(200);
    expect(res.body.dailyAttempts).toHaveLength(2);
    expect(res.body.dailyAttempts[0]).toMatchObject({ accountId: bob.accountId, date: TODAY });
  });

  it('needs a session', async () => {
    expect((await h.http().get('/daily')).status).toBe(401);
    expect((await h.http().post('/daily/attempts').send({})).status).toBe(401);
  });
});
