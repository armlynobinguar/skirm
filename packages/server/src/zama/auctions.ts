// Sealed-bid skill auctions (Zama FHEVM on Sepolia): the server side of packages/fhevm
// SkillAuction.sol. The bids, the ranking and the refunds all stay on chain; the server only reads
// public auction records. It checks an auction a seller registers against the chain, and the worker
// grants each `Won` auction's buyer the skill version through the Exchange's own sale path
// (MarketRepo.recordSale, currency 'cskirm'). The buyer is found by the EVM address it linked to its
// account (signed message, `verifyEvmLink`).
//
// Gated by ZAMA_ENABLED. Env: SEPOLIA_RPC_URL, ZAMA_AUCTION_ADDRESS (default: the SkillAuction
// address in packages/fhevm/deployments/sepolia.json, via @skirm/fhevm/generated). The server holds
// no key here and sends no transaction.
import { SkillAuctionAbi, sepolia } from '@skirm/fhevm/generated';
import { auctionStatus, evmLinkMessage, skillRefPreimage, type AuctionStatus } from '@skirm/shared';
import { Contract, JsonRpcProvider, id as keccakUtf8, verifyMessage } from 'ethers';
import { zamaServerConfig } from './sealed-match';

/** An auction's `skillRef`: keccak256 of skillRefPreimage(skillId, version) (the web computes the same). */
export function auctionSkillRef(skillId: string, version: number): string {
  return keccakUtf8(skillRefPreimage(skillId, version));
}

/** SkillAuction.getAuction, as the server uses it (addresses lower-case). */
export interface ChainAuction {
  seller: string;
  skillRef: string;
  /** Unix seconds. */
  endTime: number;
  status: AuctionStatus;
  bidders: number;
  /** address(0) until won. */
  winner: string;
  /** Clearing price in cSKIRM base units (0 until won). */
  price: bigint;
}

/** Reads SkillAuction (mocked in tests). */
export interface AuctionReader {
  /** The contract address (lower-case). */
  readonly address: string;
  getAuction(auctionId: bigint): Promise<ChainAuction>;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** getAuction's tuple as ChainAuction (exported for tests). */
export function parseChainAuction(a: {
  seller: string;
  skillRef: string;
  endTime: bigint;
  status: bigint;
  bidders: bigint;
  winner: string;
  price: bigint;
}): ChainAuction {
  return {
    seller: String(a.seller).toLowerCase(),
    skillRef: String(a.skillRef).toLowerCase(),
    endTime: Number(a.endTime),
    status: auctionStatus(a.status),
    bidders: Number(a.bidders),
    winner: String(a.winner).toLowerCase(),
    price: BigInt(a.price),
  };
}

/** SkillAuction over JSON-RPC (ethers). */
export class EthersAuctionReader implements AuctionReader {
  readonly address: string;
  private readonly contract: Contract;

  constructor(address: string, rpcUrl: string) {
    this.address = address.toLowerCase();
    this.contract = new Contract(address, SkillAuctionAbi, new JsonRpcProvider(rpcUrl, sepolia.chainId, { staticNetwork: true }));
  }

