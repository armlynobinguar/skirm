// Sealed-bid skill auctions (SkillAuction on Sepolia): the off-chain side. A row maps an on-chain
// auction to the skill version it sells; bids never touch the database. The worker moves a row
// open → won → granted (the sale goes through MarketRepo.recordSale) or open → failed.
import { and, desc, eq, inArray, lte, or } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { skillAuctions } from '../schema';
import { RepoError } from '../types';
import { isUniqueViolation } from './util';

export type SkillAuctionRow = typeof skillAuctions.$inferSelect;
export type SkillAuctionStatus = 'open' | 'won' | 'granted' | 'failed';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export class AuctionsRepo {
  constructor(private readonly db: Executor) {}

  /** Records an auction the seller created on chain (the api checked it against the chain first). */
  async register(input: {
    contractAddress: string;
    chainAuctionId: string;
    skillId: string;
    version: number;
    sellerId: string;
    skillRef: string;
    endsAt: Date;
  }): Promise<SkillAuctionRow> {
    if (!ADDRESS_RE.test(input.contractAddress))
      throw new RepoError('invalid_address', 'contract address must be 20 bytes of hex');
    if (!/^[1-9][0-9]{0,77}$/.test(input.chainAuctionId))
      throw new RepoError('invalid_auction', 'auction id must be a positive integer');
    try {
      const [row] = await this.db
        .insert(skillAuctions)
        .values({
          id: newId('auc'),
          contractAddress: input.contractAddress.toLowerCase(),
          chainAuctionId: input.chainAuctionId,
          skillId: input.skillId,
          version: input.version,
          sellerId: input.sellerId,
          skillRef: input.skillRef.toLowerCase(),
          endsAt: input.endsAt,
        })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw new RepoError('duplicate', 'this auction is already registered');
      throw err;
    }
  }

  async get(id: string): Promise<SkillAuctionRow | undefined> {
    const [row] = await this.db.select().from(skillAuctions).where(eq(skillAuctions.id, id));
    return row;
  }

  /** Open auctions first (soonest end first), then the most recently ended ones. */
  async listRecent(limit = 50): Promise<SkillAuctionRow[]> {
    const open = await this.db
      .select()
      .from(skillAuctions)
      .where(eq(skillAuctions.status, 'open'))
      .orderBy(skillAuctions.endsAt)
      .limit(limit);
    const ended = await this.db
      .select()
      .from(skillAuctions)
      .where(inArray(skillAuctions.status, ['won', 'granted', 'failed']))
      .orderBy(desc(skillAuctions.endsAt))
      .limit(Math.max(0, limit - open.length));
    return [...open, ...ended];
  }

  /** Auctions of one skill (newest first). */
  async ofSkill(skillId: string): Promise<SkillAuctionRow[]> {
    return this.db
      .select()
      .from(skillAuctions)
      .where(eq(skillAuctions.skillId, skillId))
      .orderBy(desc(skillAuctions.createdAt));
  }

  /** The open auction of a version, if any (one at a time per version). */
  async openFor(skillId: string, version: number): Promise<SkillAuctionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(skillAuctions)
      .where(
        and(
          eq(skillAuctions.skillId, skillId),
          eq(skillAuctions.version, version),
          eq(skillAuctions.status, 'open'),
        ),
      )
      .limit(1);
    return row;
  }

  /** What the worker has to look at: open auctions past their end, and won ones not granted yet. */
  async due(now: Date, limit = 50): Promise<SkillAuctionRow[]> {
    return this.db
      .select()
      .from(skillAuctions)
      .where(
        or(
          and(eq(skillAuctions.status, 'open'), lte(skillAuctions.endsAt, now)),
          eq(skillAuctions.status, 'won'),
        ),
      )
      .orderBy(skillAuctions.endsAt)
      .limit(limit);
  }

  /** The chain finalized a sale: records the winner and price (still to be granted). */
  async markWon(id: string, winnerAddress: string, price: string): Promise<void> {
    await this.db
      .update(skillAuctions)
      .set({ status: 'won', winnerAddress: winnerAddress.toLowerCase(), price })
      .where(and(eq(skillAuctions.id, id), inArray(skillAuctions.status, ['open', 'won'])));
  }

  /** The winner got the version (`saleId` is the MarketRepo sale). */
  async markGranted(id: string, buyerId: string, saleId: string, now = new Date()): Promise<void> {
    await this.db
      .update(skillAuctions)
      .set({ status: 'granted', buyerId, saleId, settledAt: now })
      .where(eq(skillAuctions.id, id));
  }

  /** The chain says nothing sold (no bids, or below the reserve). */
  async markFailed(id: string, now = new Date()): Promise<void> {
    await this.db
      .update(skillAuctions)
      .set({ status: 'failed', settledAt: now })
      .where(and(eq(skillAuctions.id, id), eq(skillAuctions.status, 'open')));
  }
}
