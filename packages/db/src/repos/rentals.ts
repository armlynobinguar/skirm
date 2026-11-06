// Agent rentals (the prototype's "Agent rentals" earn-back line; the 5% platform fee is the
// market's). An owner offers one agent at a price per match; a renter pays through `market.rent`
// and gets a one-match pass, used up when that match starts. Agents stay offchain, so the pass is
// the whole grant: the agent plays with its owner's skills and its owner keeps it.
// While NEAR_RENTALS_ONCHAIN is off a rental is paid in credits instead (payWithCredits): the
// renter's paid credits, the owner's share credited, in one transaction.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, agents, rentalOffers, rentals } from '../schema';
import { RepoError } from '../types';
import { LedgerRepo, type LedgerRepoOptions } from './ledger';
import { tx } from './util';

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

/** A rental paid in credits; `key` makes a retry of the same click return the same pass. */
export interface CreditRentalInput {
  offerId: string;
  renterId: string;
  /** Client nonce: the pass's `tx_hash` is `credits:<offerId>:<key>`. */
  key: string;
  priceCredits: number;
  /** Credited to the owner (price minus the platform fee). */
  ownerCredits: number;
  /** The offer's yocto price and its split, recorded on the pass like an onchain rental's. */
  priceYocto: string;
  feeYocto: string;
  ownerProceedsYocto: string;
}

/** `tx_hash` of a credit rental (never a NEAR hash: those are base58 without a colon). */
export const creditRentalRef = (offerId: string, key: string) => `credits:${offerId}:${key}`;

export class RentalsRepo {
  constructor(
    private readonly db: Executor,
    private readonly ledgerOpts: LedgerRepoOptions = {},
  ) {}

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

  /**
   * Pays a rental in credits: spends the renter's paid credits (never the free allowance), credits
   * the owner's share and records the pass, all or nothing. A retry with the same key returns the
   * pass it already bought and charges nothing (`charged: false`). Refused with
   * `insufficient_credits` { need, have } when the renter is short.
   */
  async payWithCredits(input: CreditRentalInput): Promise<{ pass: RentalRow; charged: boolean }> {
    const ref = creditRentalRef(input.offerId, input.key);
    const done = await this.byTx(ref);
    if (done) {
      if (done.renterId !== input.renterId || done.offerId !== input.offerId)
        throw new RepoError('duplicate_tx', 'this payment key was already used');
      return { pass: done, charged: false };
    }
    const offer = await this.getOffer(input.offerId);
    if (!offer) throw new RepoError('not_found', 'rental offer not found');
    if (offer.ownerId === input.renterId) throw new RepoError('own_agent', 'you own this agent');
    if (!offer.active) throw new RepoError('not_offered', 'this agent is no longer offered for rent');
    const pass = await tx(this.db, async (t) => {
      const [row] = await t
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
          txHash: ref,
        })
        .onConflictDoNothing({ target: rentals.txHash })
        .returning();
      // A concurrent retry with the same key got there first: it pays, this one charges nothing.
      if (!row) return undefined;
      const ledger = new LedgerRepo(t, this.ledgerOpts);
      const spent = await ledger.spend({ accountId: input.renterId, amount: input.priceCredits, ref: `rental:${row.id}`, kind: 'rental' });
      if (!spent.ok)
        throw new RepoError(spent.error, spent.message, spent.need !== undefined ? { need: spent.need, have: spent.have } : undefined);
      if (input.ownerCredits > 0) {
        const paid = await ledger.topUp({ accountId: offer.ownerId, credits: input.ownerCredits, receipt: `rental:${row.id}`, note: 'rental' });
        if (!paid.ok) throw new RepoError(paid.error, paid.message);
      }
      return row;
    });
    if (pass) return { pass, charged: true };
    const raced = await this.byTx(ref);
    if (!raced || raced.renterId !== input.renterId || raced.offerId !== input.offerId)
      throw new RepoError('duplicate_tx', 'this payment key was already used');
    return { pass: raced, charged: false };
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
    // One transaction (a savepoint when the caller already holds one): a missing pass for any agent
    // rolls back the passes already marked for the others, and FOR UPDATE SKIP LOCKED only works
    // inside a transaction.
    await tx(this.db, async (t) => {
      for (const agentId of agentIds) {
        const [pass] = await t
          .select({ id: rentals.id })
          .from(rentals)
          .where(and(eq(rentals.renterId, renterId), eq(rentals.agentId, agentId), isNull(rentals.matchId)))
          .orderBy(asc(rentals.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!pass) throw new RepoError('no_rental', 'no unused rental for this agent');
        const used = await t
          .update(rentals)
          .set({ matchId, usedAt: now })
          .where(and(eq(rentals.id, pass.id), isNull(rentals.matchId)))
          .returning({ id: rentals.id });
        if (!used.length) throw new RepoError('no_rental', 'the rental pass was used by another match');
      }
    });
  }

  /**
   * What an owner earned from rentals paid in NEAR, after the platform fee, in yoctoNEAR. Credit
   * rentals are left out: their share arrived as credits (ledger `topup`, note `rental`).
   */
  async proceedsFor(ownerId: string): Promise<bigint> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${rentals.ownerProceedsYocto}), 0)::text` })
      .from(rentals)
      .where(and(eq(rentals.ownerId, ownerId), sql`${rentals.txHash} not like 'credits:%'`));
    return BigInt(row?.total ?? '0');
  }
}
