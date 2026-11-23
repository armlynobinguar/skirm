// Sealed skill auctions: the worker pass over real repos (PGlite) and a mocked SkillAuction.
import { auctionSkillRef, type AuctionReader, type ChainAuction } from '@skirm/server';
import { describe, expect, it } from 'vitest';
import { auctionPollMs, processAuctionTick } from '../src/auction-processor';
import { setup, type Ctx } from './helpers';

const CONTRACT = '0x00000000000000000000000000000000000a0c71';
const SELLER_EVM = '0x5e11e00000000000000000000000000000000001';
const BUYER_EVM = '0xb0b0000000000000000000000000000000000002';

function reader(records: Record<string, Partial<ChainAuction>>, ref: string): AuctionReader {
  return {
    address: CONTRACT,
    async getAuction(id) {
      return {
        seller: SELLER_EVM,
        skillRef: ref.toLowerCase(),
        endTime: 0,
        status: 'none',
        bidders: 0,
        winner: '0x0000000000000000000000000000000000000000',
        price: 0n,
        ...records[id.toString()],
      };
    },
  };
}

async function auctioned(c: Ctx, chainAuctionId: string) {
  const { account: seller } = await c.repos.accounts.getOrCreate({ handle: `seller${chainAuctionId}` }, c.vault);
  const v = await c.repos.skills.create(
    seller.id,
    { name: 'Gap Sealer', requiresActions: ['place_block'], handlesTags: [], royaltyBps: 500 },
    await c.vault.encryptSkill('seal the gaps'),
  );
  await c.repos.skills.markMinted(v.id, 1, `${v.id}:1`);
  const ref = auctionSkillRef(v.id, 1);
  const row = await c.repos.auctions.register({
    contractAddress: CONTRACT,
    chainAuctionId,
    skillId: v.id,
    version: 1,
    sellerId: seller.id,
    skillRef: ref,
    endsAt: new Date(c.deps.clock.now() - 1),
  });
  return { seller, v, ref, row };
}

describe('auction poller', () => {
  it('reads the poll interval with a floor', () => {
    expect(auctionPollMs({})).toBe(30_000);
    expect(auctionPollMs({ ZAMA_AUCTION_POLL_MS: '10000' })).toBe(10_000);
    expect(auctionPollMs({ ZAMA_AUCTION_POLL_MS: '10' })).toBe(30_000);
  });

  it('grants the won version to the linked buyer as a cSKIRM sale', async () => {
    const c = await setup();
    const { seller, v, ref, row } = await auctioned(c, '1');
    const { account: buyer } = await c.repos.accounts.getOrCreate({ handle: 'buyer' }, c.vault);
    await c.repos.accounts.linkEvmAddress(buyer.id, BUYER_EVM);

    const chain = reader({ 1: { status: 'won', winner: BUYER_EVM, price: 55_000_000n, bidders: 3 } }, ref);
    const out = await processAuctionTick(c.deps, chain);
    expect(out!.granted).toEqual([row.id]);

    expect(await c.repos.skills.owns(buyer.id, v.id, 1)).toBe(true);
    expect(await c.repos.skills.owns(seller.id, v.id, 1)).toBe(false);
    const [sale] = await c.repos.market.salesOf(v.id);
    expect(sale).toMatchObject({ buyerId: buyer.id, sellerId: seller.id, currency: 'cskirm', priceYocto: '55000000' });
    const done = await c.repos.auctions.get(row.id);
    expect(done).toMatchObject({ status: 'granted', buyerId: buyer.id, saleId: sale!.id, winnerAddress: BUYER_EVM, price: '55000000' });

    // Nothing is due any more; a second pass changes nothing.
    expect((await processAuctionTick(c.deps, chain))!.granted).toEqual([]);
    expect(await c.repos.market.salesOf(v.id)).toHaveLength(1);
  });

  it('marks a failed auction and keeps an unlinked winner waiting', async () => {
    const c = await setup();
    const failed = await auctioned(c, '1');
    const won = await auctioned(c, '2');
    const chain: AuctionReader = {
      address: CONTRACT,
      getAuction: async (id) =>
        reader(
          { 1: { status: 'failed' }, 2: { status: 'won', winner: BUYER_EVM, price: 1n } },
          id === 1n ? failed.ref : won.ref,
        ).getAuction(id),
    };
    const out = await processAuctionTick(c.deps, chain);
    expect(out).toMatchObject({ failed: [failed.row.id], waiting: [won.row.id] });
    expect((await c.repos.auctions.get(failed.row.id))!.status).toBe('failed');
    expect((await c.repos.auctions.get(won.row.id))!.status).toBe('won');
    expect(await c.repos.skills.owns(won.seller.id, won.v.id, 1)).toBe(true);
  });
});
