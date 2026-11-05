// /puzzles: the puzzle list with par, medals and the caller's best, a puzzle's board, queuing a run
// of the caller's crew (played by the worker; here it stays queued) and the public leaderboard.
import { PUZZLES, PUZZLE_RUNS_PER_HOUR } from '@skirm/engine/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let ana: UserClient;
let ben: UserClient;
let anaAgent: string;
let benAgent: string;

beforeAll(async () => {
  h = await setup({ config: { V2_BRAIN: 'greedy' } });
  ana = await h.as('ana');
  ben = await h.as('ben');
  anaAgent = (await h.repos.agents.listByOwner(ana.accountId))[0]!.id;
  benAgent = (await h.repos.agents.listByOwner(ben.accountId))[0]!.id;
});
afterAll(() => h.close());

describe('GET /puzzles', () => {
  it('needs a session (the leaderboard does not)', async () => {
    expect((await h.http().get('/puzzles')).status).toBe(401);
    expect((await h.http().post('/puzzles/pz-1/runs')).status).toBe(401);
    expect((await h.http().get('/puzzles/pz-1/leaderboard')).status).toBe(200);
  });

  it('lists every puzzle with par and medals, free on the greedy brain', async () => {
    const res = await ana.get('/puzzles');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ brain: 'greedy', free: true, limit: { perHour: PUZZLE_RUNS_PER_HOUR, used: 0 }, medals: { solved: 0, total: PUZZLES.length } });
    expect(res.body.puzzles).toHaveLength(PUZZLES.length);
    const p1 = res.body.puzzles[0];
    expect(p1).toMatchObject({ id: 'pz-1', n: 1, title: 'First Steps', crewSize: 1, par: PUZZLES[0]!.medals.gold, costCredits: 0, best: null, goal: { kind: 'deliver', count: 1 } });
  });

  it('shows one puzzle with its board layout', async () => {
    const res = await ana.get('/puzzles/pz-2');
    expect(res.status).toBe(200);
    expect(res.body.goal.kind).toBe('reach');
    expect(res.body.board.layout).toEqual(PUZZLES[1]!.layout);
    expect(res.body.runs).toEqual([]);
    expect((await ana.get('/puzzles/nope')).status).toBe(404);
  });
});

describe('POST /puzzles/:id/runs', () => {
  it('queues a run of the caller’s own crew and answers it when polled', async () => {
    const res = await ana.post('/puzzles/pz-1/runs', { crew: [{ agentId: anaAgent }] });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ puzzleId: 'pz-1', status: 'queued', crew: [{ agentId: anaAgent, tier: 'standard' }], result: null });
    expect(h.benchmarks.jobs.at(-1)).toEqual({ kind: 'puzzle', runId: res.body.id });
    const polled = await ana.get(`/puzzles/pz-1/runs/${res.body.id}`);
    expect(polled.status).toBe(200);
    expect(polled.body.id).toBe(res.body.id);
    // Not someone else's, and not under another puzzle.
    expect((await ben.get(`/puzzles/pz-1/runs/${res.body.id}`)).status).toBe(404);
    expect((await ana.get(`/puzzles/pz-2/runs/${res.body.id}`)).status).toBe(404);
    expect((await ana.get('/puzzles/pz-1/runs/nope')).status).toBe(404);
  });

  it('refuses another player’s agent, a crew too large, a duplicate and an unknown puzzle', async () => {
    expect((await ana.post('/puzzles/pz-1/runs', { crew: [{ agentId: benAgent }] })).status).toBe(403);
    const big = await ana.post('/puzzles/pz-1/runs', { crew: [{ agentId: anaAgent }, { agentId: benAgent }] });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('invalid_crew');
    const dup = await ana.post('/puzzles/pz-3/runs', { crew: [{ agentId: anaAgent }, { agentId: anaAgent }] });
    expect(dup.body.error.code).toBe('invalid_crew');
    expect((await ana.post('/puzzles/pz-1/runs', { crew: [] })).status).toBe(400);
    expect((await ana.post('/puzzles/nope/runs', { crew: [{ agentId: anaAgent }] })).status).toBe(404);
  });
});

describe('GET /puzzles/:id/leaderboard', () => {
  it('ranks each player’s best and shows the caller’s best and medal on the list', async () => {
    for (const [u, score] of [[ana, 15], [ben, 12]] as const) {
      const run = await h.repos.puzzles.create({ accountId: u.accountId, puzzleId: 'pz-4', crew: [{ agentId: u === ana ? anaAgent : benAgent, tier: 'standard' }], limit: 99 });
      await h.repos.puzzles.finish(run.id, { status: 'done', brain: 'greedy', result: { solved: true }, solve: { score, ticks: score, medal: score <= 14 ? 'gold' : 'silver', logHash: `hash${score}` } });
    }
    const board = await h.http().get('/puzzles/pz-4/leaderboard');
    expect(board.status).toBe(200);
    expect(board.body.entries.map((e: { rank: number; account: { handle: string }; score: number }) => [e.rank, e.account.handle, e.score])).toEqual([
      [1, 'ben', 12],
      [2, 'ana', 15],
    ]);
    expect(board.body.entries[0]).toMatchObject({ medal: 'gold', logHash: 'hash12', brain: 'greedy' });
    const list = await ana.get('/puzzles');
    expect(list.body.puzzles[3].best).toMatchObject({ score: 15, medal: 'silver', logHash: 'hash15', solves: 1 });
    expect(list.body.medals).toMatchObject({ silver: 1, solved: 1 });
    expect((await h.http().get('/puzzles/nope/leaderboard')).status).toBe(404);
  });

  it('puts puzzle runs and bests in the account export', async () => {
    const res = await ana.get('/me/export');
    expect(res.status).toBe(200);
    const data = res.body.data ?? res.body;
    expect(data.puzzleBests).toHaveLength(1);
    expect(data.puzzleRuns.length).toBeGreaterThan(0);
  });
});
