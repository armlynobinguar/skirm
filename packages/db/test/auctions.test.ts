// Sealed skill auctions: the EVM address link, the auction rows and the cSKIRM sale they end in.
import { describe, expect, it } from 'vitest';
import { setup, signUp, type Ctx } from './helpers';

const meta = {
  name: 'Gap Sealer',
  summary: null,
  requiresActions: ['place_block' as const],
  handlesTags: ['liquid' as const],
  royaltyBps: 500,
};
const CONTRACT = '0x00000000000000000000000000000000000A0C71';
const ALICE_EVM = '0xA11CE00000000000000000000000000000000001';
const REF = `0x${'ab'.repeat(32)}`;

async function minted(ctx: Ctx, creatorId: string) {
  const v = await ctx.repos.skills.create(creatorId, meta, await ctx.sealer.encryptSkill('p'));
  await ctx.repos.skills.markMinted(v.id, 1, `${v.id}:1`);
  return v;
}

describe('accounts EVM link', () => {
  it('links a lower-cased address once per account and finds it in any case', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    expect(await ctx.repos.accounts.linkEvmAddress(ana.id, ALICE_EVM)).toEqual({ ok: true });
    expect((await ctx.repos.accounts.get(ana.id))!.evmAddress).toBe(ALICE_EVM.toLowerCase());
    expect((await ctx.repos.accounts.byEvmAddress(ALICE_EVM.toUpperCase().replace('0X', '0x')))!.id).toBe(ana.id);
    expect(await ctx.repos.accounts.linkEvmAddress(ben.id, ALICE_EVM.toLowerCase())).toEqual({ ok: false, error: 'taken' });
    expect(await ctx.repos.accounts.linkEvmAddress(ben.id, 'nope')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('auctions repo', () => {
  it('registers once, lists open auctions and walks open → won → granted', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const v = await minted(ctx, ana.id);
    const endsAt = new Date(ctx.clock.now + 3_600_000);
    const row = await ctx.repos.auctions.register({
      contractAddress: CONTRACT,
      chainAuctionId: '1',
      skillId: v.id,
      version: 1,
      sellerId: ana.id,
      skillRef: REF,
      endsAt,
    });
    expect(row.status).toBe('open');
    expect(row.contractAddress).toBe(CONTRACT.toLowerCase());
    await expect(
      ctx.repos.auctions.register({ contractAddress: CONTRACT, chainAuctionId: '1', skillId: v.id, version: 1, sellerId: ana.id, skillRef: REF, endsAt }),
    ).rejects.toMatchObject({ code: 'duplicate' });
    expect((await ctx.repos.auctions.openFor(v.id, 1))!.id).toBe(row.id);
    expect(await ctx.repos.auctions.due(new Date(ctx.clock.now))).toHaveLength(0);
    expect(await ctx.repos.auctions.due(new Date(endsAt.getTime() + 1))).toHaveLength(1);

    await ctx.repos.auctions.markWon(row.id, ALICE_EVM, '55000000');
    expect((await ctx.repos.auctions.get(row.id))!.status).toBe('won');
    // Won but not granted stays due (e.g. the winner links its address later).
    expect(await ctx.repos.auctions.due(new Date(ctx.clock.now))).toHaveLength(1);

    const { sale } = await ctx.repos.market.recordSale({
      skillId: v.id,
      version: 1,
      buyerId: ben.id,
      sellerId: ana.id,
      txHash: `zama-auction:${CONTRACT}:1`,
      priceYocto: '55000000',
      currency: 'cskirm',
    });
    expect(sale.currency).toBe('cskirm');
    expect(sale.sellerId).toBe(ana.id);
    expect(await ctx.repos.skills.owns(ben.id, v.id, 1)).toBe(true);
    expect(await ctx.repos.skills.owns(ana.id, v.id, 1)).toBe(false);
    await ctx.repos.auctions.markGranted(row.id, ben.id, sale.id);
    const done = (await ctx.repos.auctions.listRecent())[0]!;
    expect(done.status).toBe('granted');
    expect(done.saleId).toBe(sale.id);
    expect(await ctx.repos.auctions.due(new Date(endsAt.getTime() + 1))).toHaveLength(0);
    // cSKIRM sales stay out of the NEAR royalty and seller totals.
    expect(await ctx.repos.market.salesNetBySeller(ana.id)).toBe(0n);
  });

  it('marks a failed auction and rejects malformed ids', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const v = await minted(ctx, ana.id);
    const base = { contractAddress: CONTRACT, skillId: v.id, version: 1, sellerId: ana.id, skillRef: REF, endsAt: new Date(ctx.clock.now) };
    await expect(ctx.repos.auctions.register({ ...base, chainAuctionId: '0' })).rejects.toMatchObject({ code: 'invalid_auction' });
    await expect(ctx.repos.auctions.register({ ...base, chainAuctionId: '2', contractAddress: 'x' })).rejects.toMatchObject({ code: 'invalid_address' });
    const row = await ctx.repos.auctions.register({ ...base, chainAuctionId: '2' });
    await ctx.repos.auctions.markFailed(row.id);
    expect((await ctx.repos.auctions.get(row.id))!.status).toBe('failed');
    expect(await ctx.repos.auctions.openFor(v.id, 1)).toBeUndefined();
  });
});
