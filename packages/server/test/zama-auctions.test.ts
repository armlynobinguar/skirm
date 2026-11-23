import { evmLinkMessage } from '@skirm/shared';
import { Wallet } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  AuctionCheckError,
  auctionSaleKey,
  auctionSkillRef,
  checkRegisteredAuction,
  createAuctionReader,
  grantWonAuctions,
  parseChainAuction,
  verifyEvmLink,
  type AuctionDueRow,
  type AuctionGrantRepos,
  type AuctionReader,
  type ChainAuction,
} from '../src/zama/auctions';

const CONTRACT = '0x00000000000000000000000000000000000a0c71';
const SELLER = '0x5e11e00000000000000000000000000000000001';
const WINNER = '0xb0b0000000000000000000000000000000000002';
const NOW = Date.parse('2026-11-23T12:00:00Z');
const REF = auctionSkillRef('skl_1', 2);

function chain(overrides: Partial<ChainAuction> = {}): ChainAuction {
  return {
    seller: SELLER,
    skillRef: REF.toLowerCase(),
    endTime: NOW / 1000 + 3600,
    status: 'open',
    bidders: 0,
    winner: '0x0000000000000000000000000000000000000000',
    price: 0n,
    ...overrides,
  };
}

/** A SkillAuction fake: one record per id; a missing id reads as status none, `throws` as RPC down. */
function fakeReader(records: Record<string, ChainAuction | 'throws'>): AuctionReader {
  return {
    address: CONTRACT,
    async getAuction(id) {
      const r = records[id.toString()];
      if (r === 'throws') throw new Error('rpc down');
      return r ?? chain({ status: 'none' });
    },
  };
}

function row(id: string, chainAuctionId: string, status = 'open'): AuctionDueRow {
  return { id, contractAddress: CONTRACT, chainAuctionId, skillId: 'skl_1', version: 2, sellerId: 'acc_seller', skillRef: REF, status, buyerId: null };
}

/** In-memory repos recording every write. */
function fakeRepos(rows: AuctionDueRow[], links: Record<string, string> = {}, owners = new Set(['acc_seller'])) {
  const writes: string[] = [];
  const sales = new Map<string, { id: string }>();
  const repos: AuctionGrantRepos = {
    auctions: {
      async due() {
        return rows;
      },
      async markWon(id, winner, price) {
        writes.push(`won ${id} ${winner} ${price}`);
      },
      async markGranted(id, buyerId, saleId) {
        writes.push(`granted ${id} ${buyerId} ${saleId}`);
      },
      async markFailed(id) {
        writes.push(`failed ${id}`);
      },
    },
    accounts: {
      async byEvmAddress(address) {
        const id = links[address.toLowerCase()];
        return id ? { id } : undefined;
      },
    },
    skills: {
      async owns(ownerId) {
        return owners.has(ownerId);
      },
    },
    market: {
      async recordSale(input) {
        const existing = sales.get(input.txHash);
        if (existing) return { sale: existing, duplicate: true };
        writes.push(`sale ${input.skillId}:${input.version} ${input.buyerId} ${input.sellerId} ${input.priceYocto} ${input.currency} ${input.txHash}`);
        const sale = { id: `sal_${sales.size + 1}` };
        sales.set(input.txHash, sale);
        owners.delete(input.sellerId!);
        owners.add(input.buyerId);
        return { sale, duplicate: false };
      },
    },
  };
  return { repos, writes };
}

const logger = { info: () => undefined, warn: () => undefined };

