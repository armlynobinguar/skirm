// /zama/evm-link and /zama/auctions (sealed skill auctions), with SkillAuction mocked.
import { evmLinkMessage } from '@skirm/shared';
import { auctionSkillRef, type AuctionReader, type ChainAuction } from '@skirm/server';
import { Wallet } from 'ethers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

const CONTRACT = '0x00000000000000000000000000000000000a0c71';

/** SkillAuction fake: records by id; anything else reads as status none. */
class FakeAuctions implements AuctionReader {
  readonly address = CONTRACT;
  records = new Map<string, ChainAuction>();
  async getAuction(id: bigint): Promise<ChainAuction> {
    return (
      this.records.get(id.toString()) ?? {
        seller: '0x0000000000000000000000000000000000000000',
        skillRef: '0x' + '0'.repeat(64),
        endTime: 0,
        status: 'none',
        bidders: 0,
        winner: '0x0000000000000000000000000000000000000000',
        price: 0n,
      }
    );
  }
}

let h: Harness;
let chain: FakeAuctions;
let seller: UserClient;
let bidder: UserClient;
let skillId: string;
const sellerWallet = Wallet.createRandom();
const bidderWallet = Wallet.createRandom();

async function link(user: UserClient, wallet: { address: string; signMessage(m: string): Promise<string> }) {
  const signature = await wallet.signMessage(evmLinkMessage(user.accountId, wallet.address));
  return user.put('/zama/evm-link', { address: wallet.address, signature });
}

beforeAll(async () => {
  chain = new FakeAuctions();
  h = await setup({ deps: { auctions: chain } });
  seller = await h.as('seller');
  bidder = await h.as('bidder');
  skillId = (await seller.post('/skills', SAMPLE_SKILL)).body.id;
  await seller.post(`/skills/${skillId}/mint`);
});
afterAll(() => h.close());

describe('EVM link', () => {
  it('links an address proven by its signature, once per address', async () => {
    expect((await seller.get('/zama/evm-link')).body).toEqual({ address: null });
    // Signed for another account: refused.
    const foreign = await bidderWallet.signMessage(evmLinkMessage(seller.accountId, bidderWallet.address));
    expect((await bidder.put('/zama/evm-link', { address: bidderWallet.address, signature: foreign })).status).toBe(422);

    const res = await link(seller, sellerWallet);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ address: sellerWallet.address.toLowerCase() });
    expect((await seller.get('/zama/evm-link')).body).toEqual({ address: sellerWallet.address.toLowerCase() });

    const sig = await sellerWallet.signMessage(evmLinkMessage(bidder.accountId, sellerWallet.address));
    expect((await bidder.put('/zama/evm-link', { address: sellerWallet.address, signature: sig })).status).toBe(409);
    expect((await link(bidder, bidderWallet)).status).toBe(200);
  });
});

describe('auctions', () => {
  const open = (overrides: Partial<ChainAuction> = {}): ChainAuction => ({
    seller: sellerWallet.address.toLowerCase(),
    skillRef: auctionSkillRef(skillId, 1).toLowerCase(),
    endTime: Math.floor(Date.now() / 1000) + 3600,
    status: 'open',
    bidders: 0,
    winner: '0x0000000000000000000000000000000000000000',
    price: 0n,
    ...overrides,
  });

  it('registers the seller’s on-chain auction of its minted version, and lists it publicly', async () => {
    chain.records.set('1', open());
    chain.records.set('2', open({ seller: bidderWallet.address.toLowerCase() }));
    // Not the owner, then another seller's auction.
    expect((await bidder.post('/zama/auctions', { skillId, version: 1, auctionId: '1' })).status).toBe(403);
    const foreign = await seller.post('/zama/auctions', { skillId, version: 1, auctionId: '2' });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error.code).toBe('wrong_seller');
    expect((await seller.post('/zama/auctions', { skillId, version: 1, auctionId: '9' })).body.error.code).toBe('unknown_auction');

    const res = await seller.post('/zama/auctions', { skillId, version: 1, auctionId: '1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      auctionId: '1',
      skill: { id: skillId, version: 1, name: SAMPLE_SKILL.name },
      seller: { handle: 'seller' },
      status: 'open',
      price: null,
      buyer: null,
    });
    // One open auction per version, and no fixed-price listing beside it.
    chain.records.set('3', open());
    expect((await seller.post('/zama/auctions', { skillId, version: 1, auctionId: '3' })).status).toBe(409);
    expect((await seller.post(`/market/${skillId}/listing`, { priceYocto: '1000', txHash: 'approve' })).status).toBe(409);

    const list = await h.http().get('/zama/auctions');
    expect(list.status).toBe(200);
    expect(list.body.contract).toBe(CONTRACT);
    expect(list.body.auctions).toHaveLength(1);
    expect((await h.http().get(`/zama/auctions?skillId=${skillId}`)).body.auctions).toHaveLength(1);
  });

  it('needs a session and a linked address to register', async () => {
    expect((await h.http().post('/zama/auctions').send({ skillId, version: 1, auctionId: '1' })).status).toBe(401);
    const other = await h.as('nolink');
    const res = await other.post('/zama/auctions', { skillId, version: 1, auctionId: '1' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('evm_link_required');
  });

  it('answers 404 when the feature is off', async () => {
    const off = await setup();
    try {
      expect((await off.http().get('/zama/auctions')).status).toBe(404);
    } finally {
      await off.close();
    }
  });
});
