import { describe, expect, it } from 'vitest';
import { cosmeticById } from '@skirm/shared';
import { setup, signUp } from './helpers';

const strip = (
  rows: {
    type: string;
    amount: number;
    source: string;
    note: string | null;
    runId: string | null;
  }[],
) => rows.map(({ type, amount, source, note, runId }) => ({ type, amount, source, note, runId }));

describe('cosmetics', () => {
  it('a buy debits paid credits only: the allowance and the global budget are untouched', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    await ctx.repos.ledger.topUp({ accountId: ana.id, credits: 150, receipt: 'r1' });
    const budget = await ctx.repos.ledger.freeBudgetLeft();
    const gold = cosmeticById('outfit_gold')!;

    expect(await ctx.repos.cosmetics.buy(ana.id, gold.id)).toEqual({
      ok: true,
      owned: ['outfit_gold'],
      charged: gold.priceCredits,
    });
    expect(await ctx.repos.ledger.balance(ana.id)).toMatchObject({
      balance: 150 - gold.priceCredits,
      allowanceLeft: 60,
      held: 0,
    });
    expect(await ctx.repos.ledger.freeBudgetLeft()).toBe(budget);
    const [row] = await ctx.repos.ledger.rows(ana.id, 1);
    expect(strip([row!])).toEqual([
      {
        type: 'spend',
        amount: gold.priceCredits,
        source: 'paid',
        note: 'cosmetic',
        runId: 'cosmetic:outfit_gold',
      },
    ]);

    // Already owned: nothing charged.
    expect(await ctx.repos.cosmetics.buy(ana.id, gold.id)).toEqual({
      ok: true,
      owned: ['outfit_gold'],
      charged: 0,
    });
    expect((await ctx.repos.ledger.balance(ana.id)).balance).toBe(150 - gold.priceCredits);
  });

  it('refuses when paid credits are short, even with the whole allowance left', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    await ctx.repos.ledger.topUp({ accountId: ana.id, credits: 30 });
    expect(await ctx.repos.cosmetics.buy(ana.id, 'hair_platinum')).toMatchObject({
      ok: false,
      error: 'insufficient_credits',
      need: 40,
      have: 30,
    });
    expect(await ctx.repos.cosmetics.owned(ana.id)).toEqual([]);
    expect(await ctx.repos.ledger.balance(ana.id)).toMatchObject({
      balance: 30,
      allowanceLeft: 60,
    });
    expect(await ctx.repos.cosmetics.buy(ana.id, 'cape_of_nope')).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });

  it('a concurrent second buy of the same item is not charged', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    await ctx.repos.ledger.topUp({ accountId: ana.id, credits: 100 });
    const [a, b] = await Promise.all([
      ctx.repos.cosmetics.buy(ana.id, 'hair_violet'),
      ctx.repos.cosmetics.buy(ana.id, 'hair_violet'),
    ]);
    expect([a, b].map((r) => (r.ok ? r.charged : -1)).sort()).toEqual([0, 50]);
    expect((await ctx.repos.ledger.balance(ana.id)).balance).toBe(50);
  });

  it('grants without charging, and composes in a transaction that can roll the buy back', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    await ctx.repos.cosmetics.grant(ana.id, 'outfit_neon', 'launch');
    await ctx.repos.cosmetics.grant(ana.id, 'outfit_neon');
    expect(await ctx.repos.cosmetics.owned(ana.id)).toEqual(['outfit_neon']);
    await expect(ctx.repos.cosmetics.grant(ana.id, 'nope')).rejects.toMatchObject({
      code: 'not_found',
    });

    await ctx.repos.ledger.topUp({ accountId: ana.id, credits: 100 });
    await expect(
      ctx.repos.transaction(async (r) => {
        expect((await r.cosmetics.buy(ana.id, 'outfit_obsidian')).ok).toBe(true);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await ctx.repos.cosmetics.owned(ana.id)).toEqual(['outfit_neon']);
    expect((await ctx.repos.ledger.balance(ana.id)).balance).toBe(100);
  });
});
