// Repo additions for the web builders: NEAR unlink, creator royalties.
import { describe, expect, it } from 'vitest';
import { setup, signUp } from './helpers';

const meta = {
  name: 'Gap Sealer',
  summary: null,
  requiresActions: ['place_block' as const],
  handlesTags: ['liquid' as const],
  royaltyBps: 500,
};

describe('accounts.unlinkNearAccount', () => {
  it('clears the link', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    await ctx.repos.accounts.linkNearAccount(ana.id, 'ana.testnet');
    const row = await ctx.repos.accounts.unlinkNearAccount(ana.id);
    expect(row!.nearAccountId).toBeNull();
    expect(await ctx.repos.accounts.byNearAccount('ana.testnet')).toBeUndefined();
  });
});

describe('market.royaltiesByCreator', () => {
  it('sums the royalty share of resales only (splitSale)', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const cat = await signUp(ctx, 'cat');
    const v = await ctx.repos.skills.create(ana.id, meta, await ctx.sealer.encryptSkill('p'));
    await ctx.repos.skills.markMinted(v.id, 1, `${v.id}:1`);
    const price = '3000000000000000000000000';
    await ctx.repos.market.list({ skillId: v.id, version: 1, sellerId: ana.id, priceYocto: price });
    expect(await ctx.repos.market.hasActiveListing(ana.id)).toBe(true);
    await ctx.repos.market.recordSale({ skillId: v.id, version: 1, buyerId: ben.id, txHash: 't1' });
    expect(await ctx.repos.market.hasActiveListing(ana.id)).toBe(false);
    // Primary sale: no royalty.
    expect((await ctx.repos.market.royaltiesByCreator(ana.id)).size).toBe(0);
    await ctx.repos.market.list({ skillId: v.id, version: 1, sellerId: ben.id, priceYocto: price });
    await ctx.repos.market.recordSale({ skillId: v.id, version: 1, buyerId: cat.id, txHash: 't2' });
    const r = await ctx.repos.market.royaltiesByCreator(ana.id);
    // 5% of 3 NEAR.
    expect(r.get(v.id)).toBe(150000000000000000000000n);
    expect((await ctx.repos.market.royaltiesByCreator(ben.id)).size).toBe(0);
  });
});
