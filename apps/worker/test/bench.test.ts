// Writers' test bench consumer: one headless match per run against the greedy bot. Free on the
// greedy brain; a model brain holds one Standard agent on the ledger, charges the ticks and settles.
import { afterEach, describe, expect, it } from 'vitest';
import { greedyAct, type V2Brain } from '@skirm/decision-engine/v2';
import { processBenchmark } from '../src/benchmark-processor';
import { benchEventLine, benchRole, type BenchRunResult } from '../src/bench-processor';
import { setup, type Ctx } from './helpers';

const PROMPT = 'Dig to the crates first, then haul them home along the east wall.';

let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/** Plays like greedy and counts the skill text it was handed (stands in for a model brain). */
function readingBrain(): V2Brain & { seen: Set<string> } {
  const seen = new Set<string>();
  return {
    kind: 'haiku' as const,
    model: 'fake-haiku',
    seen,
    async act(o, c) {
      for (const s of c.skills) seen.add(s);
      return { action: greedyAct(o), reason: 'chosen' as const, say: null };
    },
    async plan() {
      return { text: null };
    },
  };
}

async function draft(c: Ctx, handle = 'writer') {
  const { account } = await c.repos.accounts.getOrCreate({ handle }, c.vault);
  const v = await c.repos.skills.create(
    account.id,
    { name: 'Crate Digger', requiresActions: ['dig'], handlesTags: [], royaltyBps: 500 },
    await c.vault.encryptSkill(PROMPT),
  );
  return { account, v };
}

describe('bench consumer', () => {
  it('greedy: plays the seed for free and stores the result, events and debrief', async () => {
    ctx = await setup();
    const { account, v } = await draft(ctx);
    const run = await ctx.repos.bench.create({ accountId: account.id, skillId: v.id, version: 1, mapId: 'copper-hollow', difficulty: 'easy', limit: 10 });
    const out = await processBenchmark(ctx.deps, { kind: 'bench', runId: run.id });
    expect(out).toMatchObject({ kind: 'bench', id: run.id, status: 'done' });
    const row = await ctx.repos.bench.get(run.id);
    expect(row).toMatchObject({ status: 'done', brain: 'greedy', credits: 0 });
    const r = row!.result as BenchRunResult;
    expect(r).toMatchObject({ seed: 'copper-hollow:easy', mapId: 'copper-hollow', difficulty: 'easy', role: 'Digger' });
    expect(['win', 'loss', 'draw']).toContain(r.outcome);
    expect(r.ticks).toBeGreaterThan(0);
    expect(r.logHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.score.you + r.score.bot).toBeGreaterThan(0);
    expect(r.events.some((e) => e.kind === 'delivered')).toBe(true);
    expect(r.debrief.agents.map((a) => a.agentId)).toEqual(['bench-1']);
    // Never the prompt.
    expect(JSON.stringify(row!.result)).not.toContain('crates first');
    // Free: nothing touched the ledger.
    expect(await ctx.repos.ledger.getHold(`bench-${run.id}-0`)).toBeUndefined();

    // The same seed plays the same match (the engine and greedy are deterministic).
    const again = await ctx.repos.bench.create({ accountId: account.id, skillId: v.id, version: 1, mapId: 'copper-hollow', difficulty: 'easy', limit: 10 });
    await processBenchmark(ctx.deps, { kind: 'bench', runId: again.id });
    expect(((await ctx.repos.bench.get(again.id))!.result as BenchRunResult).logHash).toBe(r.logHash);

    // A finished run is not played twice.
    expect((await processBenchmark(ctx.deps, { kind: 'bench', runId: run.id })).status).toBe('skipped');
  });

  it('a model brain plays the edited draft, holds one Standard agent and pays the ticks', async () => {
    const brain = readingBrain();
    ctx = await setup({ brain });
    const { account, v } = await draft(ctx);
    const sealed = await ctx.vault.encryptSkill('EDITED: wall off the flood first.');
    const run = await ctx.repos.bench.create({ accountId: account.id, skillId: v.id, version: 1, mapId: 'copper-hollow', difficulty: 'easy', limit: 10, sealed });
    const before = await ctx.repos.ledger.balance(account.id);
    expect((await processBenchmark(ctx.deps, { kind: 'bench', runId: run.id })).status).toBe('done');
    expect([...brain.seen]).toEqual(['EDITED: wall off the flood first.']);
    const row = (await ctx.repos.bench.get(run.id))!;
    const ticks = (row.result as BenchRunResult).ticks;
    expect(row.brain).toBe('haiku');
    expect(row.credits).toBe(Math.ceil((ticks * 20) / 100));
    const after = await ctx.repos.ledger.balance(account.id);
    expect(after.held).toBe(0);
    expect(before.available - after.available).toBe(row.credits);
  });

  it('a model run that cannot cover its hold ends insufficient_credits with nothing played', async () => {
    ctx = await setup({ brain: readingBrain() }, { ledger: { config: { freeAllowance: 0 } } });
    const { account, v } = await draft(ctx);
    const run = await ctx.repos.bench.create({ accountId: account.id, skillId: v.id, version: 1, mapId: 'copper-hollow', difficulty: 'easy', limit: 10 });
    const out = await processBenchmark(ctx.deps, { kind: 'bench', runId: run.id });
    expect(out.status).toBe('insufficient_credits');
    expect(await ctx.repos.bench.get(run.id)).toMatchObject({ status: 'insufficient_credits', credits: 0, result: { need: 30, have: 0 } });
  });

  it('a failure after the hold returns it before BullMQ retries', async () => {
    const brain: V2Brain = {
      kind: 'haiku',
      model: 'waiting',
      act: async () => ({ action: { type: 'wait' }, reason: 'chosen', say: null }),
      plan: async () => ({ text: null }),
    };
    ctx = await setup({ brain });
    const { account, v } = await draft(ctx);
    const run = await ctx.repos.bench.create({ accountId: account.id, skillId: v.id, version: 1, mapId: 'copper-hollow', difficulty: 'easy', limit: 10 });
    ctx.repos.bench.finish = async () => {
      throw new Error('db down');
    };
    await expect(processBenchmark(ctx.deps, { kind: 'bench', runId: run.id }, { attemptsMade: 2, attempts: 3 })).rejects.toThrow('db down');
    expect((await ctx.repos.ledger.balance(account.id)).held).toBe(0);
  });

  it('roles and event lines', () => {
    expect(benchRole({ requiresActions: ['dig'] })).toBe('Digger');
    expect(benchRole({ requiresActions: [] })).toBe('Builder');
    const name = (id: string) => (id === 'bench-1' ? 'You' : 'Bot 1');
    expect(benchEventLine({ kind: 'delivered', agent: 'bench-1', team: 'A', count: 2, score: 3 }, name)).toEqual({ kind: 'delivered', text: 'You delivered 2 (score 3)' });
    expect(benchEventLine({ kind: 'said', agent: 'bench-1', channel: 'say', text: 'secret', heardBy: [], overheardBy: [] }, name)).toBeNull();
  });
});