  async getAuction(auctionId: bigint): Promise<ChainAuction> {
    return parseChainAuction(await this.contract.getFunction('getAuction')(auctionId));
  }
}

/** ZAMA_AUCTION_ADDRESS, else the deployments file; null when not deployed. */
export function auctionAddress(env: Record<string, string | undefined> = process.env): string | null {
  const override = env.ZAMA_AUCTION_ADDRESS?.trim();
  return override && ADDRESS_RE.test(override) ? override : sepolia.contracts.SkillAuction;
}

/** The reader when ZAMA_ENABLED is on and SkillAuction is deployed, else null. */
export function createAuctionReader(env: Record<string, string | undefined> = process.env): AuctionReader | null {
  const cfg = zamaServerConfig(env);
  const address = auctionAddress(env);
  if (!cfg.enabled || !address) return null;
  return new EthersAuctionReader(address, cfg.rpcUrl);
}

/** True when `signature` is `address` signing evmLinkMessage(accountId, address). */
export function verifyEvmLink(accountId: string, address: string, signature: string): boolean {
  if (!ADDRESS_RE.test(address)) return false;
  try {
    return verifyMessage(evmLinkMessage(accountId, address), signature).toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

export class AuctionCheckError extends Error {
  constructor(
    readonly code: 'unknown_auction' | 'not_open' | 'wrong_seller' | 'wrong_skill' | 'ended',
    message: string,
  ) {
    super(message);
    this.name = 'AuctionCheckError';
  }
}

/**
 * Checks an auction a seller registers: it exists, is open and not ended, was created by the
 * seller's linked address and sells exactly this skill version. Returns the chain record.
 */
export async function checkRegisteredAuction(
  reader: AuctionReader,
  input: { auctionId: bigint; sellerAddress: string; skillId: string; version: number; nowMs: number },
): Promise<ChainAuction> {
  const a = await reader.getAuction(input.auctionId);
  if (a.status === 'none') throw new AuctionCheckError('unknown_auction', 'no such auction on chain');
  if (a.status !== 'open') throw new AuctionCheckError('not_open', `the auction is ${a.status} on chain`);
  if (a.endTime * 1000 <= input.nowMs) throw new AuctionCheckError('ended', 'the auction has already ended');
  if (a.seller !== input.sellerAddress.toLowerCase())
    throw new AuctionCheckError('wrong_seller', 'the auction was created by another address');
  if (a.skillRef !== auctionSkillRef(input.skillId, input.version).toLowerCase())
    throw new AuctionCheckError('wrong_skill', 'the auction sells another skill version');
  return a;
}

/** The sale key a won auction is recorded under (idempotent across retries and workers). */
export function auctionSaleKey(contractAddress: string, chainAuctionId: string): string {
  return `zama-auction:${contractAddress.toLowerCase()}:${chainAuctionId}`;
}

/** The pieces of @skirm/db the grant needs (structural, like OwnerCacheRepos). */
export interface AuctionGrantRepos {
  auctions: {
    due(now: Date, limit?: number): Promise<AuctionDueRow[]>;
    markWon(id: string, winnerAddress: string, price: string): Promise<void>;
    markGranted(id: string, buyerId: string, saleId: string, now?: Date): Promise<void>;
    markFailed(id: string, now?: Date): Promise<void>;
  };
  accounts: { byEvmAddress(address: string): Promise<{ id: string } | undefined> };
  skills: { owns(ownerId: string, skillId: string, version: number): Promise<boolean> };
  market: {
    recordSale(input: {
      skillId: string;
      version: number;
      buyerId: string;
      sellerId?: string;
      txHash: string;
      priceYocto?: string;
      currency?: 'near' | 'cskirm';
    }): Promise<{ sale: { id: string }; duplicate: boolean }>;
  };
}

export interface AuctionDueRow {
  id: string;
  contractAddress: string;
  chainAuctionId: string;
  skillId: string;
  version: number;
  sellerId: string;
  skillRef: string;
  status: string;
  buyerId: string | null;
}

interface GrantLog {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/** What one pass did, per auction row id. */
export interface AuctionPassResult {
  granted: string[];
  failed: string[];
  /** Won on chain but not granted yet (winner not linked, seller no longer owns, or a refused sale). */
  waiting: string[];
  /** Still open or closing on chain (nobody finalized yet), or unreadable this time. */
  pending: string[];
}

/**
 * One pass over the auctions that are due: reads each from the chain and grants a won auction's
 * buyer the version (MarketRepo.recordSale, currency 'cskirm', keyed by auctionSaleKey so a retry
 * never sells twice), marks a failed one, and leaves the rest for the next pass. Rows of another
 * SkillAuction deployment than the reader's are skipped.
 */
export async function grantWonAuctions(
  deps: { repos: AuctionGrantRepos; reader: AuctionReader; logger: GrantLog; now: () => number },
  limit = 50,
): Promise<AuctionPassResult> {
  const { repos, reader, logger } = deps;
  const out: AuctionPassResult = { granted: [], failed: [], waiting: [], pending: [] };
  const now = new Date(deps.now());
  for (const row of await repos.auctions.due(now, limit)) {
    if (row.contractAddress.toLowerCase() !== reader.address) continue;
    let a: ChainAuction;
    try {
      a = await reader.getAuction(BigInt(row.chainAuctionId));
    } catch (err) {
      logger.warn('auction read failed', { auctionId: row.id, error: err instanceof Error ? err.message : String(err) });
      out.pending.push(row.id);
      continue;
    }
    if (a.skillRef !== row.skillRef.toLowerCase()) {
      logger.warn('auction skill reference mismatch', { auctionId: row.id });
      out.waiting.push(row.id);
      continue;
    }
    if (a.status === 'failed') {
      await repos.auctions.markFailed(row.id, now);
      out.failed.push(row.id);
      continue;
    }
    if (a.status !== 'won') {
      out.pending.push(row.id);
      continue;
    }
    if (row.status === 'open') await repos.auctions.markWon(row.id, a.winner, a.price.toString());
    const buyer = await repos.accounts.byEvmAddress(a.winner);
    if (!buyer) {
      logger.info('auction winner has no linked account yet', { auctionId: row.id });
      out.waiting.push(row.id);
      continue;
    }
    const txHash = auctionSaleKey(row.contractAddress, row.chainAuctionId);
    try {
      // A retry after a recorded sale finds it by its key (duplicate) whoever owns the version now.
      if (!(await repos.skills.owns(row.sellerId, row.skillId, row.version)) && !(await repos.skills.owns(buyer.id, row.skillId, row.version))) {
        logger.warn('auction seller no longer owns the version', { auctionId: row.id });
        out.waiting.push(row.id);
        continue;
      }
      const { sale } = await repos.market.recordSale({
        skillId: row.skillId,
        version: row.version,
        buyerId: buyer.id,
        sellerId: row.sellerId,
        txHash,
        priceYocto: a.price.toString(),
        currency: 'cskirm',
      });
      await repos.auctions.markGranted(row.id, buyer.id, sale.id, now);
      logger.info('auction license granted', { auctionId: row.id, saleId: sale.id });
      out.granted.push(row.id);
    } catch (err) {
      logger.warn('auction grant refused', { auctionId: row.id, error: err instanceof Error ? err.message : String(err) });
      out.waiting.push(row.id);
    }
  }
  return out;
}