describe('auction helpers', () => {
  it('derives the skill reference and the sale key', () => {
    expect(auctionSkillRef('skl_1', 2)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(auctionSkillRef('skl_1', 2)).not.toBe(auctionSkillRef('skl_1', 3));
    expect(auctionSaleKey('0xABC', '7')).toBe('zama-auction:0xabc:7');
  });

  it('parses the contract tuple', () => {
    const a = parseChainAuction({ seller: SELLER.toUpperCase().replace('0X', '0x'), skillRef: REF, endTime: 10n, status: 3n, bidders: 4n, winner: WINNER, price: 55n });
    expect(a).toMatchObject({ seller: SELLER, status: 'won', bidders: 4, endTime: 10, price: 55n });
  });

  it('stays off without ZAMA_ENABLED or a deployed contract', () => {
    expect(createAuctionReader({})).toBeNull();
    expect(createAuctionReader({ ZAMA_ENABLED: '1' })).toBeNull(); // not deployed yet
    expect(createAuctionReader({ ZAMA_ENABLED: '1', ZAMA_AUCTION_ADDRESS: CONTRACT })?.address).toBe(CONTRACT);
  });

  it('verifies a signed EVM link for this account only', async () => {
    const wallet = Wallet.createRandom();
    const sig = await wallet.signMessage(evmLinkMessage('acc_1', wallet.address));
    expect(verifyEvmLink('acc_1', wallet.address, sig)).toBe(true);
    expect(verifyEvmLink('acc_2', wallet.address, sig)).toBe(false);
    expect(verifyEvmLink('acc_1', SELLER, sig)).toBe(false);
    expect(verifyEvmLink('acc_1', wallet.address, '0x1234')).toBe(false);
  });
});

describe('checkRegisteredAuction', () => {
  const input = { auctionId: 1n, sellerAddress: SELLER, skillId: 'skl_1', version: 2, nowMs: NOW };

  it('accepts the seller’s open auction of this version', async () => {
    await expect(checkRegisteredAuction(fakeReader({ 1: chain() }), input)).resolves.toMatchObject({ status: 'open' });
  });

  it('refuses an unknown, closed, ended, foreign or mismatched auction', async () => {
    const cases: [Record<string, ChainAuction>, string][] = [
      [{}, 'unknown_auction'],
      [{ 1: chain({ status: 'closing' }) }, 'not_open'],
      [{ 1: chain({ endTime: NOW / 1000 - 1 }) }, 'ended'],
      [{ 1: chain({ seller: WINNER }) }, 'wrong_seller'],
      [{ 1: chain({ skillRef: auctionSkillRef('skl_1', 3) }) }, 'wrong_skill'],
    ];
    for (const [records, code] of cases) {
      const err = await checkRegisteredAuction(fakeReader(records), input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuctionCheckError);
      expect((err as AuctionCheckError).code).toBe(code);
    }
  });
});

describe('grantWonAuctions', () => {
  it('grants a won auction to the linked buyer through recordSale, once', async () => {
    const reader = fakeReader({ 1: chain({ status: 'won', winner: WINNER, price: 55_000_000n, bidders: 3 }) });
    const { repos, writes } = fakeRepos([row('auc_1', '1')], { [WINNER]: 'acc_buyer' });
    const out = await grantWonAuctions({ repos, reader, logger, now: () => NOW });
    expect(out.granted).toEqual(['auc_1']);
    expect(writes).toEqual([
      `won auc_1 ${WINNER} 55000000`,
      `sale skl_1:2 acc_buyer acc_seller 55000000 cskirm zama-auction:${CONTRACT}:1`,
      'granted auc_1 acc_buyer sal_1',
    ]);
    // A retry (e.g. after a crash before markGranted) finds the recorded sale instead of selling again.
    const again = await grantWonAuctions({ repos, reader, logger, now: () => NOW });
    expect(again.granted).toEqual(['auc_1']);
    expect(writes.filter((w) => w.startsWith('sale'))).toHaveLength(1);
  });

  it('waits for a winner without a linked account, then grants once it links', async () => {
    const reader = fakeReader({ 1: chain({ status: 'won', winner: WINNER, price: 1n }) });
    const links: Record<string, string> = {};
    const { repos, writes } = fakeRepos([row('auc_1', '1')], links);
    expect((await grantWonAuctions({ repos, reader, logger, now: () => NOW })).waiting).toEqual(['auc_1']);
    expect(writes).toEqual([`won auc_1 ${WINNER} 1`]);
    links[WINNER] = 'acc_buyer';
    expect((await grantWonAuctions({ repos, reader, logger, now: () => NOW })).granted).toEqual(['auc_1']);
  });

  it('marks failed auctions, leaves unfinalized and unreadable ones, and skips other deployments', async () => {
    const reader = fakeReader({ 1: chain({ status: 'failed' }), 2: chain({ status: 'closing' }), 3: 'throws' });
    const other = { ...row('auc_4', '4'), contractAddress: '0x0000000000000000000000000000000000000bad' };
    const { repos, writes } = fakeRepos([row('auc_1', '1'), row('auc_2', '2'), row('auc_3', '3'), other]);
    const out = await grantWonAuctions({ repos, reader, logger, now: () => NOW });
    expect(out).toEqual({ granted: [], failed: ['auc_1'], waiting: [], pending: ['auc_2', 'auc_3'] });
    expect(writes).toEqual(['failed auc_1']);
  });

  it('holds the grant when the seller no longer owns the version or the chain record does not match', async () => {
    const reader = fakeReader({ 1: chain({ status: 'won', winner: WINNER, price: 1n }), 2: chain({ status: 'won', winner: WINNER, skillRef: auctionSkillRef('x', 1) }) });
    const { repos, writes } = fakeRepos([row('auc_1', '1'), row('auc_2', '2')], { [WINNER]: 'acc_buyer' }, new Set());
    const out = await grantWonAuctions({ repos, reader, logger, now: () => NOW });
    expect(out.waiting).toEqual(['auc_1', 'auc_2']);
    expect(writes.some((w) => w.startsWith('sale'))).toBe(false);
  });
});
