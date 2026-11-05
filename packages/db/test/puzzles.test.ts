import { describe, expect, it } from 'vitest';
import { RepoError } from '../src/index';
import { setup, signUp } from './helpers';

const crew = [{ agentId: 'agt_x', tier: 'standard' as const }];
const solve = (score: number, logHash = `h${score}`) => ({ score, ticks: score, medal: score <= 10 ? 'gold' : null, logHash });

describe('PuzzlesRepo', () => {
  it('queues, claims and finishes a run, keeping the lowest score as the best', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const { puzzles } = ctx.repos;

    const r1 = await puzzles.create({ accountId: ana.id, puzzleId: 'pz-1', crew, limit: 10 });
    expect(r1.id).toMatch(/^pzr_/);
    expect(r1.status).toBe('queued');
    expect((await puzzles.claim(r1.id))?.status).toBe('running');
    expect(await puzzles.claim(r1.id)).toBeUndefined();
    const f1 = await puzzles.finish(r1.id, { status: 'done', brain: 'greedy', result: { solved: true }, solve: solve(14) });
    expect(f1.best).toBe(true);
    expect(f1.run.status).toBe('done');

    // A worse solve counts but keeps the best; a better one replaces it; a tie keeps the earlier.
    const r2 = await puzzles.create({ accountId: ana.id, puzzleId: 'pz-1', crew, limit: 10 });
    expect((await puzzles.finish(r2.id, { status: 'done', brain: 'greedy', solve: solve(20) })).best).toBe(false);
    const r3 = await puzzles.create({ accountId: ana.id, puzzleId: 'pz-1', crew, limit: 10 });
    expect((await puzzles.finish(r3.id, { status: 'done', brain: 'model', solve: solve(9) })).best).toBe(true);
    const r4 = await puzzles.create({ accountId: ana.id, puzzleId: 'pz-1', crew, limit: 10 });
    expect((await puzzles.finish(r4.id, { status: 'done', brain: 'greedy', solve: solve(9, 'later') })).best).toBe(false);

    const [best] = await puzzles.bests(ana.id);
    expect(best).toMatchObject({ puzzleId: 'pz-1', score: 9, medal: 'gold', runId: r3.id, logHash: 'h9', brain: 'model', solves: 4 });

    // An unsolved run changes nothing.
    const r5 = await puzzles.create({ accountId: ana.id, puzzleId: 'pz-1', crew, limit: 10 });
    expect((await puzzles.finish(r5.id, { status: 'done', brain: 'greedy', result: { solved: false } })).best).toBe(false);
    expect((await puzzles.bests(ana.id))[0]!.solves).toBe(4);

    expect((await puzzles.list(ana.id, 'pz-1')).map((r) => r.id)).toEqual([r5.id, r4.id, r3.id, r2.id, r1.id]);
    expect(await puzzles.list(ana.id, 'pz-2')).toEqual([]);
    expect((await puzzles.get(r3.id))?.status).toBe('done');
  });

  it('caps runs per rolling hour', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const { puzzles } = ctx.repos;
    const now = new Date('2026-11-03T08:00:00Z');
    await puzzles.create({ accountId: ana.id, puzzleId: 'pz-1', crew, limit: 2, now });
    await puzzles.create({ accountId: ana.id, puzzleId: 'pz-2', crew, limit: 2, now });
    expect(await puzzles.usedInWindow(ana.id, now)).toBe(2);
    const err = await puzzles.create({ accountId: ana.id, puzzleId: 'pz-1', crew, limit: 2, now }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepoError);
    expect((err as RepoError).code).toBe('puzzle_limit');
    const later = new Date(now.getTime() + 61 * 60_000);
    await expect(puzzles.create({ accountId: ana.id, puzzleId: 'pz-1', crew, limit: 2, now: later })).resolves.toBeDefined();
  });

  it('ranks a puzzle board by score, earlier first on a tie, and puts runs in the export', async () => {
    const ctx = await setup();
    const { puzzles } = ctx.repos;
    const ids: string[] = [];
    for (const [handle, score] of [['ana', 12], ['ben', 9], ['cy', 12]] as const) {
      const acc = await signUp(ctx, handle);
      ids.push(acc.id);
      const r = await puzzles.create({ accountId: acc.id, puzzleId: 'pz-3', crew, limit: 10 });
      await puzzles.finish(r.id, { status: 'done', brain: 'greedy', solve: solve(score) });
    }
    const board = await puzzles.leaderboard('pz-3');
    expect(board.map((r) => [r.rank, r.account.handle, r.score])).toEqual([
      [1, 'ben', 9],
      [2, 'ana', 12],
      [2, 'cy', 12],
    ]);
    expect(await puzzles.leaderboard('pz-4')).toEqual([]);

    const exp = await ctx.repos.accounts.exportFor(ids[0]!);
    expect(exp.puzzleRuns).toHaveLength(1);
    expect(exp.puzzleBests).toMatchObject([{ puzzleId: 'pz-3', score: 12 }]);
  });
});
