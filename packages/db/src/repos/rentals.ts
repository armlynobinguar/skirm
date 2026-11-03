// Agent rentals (the prototype's "Agent rentals" earn-back line; the 5% platform fee is the
// market's). An owner offers one agent at a price per match; a renter pays through `market.rent`
// and gets a one-match pass, used up when that match starts. Agents stay offchain, so the pass is
// the whole grant: the agent plays with its owner's skills and its owner keeps it.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, agents, rentalOffers, rentals } from '../schema';
import { RepoError } from '../types';

export type RentalOfferRow = typeof rentalOffers.$inferSelect;
export type RentalRow = typeof rentals.$inferSelect;

/** An active offer with what a renter sees: the agent's public stats and its owner. */
export interface RentalOfferView {
  offerId: string;
  agentId: string;
  name: string;
  role: string;
  vision: number;
  comms: number;
  tier: string;
  ownerId: string;
  ownerHandle: string;
  /** Where `market.rent` pays the owner; null while the owner has no NEAR account linked. */
  ownerNearAccountId: string | null;
  priceYocto: string;
}

export interface RecordRentalInput {
  offerId: string;
  renterId: string;
  priceYocto: string;
  feeYocto: string;
  ownerProceedsYocto: string;
  txHash: string;
}

export class RentalsRepo {
  constructor(private readonly db: Executor) {}

  /**
   * Sets (price) or ends (null) the owner's offer for one agent. A new price replaces the active
   * offer, so passes bought at the old price keep pointing at the offer they paid.
   */
  async setOffer(ownerId: string, agentId: string, priceYocto: string | null): Promise<RentalOfferRow | null> {
    const [agent] = await this.db.select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.id, agentId));
    if (!agent || agent.ownerId !== ownerId) throw new RepoError('not_found', 'agent not found');
    if (priceYocto !== null && !(BigInt(priceYocto) > 0n)) throw new RepoError('invalid_price', 'price must be above 0');
    await this.db
      .update(rentalOffers)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(rentalOffers.agentId, agentId), eq(rentalOffers.active, true)));
    if (priceYocto === null) return null;
    const [row] = await this.db.insert(rentalOffers).values({ id: newId('rof'), agentId, ownerId, priceYocto }).returning();
    return row!;
  }

  async offerFor(agentId: string): Promise<RentalOfferRow | undefined> {
    const [row] = await this.db
      .select()
      .from(rentalOffers)
      .where(and(eq(rentalOffers.agentId, agentId), eq(rentalOffers.active, true)));
    return row;
  }

  async getOffer(offerId: string): Promise<RentalOfferRow | undefined> {
    const [row] = await this.db.select().from(rentalOffers).where(eq(rentalOffers.id, offerId));
    return row;
  }

  /** Active offers, cheapest first, optionally leaving one account's own out. */
  async offers(opts: { excludeOwner?: string; limit?: number } = {}): Promise<RentalOfferView[]> {
    const rows = await this.db
      .select({
        offerId: rentalOffers.id,
        agentId: agents.id,
        name: agents.name,
        role: agents.role,
        vision: agents.vision,
        comms: agents.comms,
        tier: agents.tier,
        ownerId: accounts.id,
        ownerHandle: accounts.handle,
        ownerNearAccountId: accounts.nearAccountId,
        priceYocto: rentalOffers.priceYocto,
      })
      .from(rentalOffers)
      .innerJoin(agents, eq(agents.id, rentalOffers.agentId))
      .innerJoin(accounts, eq(accounts.id, rentalOffers.ownerId))
      .where(
        and(
          eq(rentalOffers.active, true),
          opts.excludeOwner ? sql`${rentalOffers.ownerId} <> ${opts.excludeOwner}` : undefined,
        ),
      )
      .orderBy(asc(rentalOffers.priceYocto), asc(rentalOffers.createdAt))
      .limit(opts.limit ?? 100);
    return rows.map((r) => ({ ...r, priceYocto: String(r.priceYocto) }));
  }

  async byTx(txHash: string): Promise<RentalRow | undefined> {
    const [row] = await this.db.select().from(rentals).where(eq(rentals.txHash, txHash));
    return row;
  }

  /** Records a verified payment as a one-match pass. A transaction is recorded once (unique tx). */
  async record(input: RecordRentalInput): Promise<RentalRow> {
    const offer = await this.getOffer(input.offerId);
    if (!offer) throw new RepoError('not_found', 'rental offer not found');
    if (offer.ownerId === input.renterId) throw new RepoError('own_agent', 'you own this agent');
    const [row] = await this.db
      .insert(rentals)
      .values({
        id: newId('rnt'),
        offerId: offer.id,
        agentId: offer.agentId,
        ownerId: offer.ownerId,
        renterId: input.renterId,
        priceYocto: input.priceYocto,
        feeYocto: input.feeYocto,
        ownerProceedsYocto: input.ownerProceedsYocto,
        txHash: input.txHash,
      })
      .onConflictDoNothing({ target: rentals.txHash })
      .returning();
    if (row) return row;
    const done = await this.byTx(input.txHash);
    if (!done || done.renterId !== input.renterId || done.offerId !== input.offerId)
      throw new RepoError('duplicate_tx', 'this transaction was already used');
    return done;
  }

  /** The renter's passes not used yet, newest first. */
  async unusedPasses(renterId: string): Promise<RentalRow[]> {
    return this.db
      .select()
      .from(rentals)
      .where(and(eq(rentals.renterId, renterId), isNull(rentals.matchId)))
      .orderBy(desc(rentals.createdAt));
  }

  /** Agents among `agentIds` the renter holds an unused pass for. */
  async rentable(renterId: string, agentIds: string[]): Promise<string[]> {
    if (!agentIds.length) return [];
    const rows = await this.db
      .selectDistinct({ agentId: rentals.agentId })
      .from(rentals)
      .where(and(eq(rentals.renterId, renterId), inArray(rentals.agentId, agentIds), isNull(rentals.matchId)));
    return rows.map((r) => r.agentId);
  }

  /**
   * Uses one unused pass per agent for `matchId` (the oldest first). Fails, changing nothing, when
   * a pass is missing, e.g. two matches racing for the same pass.
   */
  async consume(renterId: string, agentIds: string[], matchId: string, now = new Date()): Promise<void> {
    for (const agentId of agentIds) {
      const [pass] = await this.db
        .select({ id: rentals.id })
        .from(rentals)
        .where(and(eq(rentals.renterId, renterId), eq(rentals.agentId, agentId), isNull(rentals.matchId)))
        .orderBy(asc(rentals.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!pass) throw new RepoError('no_rental', 'no unused rental for this agent');
      await this.db
        .update(rentals)
        .set({ matchId, usedAt: now })
        .where(and(eq(rentals.id, pass.id), isNull(rentals.matchId)));
    }
  }

  /** What an owner earned from rentals, after the platform fee, in yoctoNEAR. */
  async proceedsFor(ownerId: string): Promise<bigint> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${rentals.ownerProceedsYocto}), 0)::text` })
      .from(rentals)
      .where(eq(rentals.ownerId, ownerId));
    return BigInt(row?.total ?? '0');
  }
}
