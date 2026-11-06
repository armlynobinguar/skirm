import { DEFAULT_LEDGER_CONFIG, CreditsLedger, type TurnOutcome } from '@skirm/ledger';
import { describe, expect, it } from 'vitest';
import { setup, signUp } from './helpers';

const one: TurnOutcome[] = [{ agent: 0, reason: null }];
const two: TurnOutcome[] = [
  { agent: 0, reason: null },
  { agent: 1, reason: null },
];
const strip = (rows: { type: string; amount: number; source: string; note: string | null }[]) =>
  rows.map((r) => ({
    type: r.type,
    amount: r.amount,
    source: r.source,
    ...(r.note ? { note: r.note } : {}),
  }));

describe('LedgerRepo (Postgres) applies @skirm/ledger rules', () => {
  it('staleHolds lists only still-held runs with a matching prefix placed before the cutoff', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'sweep');
    for (const runId of ['bench-run1-0', 'v2-match-a']) {
      const h = await ctx.repos.ledger.hold({ accountId: acc.id, runId, stepLimit: 10, agents: 1 });
      expect(h.ok).toBe(true);
    }
    const later = new Date(Date.now() + 60_000);
    expect(await ctx.repos.ledger.staleHolds(['bench-', 'daily-'], later)).toEqual(['bench-run1-0']);
    expect(await ctx.repos.ledger.staleHolds(['bench-'], new Date(Date.now() - 60_000))).toEqual([]);
    expect(await ctx.repos.ledger.staleHolds([], later)).toEqual([]);
    expect((await ctx.repos.ledger.abort('bench-run1-0')).ok).toBe(true);
    expect(await ctx.repos.ledger.staleHolds(['bench-'], later)).toEqual([]);
  });

  it('one agent: 60 held from the allowance, 27 charged, 33 returned', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const run = { id: 'run_flood' };
    const h = await ctx.repos.ledger.hold({
      accountId: acc.id,
      runId: run.id,
      stepLimit: 60,
      agents: 1,
    });
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(strip(h.rows)).toEqual([{ type: 'free', amount: 60, source: 'free' }]);
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({
      balance: 0,
      held: 60,
      allowanceLeft: 0,
      available: 0,
    });

    for (let t = 1; t <= 27; t++) {
      const c = await ctx.repos.ledger.chargeTurns(run.id, one);
      expect(c.ok).toBe(true);
    }
    const s = await ctx.repos.ledger.settle(run.id);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(strip(s.rows)).toEqual([{ type: 'refund', amount: 33, source: 'free' }]);
    expect(s.summary).toEqual({ charged: 27, refunded: 33, turnsCharged: 27 });
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({
      balance: 0,
      held: 0,
      allowanceLeft: 33,
      available: 33,
    });
    expect(await ctx.repos.ledger.freeBudgetLeft()).toBe(
      DEFAULT_LEDGER_CONFIG.globalFreeBudget - 27,
    );

    expect(await ctx.repos.ledger.summary(run.id)).toEqual({ charged: 27, refunded: 33, turnsCharged: 27 });
    const rows = await ctx.repos.ledger.runRows(run.id);
    expect(rows.map((x) => x.type)).toEqual(['free', ...Array(27).fill('charge'), 'refund']);
    // Σ hold + Σ free = Σ charge + Σ refund
    const sum = (t: string) => rows.filter((x) => x.type === t).reduce((a, x) => a + x.amount, 0);
    expect(sum('hold') + sum('free')).toBe(sum('charge') + sum('refund'));
  });

  it('allowance first, then paid; matches the in-memory ledger row for row', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const mem = new CreditsLedger({ clock: () => ctx.clock.now });

    const t1 = await ctx.repos.ledger.topUp({ accountId: acc.id, credits: 500, receipt: 'tx1' });
    mem.topUp({ player: acc.id, credits: 500, ref: 'tx1' });
    expect(t1.ok).toBe(true);

    // Two agents on Flood Gate: H = 60 × 2.5 = 150 → 60 free + 90 paid.
    const h = await ctx.repos.ledger.hold({
      accountId: acc.id,
      runId: 'r2',
      stepLimit: 60,
      agents: 2,
    });
    const mh = mem.placeHold({ player: acc.id, runId: 'r2', stepLimit: 60, agents: 2 });
    expect(h.ok && mh.ok).toBe(true);
    if (!h.ok) return;
    expect(strip(h.rows)).toEqual([
      { type: 'free', amount: 60, source: 'free' },
      { type: 'hold', amount: 90, source: 'paid' },
    ]);
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({
      balance: 410,
      held: 150,
      allowanceLeft: 0,
    });

    for (let t = 0; t < 23; t++) {
      const c = await ctx.repos.ledger.chargeTurns('r2', two);
      const mc = mem.chargeTurns('r2', two);
      expect(c.ok && strip(c.rows)).toEqual(
        mc.rows.map((r) => ({
          type: r.type,
          amount: r.amount,
          source: r.source,
          ...(r.note ? { note: r.note } : {}),
        })),
      );
    }
    const s = await ctx.repos.ledger.settle('r2');
    const ms = mem.settle('r2');
    expect(s.ok && strip(s.rows)).toEqual(
      ms.rows.map((r) => ({
        type: r.type,
        amount: r.amount,
        source: r.source,
        ...(r.note ? { note: r.note } : {}),
      })),
    );
    // Q = ceil(23 × 2.5) = 58: 58 from the free part, 2 free + 90 paid back.
    expect(s.ok && s.summary).toEqual({ charged: 58, refunded: 92, turnsCharged: 46 });
    const b = await ctx.repos.ledger.balance(acc.id);
    const mb = mem.balance(acc.id);
    expect({ balance: b.balance, held: b.held, allowanceLeft: b.allowanceLeft }).toEqual({
      balance: mb.paid,
      held: mb.held,
      allowanceLeft: mb.freeLeft,
    });
    expect(b).toMatchObject({ balance: 500, allowanceLeft: 2 });
  });

  it('refuses a hold the account cannot cover, with need/have', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const h = await ctx.repos.ledger.hold({
      accountId: acc.id,
      runId: 'big',
      stepLimit: 60,
      agents: 3,
    });
    expect(h).toMatchObject({ ok: false, error: 'insufficient_credits', need: 270, have: 60 });
    // Nothing changed.
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({
      balance: 0,
      held: 0,
      allowanceLeft: 60,
    });
    expect(await ctx.repos.ledger.getHold('big')).toBeUndefined();
    expect(await ctx.repos.ledger.rows(acc.id)).toEqual([]);
  });

  it('abort refunds everything and reverses charges', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    await ctx.repos.ledger.topUp({ accountId: acc.id, credits: 100, receipt: 'r' });
    await ctx.repos.ledger.hold({ accountId: acc.id, runId: 'a1', stepLimit: 60, agents: 2 });
    for (let t = 0; t < 5; t++) await ctx.repos.ledger.chargeTurns('a1', two);
    const a = await ctx.repos.ledger.abort('a1');
    expect(a.ok).toBe(true);
    expect(a.ok && a.summary).toEqual({ charged: 0, refunded: 150, turnsCharged: 10 });
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({
      balance: 100,
      held: 0,
      allowanceLeft: 60,
    });
    expect(await ctx.repos.ledger.chargeTurns('a1', two)).toMatchObject({
      ok: false,
      error: 'run_closed',
    });
    expect(await ctx.repos.ledger.settle('a1')).toMatchObject({ ok: false, error: 'run_closed' });
    expect(await ctx.repos.ledger.settle('nope')).toMatchObject({
      ok: false,
      error: 'unknown_run',
    });
  });

  it('top-up receipts are credited once', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    expect(
      (await ctx.repos.ledger.topUp({ accountId: acc.id, credits: 1000, receipt: 'tx-9' })).ok,
    ).toBe(true);
    expect(
      await ctx.repos.ledger.topUp({ accountId: acc.id, credits: 1000, receipt: 'tx-9' }),
    ).toMatchObject({
      ok: false,
      error: 'duplicate_topup',
    });
    expect(
      await ctx.repos.ledger.topUp({ accountId: ben.id, credits: 1000, receipt: 'tx-9' }),
    ).toMatchObject({
      ok: false,
      error: 'duplicate_topup',
    });
    const concurrent = await Promise.all([
      ctx.repos.ledger.topUp({ accountId: acc.id, credits: 5, receipt: 'tx-10' }),
      ctx.repos.ledger.topUp({ accountId: acc.id, credits: 5, receipt: 'tx-10' }),
    ]);
    expect(concurrent.filter((r) => r.ok).length).toBe(1);
    expect((await ctx.repos.ledger.balance(acc.id)).balance).toBe(1005);
    expect(await ctx.repos.ledger.receiptCredited('tx-9')).toBe(true);
    expect(await ctx.repos.ledger.topUp({ accountId: acc.id, credits: 0 })).toMatchObject({
      ok: false,
      error: 'invalid_amount',
    });
  });

  it('refuses a top-up that would overflow the int4 balance (no raw DB error)', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    expect((await ctx.repos.ledger.topUp({ accountId: acc.id, credits: 2_000_000_000 })).ok).toBe(
      true,
    );
    // dev:<yocto> deposits can be worth 10^13 credits: a safe integer, but not an int4.
    const big = await ctx.repos.ledger.topUp({
      accountId: acc.id,
      credits: 10_000_000_000_000,
      receipt: 'dev:huge',
    });
    expect(big).toMatchObject({ ok: false, error: 'invalid_amount' });
    expect(
      await ctx.repos.ledger.topUp({ accountId: acc.id, credits: 200_000_000, receipt: 'dev:x' }),
    ).toMatchObject({ ok: false, error: 'invalid_amount' });
    expect((await ctx.repos.ledger.balance(acc.id)).balance).toBe(2_000_000_000);
    expect(await ctx.repos.ledger.receiptCredited('dev:huge')).toBe(false);
  });

  it('daily allowance resets at 00:00 UTC; a free refund after the reset expires', async () => {
    const ctx = await setup({ now: '2026-11-03T23:50:00Z' });
    const acc = await signUp(ctx, 'ana');
    await ctx.repos.ledger.hold({ accountId: acc.id, runId: 'late', stepLimit: 60, agents: 1 });
    for (let t = 0; t < 27; t++) await ctx.repos.ledger.chargeTurns('late', one);
    ctx.clock.now = Date.parse('2026-11-04T00:05:00Z');
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({ allowanceLeft: 60, held: 33 });
    const s = await ctx.repos.ledger.settle('late');
    expect(s.ok && strip(s.rows)).toEqual([
      { type: 'refund', amount: 33, source: 'free', note: 'expired' },
    ]);
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({
      allowanceLeft: 60,
      held: 0,
      balance: 0,
    });
    // The new day has a full allowance.
    const h = await ctx.repos.ledger.hold({
      accountId: acc.id,
      runId: 'morning',
      stepLimit: 60,
      agents: 1,
    });
    expect(h.ok && strip(h.rows)).toEqual([{ type: 'free', amount: 60, source: 'free' }]);
  });

  it('global daily free budget (Formulas §4 G) caps free draws across accounts', async () => {
    const ctx = await setup({ globalFreeBudget: 100 });
    const a = await signUp(ctx, 'ana');
    const b = await signUp(ctx, 'ben');
    expect(
      (await ctx.repos.ledger.hold({ accountId: a.id, runId: 'g1', stepLimit: 60, agents: 1 })).ok,
    ).toBe(true);
    expect(await ctx.repos.ledger.freeBudgetLeft()).toBe(40);
    const h = await ctx.repos.ledger.hold({
      accountId: b.id,
      runId: 'g2',
      stepLimit: 60,
      agents: 1,
    });
    expect(h).toMatchObject({ ok: false, error: 'free_budget_exhausted', need: 60, have: 40 });
    // With paid credits the rest comes from the balance.
    await ctx.repos.ledger.topUp({ accountId: b.id, credits: 20, receipt: 'b1' });
    const h2 = await ctx.repos.ledger.hold({
      accountId: b.id,
      runId: 'g2',
      stepLimit: 60,
      agents: 1,
    });
    expect(h2.ok && strip(h2.rows)).toEqual([
      { type: 'free', amount: 40, source: 'free' },
      { type: 'hold', amount: 20, source: 'paid' },
    ]);
    expect(await ctx.repos.ledger.freeBudgetLeft()).toBe(0);
    await ctx.repos.ledger.abort('g1');
    expect(await ctx.repos.ledger.freeBudgetLeft()).toBe(60);
    // Next day the budget is fresh.
    ctx.clock.now += 24 * 3600 * 1000;
    expect(await ctx.repos.ledger.freeBudgetLeft()).toBe(100);
  });

  it('serialises concurrent holds on one account', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const results = await Promise.all(
      ['c1', 'c2', 'c3'].map((runId) =>
        ctx.repos.ledger.hold({ accountId: acc.id, runId, stepLimit: 30, agents: 1 }),
      ),
    );
    expect(results.filter((r) => r.ok).length).toBe(2);
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({ allowanceLeft: 0, held: 60 });
    expect(
      await ctx.repos.ledger.hold({ accountId: acc.id, runId: 'c1', stepLimit: 30, agents: 1 }),
    ).toMatchObject({
      ok: false,
    });
  });

  it('composes with other repositories in one transaction (realtime: match row + hold)', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const base = { mapId: 'copper-hollow', ranked: false, teamA: acc.id, teamB: ben.id };
    await expect(
      ctx.repos.transaction(async (r) => {
        const m = await r.v2Matches.create({ ...base, id: 'tx-match' });
        const h = await r.ledger.hold({
          accountId: acc.id,
          runId: `${m.id}-A`,
          stepLimit: 60,
          agents: 1,
        });
        expect(h.ok).toBe(true);
        throw new Error('enqueue failed');
      }),
    ).rejects.toThrow('enqueue failed');
    expect(await ctx.repos.v2Matches.get('tx-match')).toBeUndefined();
    expect(await ctx.repos.ledger.getHold('tx-match-A')).toBeUndefined();
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({ allowanceLeft: 60, held: 0 });

    const ok = await ctx.repos.transaction(async (r) => {
      const m = await r.v2Matches.create({ ...base, id: 'tx-match2' });
      return r.ledger.hold({ accountId: acc.id, runId: `${m.id}-A`, stepLimit: 60, agents: 1 });
    });
    expect(ok.ok).toBe(true);
    expect(await ctx.repos.ledger.balance(acc.id)).toMatchObject({ allowanceLeft: 0, held: 60 });
  });

  it('a second hold for the same run id is refused and changes nothing (duplicate_run)', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    await ctx.repos.ledger.topUp({ accountId: ana.id, credits: 500, receipt: 'dup-a' });
    await ctx.repos.ledger.topUp({ accountId: ben.id, credits: 500, receipt: 'dup-b' });
    const first = await ctx.repos.ledger.hold({
      accountId: ana.id,
      runId: 'dup',
      stepLimit: 60,
      agents: 2,
    });
    expect(first.ok).toBe(true);
    const anaAfter = await ctx.repos.ledger.balance(ana.id);
    expect(anaAfter).toMatchObject({ balance: 410, held: 150, allowanceLeft: 0 });
    const anaRows = (await ctx.repos.ledger.rows(ana.id)).length;

    // Same account, same run id.
    expect(
      await ctx.repos.ledger.hold({ accountId: ana.id, runId: 'dup', stepLimit: 60, agents: 2 }),
    ).toMatchObject({ ok: false, error: 'duplicate_run' });
    expect(await ctx.repos.ledger.balance(ana.id)).toEqual(anaAfter);
    expect((await ctx.repos.ledger.rows(ana.id)).length).toBe(anaRows);

    // Another account, same run id: refused, its allowance and balance untouched.
    expect(
      await ctx.repos.ledger.hold({ accountId: ben.id, runId: 'dup', stepLimit: 60, agents: 1 }),
    ).toMatchObject({ ok: false, error: 'duplicate_run' });
    expect(await ctx.repos.ledger.balance(ben.id)).toMatchObject({
      balance: 500,
      held: 0,
      allowanceLeft: 60,
    });
    expect(await ctx.repos.ledger.getHold('dup')).toMatchObject({ player: ana.id, hold: 150 });

    // Settling the original hold returns everything unused to Ana.
    const s = await ctx.repos.ledger.settle('dup');
    expect(s.ok).toBe(true);
    expect(await ctx.repos.ledger.balance(ana.id)).toMatchObject({
      balance: 500,
      held: 0,
      allowanceLeft: 60,
    });
  });
});
