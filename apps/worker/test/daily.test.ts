// Daily challenge consumer: the player's crew against the greedy bot on the day's challenge.
// Free and reproducible on the greedy brain; a model brain holds the crew's talk rate and pays the ticks.
import { afterEach, describe, expect, it } from 'vitest';
import type { DailyCrewRecord } from '@skirm/db';
import { greedyAct, type V2Brain } from '@skirm/decision-engine/v2';
import { dailyChallenge, dailyPoints } from '@skirm/engine/v2';
import { processBenchmark } from '../src/benchmark-processor';
import { dailyCrew, type DailyAttemptResult } from '../src/daily-processor';
import { setup, type Ctx } from './helpers';

const DATE = '2026-11-05';

let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/** Plays like greedy and records the skill text it was handed (stands in for a model brain). */
function readingBrain(): V2Brain & { seen: Set<string> } {
  const seen = new Set<string>();
  return {
    kind: 'model' as const,
    model: 'fake-model',
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

async function queue(c: Ctx, handle = 'daily-player', date = DATE) {
  const { account } = await c.repos.accounts.getOrCreate({ handle }, c.vault);
  const ch = dailyChallenge(date);
  const agents = (await c.repos.agents.listByOwner(account.id)).slice(0, ch.crewSize);
  const crew: DailyCrewRecord[] = agents.map((a) => ({
    agentId: a.id,
    name: a.name,
    role: a.role,
    vision: a.vision,
    comms: a.comms,
    tier: a.tier,
    skills: a.skills.map((s) => ({ id: s.id, version: s.version, name: s.name })),
  }));
  const row = await c.repos.daily.create({ accountId: account.id, date, seed: ch.seed, mapId: ch.mapId, difficulty: ch.difficulty, twist: ch.twist, crew, limit: 10 });
  return { account, row, ch };
}

describe('daily consumer', () => {
  it('greedy: plays the challenge for free, scores it and replays to the same log hash', async () => {
    ctx = await setup();
    const { account, row, ch } = await queue(ctx);
    const out = await processBenchmark(ctx.deps, { kind: 'daily', attemptId: row.id });
    expect(out).toMatchObject({ kind: 'daily', id: row.id, status: 'done' });
    const done = (await ctx.repos.daily.get(row.id))!;
    expect(done).toMatchObject({ status: 'done', brain: 'greedy', credits: 0 });
    const r = done.result as DailyAttemptResult;
    expect(r).toMatchObject({ seed: ch.seed, mapId: ch.mapId, difficulty: ch.difficulty, twist: ch.twist, clock: ch.ticks });
    expect(r.ticks).toBeGreaterThan(0);
    expect(r.ticks).toBeLessThanOrEqual(ch.ticks);
    expect(r.logHash).toMatch(/^[0-9a-f]{64}$/);
    expect(done.logHash).toBe(r.logHash);
    expect(done.points).toBe(dailyPoints({ outcome: r.outcome, you: r.score.you, bot: r.score.bot, ticks: r.ticks, clock: ch.ticks }));
    expect(await ctx.repos.ledger.getHold(`daily-${row.id}-0`)).toBeUndefined();

    // Verifiable: the same crew on the same day plays the same match.
    const again = await ctx.repos.daily.create({ accountId: account.id, date: DATE, seed: ch.seed, mapId: ch.mapId, difficulty: ch.difficulty, twist: ch.twist, crew: row.crew, limit: 10 });
    await processBenchmark(ctx.deps, { kind: 'daily', attemptId: again.id });
    expect((await ctx.repos.daily.get(again.id))!.logHash).toBe(r.logHash);

    // A finished attempt is not played twice.
    expect((await processBenchmark(ctx.deps, { kind: 'daily', attemptId: row.id })).status).toBe('skipped');

    // On the board.
    const board = await ctx.repos.daily.board(DATE);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ accountId: account.id, handle: 'daily-player', points: done.points, logHash: r.logHash });
  });

  it('a model brain plays the crew skills it owns, holds the crew and pays the ticks', async () => {
    const brain = readingBrain();
    ctx = await setup({ brain });
    const { account, row } = await queue(ctx);
    await ctx.repos.ledger.topUp({ accountId: account.id, credits: 1000 });
    const before = await ctx.repos.ledger.balance(account.id);
    expect((await processBenchmark(ctx.deps, { kind: 'daily', attemptId: row.id })).status).toBe('done');
    const done = (await ctx.repos.daily.get(row.id))!;
    expect(done.brain).toBe('model');
    expect(done.credits).toBeGreaterThan(0);
    const after = await ctx.repos.ledger.balance(account.id);
    expect(after.held).toBe(0);
    expect(before.available - after.available).toBe(done.credits);
    // Equipped skills ride along as in a match, never stored on the attempt.
    expect(row.crew.flatMap((a) => a.skills).length).toBeGreaterThan(0);
    expect(brain.seen.size).toBeGreaterThan(0);
    for (const s of brain.seen) expect(JSON.stringify(done)).not.toContain(s);
  });

  it('a retry after finish fails charges the player once', async () => {
    ctx = await setup({ brain: readingBrain() });
    const { account, row } = await queue(ctx);
    await ctx.repos.ledger.topUp({ accountId: account.id, credits: 1000 });
    const before = await ctx.repos.ledger.balance(account.id);
    const daily = ctx.repos.daily;
    const realFinish = daily.finish.bind(daily);
    let failNext = true;
    daily.finish = (async (id: string, input: Parameters<typeof realFinish>[1]) => {
      if (failNext && input.status === 'done') {
        failNext = false;
        throw new Error('db blip');
      }
      return realFinish(id, input);
    }) as typeof daily.finish;
    await expect(
      processBenchmark(ctx.deps, { kind: 'daily', attemptId: row.id }, { attemptsMade: 0, attempts: 3 }),
    ).rejects.toThrow('db blip');
    // The failed attempt's hold was aborted: its charges came back.
    expect(await ctx.repos.ledger.getHold(`daily-${row.id}-0`)).toMatchObject({ status: 'aborted' });
    expect((await ctx.repos.ledger.balance(account.id)).available).toBe(before.available);
    const out = await processBenchmark(ctx.deps, { kind: 'daily', attemptId: row.id }, { attemptsMade: 1, attempts: 3 });
    expect(out.status).toBe('done');
    const done = (await ctx.repos.daily.get(row.id))!;
    expect(done.credits).toBeGreaterThan(0);
    const after = await ctx.repos.ledger.balance(account.id);
    expect(after.held).toBe(0);
    expect(before.available - after.available).toBe(done.credits);
  });

  it('a model attempt that cannot cover its hold ends insufficient_credits and gives the attempt back', async () => {
    ctx = await setup({ brain: readingBrain() }, { ledger: { config: { freeAllowance: 0 } } });
    const { account, row } = await queue(ctx);
    expect(await ctx.repos.daily.usedOn(account.id, DATE)).toBe(1);
    const out = await processBenchmark(ctx.deps, { kind: 'daily', attemptId: row.id });
    expect(out.status).toBe('insufficient_credits');
    expect(await ctx.repos.daily.get(row.id)).toMatchObject({ status: 'insufficient_credits', credits: 0, points: null });
    expect(await ctx.repos.daily.usedOn(account.id, DATE)).toBe(0);
  });

  it('caps attempts per account per day under a lock', async () => {
    ctx = await setup();
    const { account, row } = await queue(ctx);
    const c = ctx;
    const again = () => c.repos.daily.create({ accountId: account.id, date: DATE, seed: 'x', mapId: row.mapId, difficulty: row.difficulty, twist: row.twist, crew: row.crew, limit: 3 });
    const results = await Promise.allSettled([again(), again(), again()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: 'daily_limit', details: { limit: 3, used: 3 } });
    // Another day has its own attempts.
    await expect(c.repos.daily.create({ accountId: account.id, date: '2026-11-06', seed: 'y', mapId: row.mapId, difficulty: row.difficulty, twist: row.twist, crew: row.crew, limit: 3 })).resolves.toBeTruthy();
  });

  it('maps the snapshot onto engine agents', () => {
    const crew = dailyCrew({
      crew: [{ agentId: 'agt_1', name: 'Rook', role: 'Builder', vision: 3, comms: 2, tier: 'open', skills: [] }],
    });
    expect(crew).toEqual([{ id: 'agt_1', name: 'Rook', role: 'Builder', vision: 3, comms: 2, tier: 'open' }]);
  });
});
