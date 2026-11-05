// Puzzle runs on the worker: the player's own agents, headless against the inert rock crew. Free on
// the greedy brain; a model brain holds the crew for the puzzle's cap, charges the ticks and settles.
import { afterEach, describe, expect, it } from 'vitest';
import { greedyAct, type V2Brain } from '@skirm/decision-engine/v2';
import { puzzleById } from '@skirm/engine/v2';
import { processBenchmark } from '../src/benchmark-processor';
import type { PuzzleRunResult } from '../src/puzzle-processor';
import { setup, type Ctx } from './helpers';

let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

async function player(c: Ctx, handle = 'solver') {
  const { account } = await c.repos.accounts.getOrCreate({ handle }, c.vault);
  const agents = await c.repos.agents.listByOwner(account.id);
  return { account, agents };
}

describe('puzzle consumer', () => {
  it('greedy: plays the run for free, stores the result and sets the best', async () => {
    ctx = await setup();
    const { account, agents } = await player(ctx);
    expect(agents.length).toBeGreaterThan(0);
    const crew = [{ agentId: agents[0]!.id, tier: 'standard' as const }];
    const run = await ctx.repos.puzzles.create({ accountId: account.id, puzzleId: 'pz-1', crew, limit: 10 });
    const out = await processBenchmark(ctx.deps, { kind: 'puzzle', runId: run.id });
    expect(out).toMatchObject({ kind: 'puzzle', id: run.id, status: 'done' });
    const row = (await ctx.repos.puzzles.get(run.id))!;
    expect(row).toMatchObject({ status: 'done', brain: 'greedy', credits: 0 });
    const r = row.result as PuzzleRunResult;
    expect(r).toMatchObject({ puzzleId: 'pz-1', solved: true, reason: 'goal', best: true, delivered: 1 });
    expect(r.score).toBe(r.ticks);
    expect(r.ticks).toBeLessThanOrEqual(puzzleById('pz-1')!.cap);
    expect(r.logHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.crew).toEqual([{ agentId: agents[0]!.id, name: agents[0]!.name, role: agents[0]!.role }]);
    expect(r.events.some((e) => e.kind === 'delivered')).toBe(true);
    expect(await ctx.repos.ledger.getHold(`puzzle-${run.id}-0`)).toBeUndefined();
    expect(await ctx.repos.puzzles.bests(account.id)).toMatchObject([{ puzzleId: 'pz-1', score: r.score, runId: run.id, logHash: r.logHash }]);

    // The same crew plays the same run; a tie is not a new best.
    const again = await ctx.repos.puzzles.create({ accountId: account.id, puzzleId: 'pz-1', crew, limit: 10 });
    await processBenchmark(ctx.deps, { kind: 'puzzle', runId: again.id });
    const r2 = (await ctx.repos.puzzles.get(again.id))!.result as PuzzleRunResult;
    expect(r2.logHash).toBe(r.logHash);
    expect(r2.best).toBe(false);
    expect((await ctx.repos.puzzles.bests(account.id))[0]).toMatchObject({ runId: run.id, solves: 2 });

    // A finished run is not played twice.
    expect((await processBenchmark(ctx.deps, { kind: 'puzzle', runId: run.id })).status).toBe('skipped');
  });

  it('fails a run whose agent is no longer the player’s', async () => {
    ctx = await setup();
    const { account } = await player(ctx, 'ana');
    const other = await player(ctx, 'ben');
    const run = await ctx.repos.puzzles.create({ accountId: account.id, puzzleId: 'pz-1', crew: [{ agentId: other.agents[0]!.id, tier: 'standard' }], limit: 10 });
    expect(await processBenchmark(ctx.deps, { kind: 'puzzle', runId: run.id })).toMatchObject({ status: 'failed', reason: 'invalid_crew' });
    expect(await ctx.repos.puzzles.bests(account.id)).toEqual([]);
  });

  it('a model brain holds the crew for the cap and pays the ticks it played', async () => {
    const brain: V2Brain = {
      kind: 'model',
      model: 'fake-model',
      act: async (o) => ({ action: greedyAct(o), reason: 'chosen', say: null }),
      plan: async () => ({ text: null }),
    };
    ctx = await setup({ brain });
    const { account, agents } = await player(ctx);
    const run = await ctx.repos.puzzles.create({ accountId: account.id, puzzleId: 'pz-1', crew: [{ agentId: agents[0]!.id, tier: 'standard' }], limit: 10 });
    const before = await ctx.repos.ledger.balance(account.id);
    expect((await processBenchmark(ctx.deps, { kind: 'puzzle', runId: run.id })).status).toBe('done');
    const row = (await ctx.repos.puzzles.get(run.id))!;
    const ticks = (row.result as PuzzleRunResult).ticks;
    expect(row.brain).toBe('model');
    expect(row.credits).toBe(Math.ceil((ticks * 20) / 100));
    const after = await ctx.repos.ledger.balance(account.id);
    expect(after.held).toBe(0);
    expect(before.available - after.available).toBe(row.credits);
  });

  it('a model run that cannot cover its hold ends insufficient_credits', async () => {
    const brain: V2Brain = { kind: 'model', model: 'm', act: async () => ({ action: { type: 'wait' }, reason: 'chosen', say: null }), plan: async () => ({ text: null }) };
    ctx = await setup({ brain }, { ledger: { config: { freeAllowance: 0 } } });
    const { account, agents } = await player(ctx);
    const run = await ctx.repos.puzzles.create({ accountId: account.id, puzzleId: 'pz-1', crew: [{ agentId: agents[0]!.id, tier: 'standard' }], limit: 10 });
    expect((await processBenchmark(ctx.deps, { kind: 'puzzle', runId: run.id })).status).toBe('insufficient_credits');
    expect(await ctx.repos.puzzles.get(run.id)).toMatchObject({ status: 'insufficient_credits', credits: 0 });
  });
});
