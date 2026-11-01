// Marketplace records: listings (the onchain approve is signed by the seller's wallet) and sales
// (verified by RPC before they are recorded). Prices are yoctoNEAR strings.
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import { splitSale } from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, listings, sales, skillOwnership, skillVersions, skills } from '../schema';
import { RepoError } from '../types';
import { unequipOthers } from './skills';
import { isUniqueViolation, tx } from './util';

export type ListingRow = typeof listings.$inferSelect;
export type SaleRow = typeof sales.$inferSelect;

const YOCTO_RE = /^[0-9]{1,40}$/;

export class MarketRepo {
  constructor(private readonly db: Executor) {}

  /** Records (or replaces) the seller's active listing of a minted version. */
  async list(input: {
    skillId: string;
    version: number;
    sellerId: string;
    priceYocto: string;
    txHash?: string | null;
  }): Promise<ListingRow> {
    if (!YOCTO_RE.test(input.priceYocto) || BigInt(input.priceYocto) <= 0n)
      throw new RepoError('invalid_price', 'price must be a positive yoctoNEAR integer string');
    return tx(this.db, async (t) => {
      const [ver] = await t
        .select({ status: skillVersions.status, tokenId: skillVersions.tokenId })
        .from(skillVersions)
        .where(
          and(eq(skillVersions.skillId, input.skillId), eq(skillVersions.version, input.version)),
        )
        .for('update');
      if (!ver) throw new RepoError('not_found', 'skill version not found');
      if (ver.status === 'draft' || !ver.tokenId)
        throw new RepoError('not_minted', 'only minted versions can be listed');
      const [own] = await t
        .select({ id: skillOwnership.id })
        .from(skillOwnership)
        .where(
          and(
            eq(skillOwnership.skillId, input.skillId),
            eq(skillOwnership.version, input.version),
            eq(skillOwnership.ownerId, input.sellerId),
          ),
        );
      if (!own) throw new RepoError('forbidden', 'only the owner can list this skill');
      await t
        .update(listings)
        .set({ status: 'cancelled', closedAt: new Date() })
        .where(
          and(
            eq(listings.skillId, input.skillId),
            eq(listings.version, input.version),
            eq(listings.status, 'active'),
          ),
        );
      const [row] = await t
        .insert(listings)
        .values({
          id: newId('lst'),
          skillId: input.skillId,
          version: input.version,
          tokenId: ver.tokenId,
          sellerId: input.sellerId,
          priceYocto: input.priceYocto,
          txHash: input.txHash ?? null,
          status: 'active',
        })
        .returning();
      await t
        .update(skillVersions)
        .set({ status: 'listed' })
        .where(
          and(eq(skillVersions.skillId, input.skillId), eq(skillVersions.version, input.version)),
        );
      return row!;
    });
  }

  async activeListing(skillId: string, version?: number): Promise<ListingRow | undefined> {
    const [row] = await this.db
      .select()
      .from(listings)
      .where(
        version === undefined
          ? and(eq(listings.skillId, skillId), eq(listings.status, 'active'))
          : and(
              eq(listings.skillId, skillId),
              eq(listings.version, version),
              eq(listings.status, 'active'),
            ),
      )
      .orderBy(desc(listings.createdAt))
      .limit(1);
    return row;
  }

  async activeListings(): Promise<ListingRow[]> {
    return this.db
      .select()
      .from(listings)
      .where(eq(listings.status, 'active'))
      .orderBy(desc(listings.createdAt));
  }

  async cancel(listingId: string, sellerId: string): Promise<void> {
    await tx(this.db, async (t) => {
      const [row] = await t
        .update(listings)
        .set({ status: 'cancelled', closedAt: new Date() })
        .where(
          and(
            eq(listings.id, listingId),
            eq(listings.sellerId, sellerId),
            eq(listings.status, 'active'),
          ),
        )
        .returning();
      if (row)
        await t
          .update(skillVersions)
          .set({ status: 'minted' })
          .where(
            and(eq(skillVersions.skillId, row.skillId), eq(skillVersions.version, row.version)),
          );
    });
  }

  /**
   * A verified purchase: closes the listing, moves ownership to the buyer (the seller's agents lose
   * the version from their slots) and logs the sale. Idempotent on the purchase tx hash.
   */
  async recordSale(input: {
    skillId: string;
    version: number;
    buyerId: string;
    txHash: string;
    priceYocto?: string;
  }): Promise<{ sale: SaleRow; duplicate: boolean }> {
    const existing = await this.saleByTx(input.txHash);
    if (existing) return { sale: existing, duplicate: true };
    try {
      const sale = await tx(this.db, async (t) => {
        const [listing] = await t
          .select()
          .from(listings)
          .where(
            and(
              eq(listings.skillId, input.skillId),
              eq(listings.version, input.version),
              eq(listings.status, 'active'),
            ),
          )
          .for('update');
        const [ver] = await t
          .select({
            tokenId: skillVersions.tokenId,
            status: skillVersions.status,
            bound: skills.accountBound,
          })
          .from(skillVersions)
          .innerJoin(skills, eq(skills.id, skillVersions.skillId))
          .where(
            and(eq(skillVersions.skillId, input.skillId), eq(skillVersions.version, input.version)),
          );
        if (!ver) throw new RepoError('not_found', 'skill version not found');
        // Only a minted token can change hands. Without this, a "sale" of a draft or of the
        // account-bound starter skill would delete every holder's ownership row below.
        if (ver.bound || ver.status === 'draft' || !ver.tokenId)
          throw new RepoError('not_minted', 'only minted skill versions can be sold');
        if (input.priceYocto !== undefined && !YOCTO_RE.test(input.priceYocto))
          throw new RepoError('invalid_price', 'price must be a yoctoNEAR integer string');
        const price = input.priceYocto ?? listing?.priceYocto;
        if (!price) throw new RepoError('not_listed', 'skill version is not listed');
        const [buyer] = await t
          .select({ near: accounts.nearAccountId })
          .from(accounts)
          .where(eq(accounts.id, input.buyerId));
        if (listing)
          await t
            .update(listings)
            .set({ status: 'sold', closedAt: new Date() })
            .where(eq(listings.id, listing.id));
        await t
          .delete(skillOwnership)
          .where(
            and(
              eq(skillOwnership.skillId, input.skillId),
              eq(skillOwnership.version, input.version),
            ),
          );
        await t.insert(skillOwnership).values({
          skillId: input.skillId,
          version: input.version,
          tokenId: ver.tokenId,
          ownerId: input.buyerId,
          ownerNear: buyer?.near ?? null,
        });
        await unequipOthers(t, input.skillId, input.version, input.buyerId);
        await t
          .update(skillVersions)
          .set({ status: 'minted' })
          .where(
            and(eq(skillVersions.skillId, input.skillId), eq(skillVersions.version, input.version)),
          );
        const [row] = await t
          .insert(sales)
          .values({
            id: newId('sal'),
            skillId: input.skillId,
            version: input.version,
            tokenId: ver.tokenId,
            listingId: listing?.id ?? null,
            sellerId: listing?.sellerId ?? null,
            buyerId: input.buyerId,
            priceYocto: price,
            txHash: input.txHash,
          })
          .returning();
        return row!;
      });
      return { sale, duplicate: false };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.saleByTx(input.txHash);
        if (raced) return { sale: raced, duplicate: true };
      }
      throw err;
    }
  }

  /**
   * Creator royalties earned per skill: the Formulas §6 royalty share (splitSale, floor per sale at
   * the sold version's royalty_bps) summed over resales. A primary sale (seller = creator) pays no
   * royalty, and a sale with no recorded seller is not counted. Skills with no royalty are absent.
   */
  async royaltiesByCreator(creatorId: string): Promise<Map<string, bigint>> {
    const rows = await this.db
      .select({
        skillId: sales.skillId,
        priceYocto: sales.priceYocto,
        royaltyBps: skillVersions.royaltyBps,
      })
      .from(sales)
      .innerJoin(
        skillVersions,
        and(eq(skillVersions.skillId, sales.skillId), eq(skillVersions.version, sales.version)),
      )
      .innerJoin(skills, eq(skills.id, sales.skillId))
      .where(
        and(
          eq(skills.creatorId, creatorId),
          isNotNull(sales.sellerId),
          ne(sales.sellerId, creatorId),
        ),
      );
    const out = new Map<string, bigint>();
    for (const r of rows) {
      const { royalty } = splitSale(BigInt(r.priceYocto), {
        primary: false,
        royaltyBps: r.royaltyBps,
      });
      if (royalty > 0n) out.set(r.skillId, (out.get(r.skillId) ?? 0n) + royalty);
    }
    return out;
  }

  /**
   * What the account took home as a seller, summed over its recorded sales: the Formulas §6 seller
   * share (splitSale at the sold version's royalty_bps; no royalty when the seller is the creator).
   */
  async salesNetBySeller(sellerId: string): Promise<bigint> {
    const rows = await this.db
      .select({
        priceYocto: sales.priceYocto,
        royaltyBps: skillVersions.royaltyBps,
        creatorId: skills.creatorId,
      })
      .from(sales)
      .innerJoin(
        skillVersions,
        and(eq(skillVersions.skillId, sales.skillId), eq(skillVersions.version, sales.version)),
      )
      .innerJoin(skills, eq(skills.id, sales.skillId))
      .where(eq(sales.sellerId, sellerId));
    let net = 0n;
    for (const r of rows)
      net += splitSale(BigInt(r.priceYocto), {
        primary: r.creatorId === sellerId,
        royaltyBps: r.royaltyBps,
      }).seller;
    return net;
  }

  /** Does the account have an active listing (its NEAR wallet approved the market)? */
  async hasActiveListing(sellerId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.sellerId, sellerId), eq(listings.status, 'active')))
      .limit(1);
    return !!row;
  }

  async saleByTx(txHash: string): Promise<SaleRow | undefined> {
    const [row] = await this.db.select().from(sales).where(eq(sales.txHash, txHash));
    return row;
  }

  async salesOf(skillId: string, limit = 20): Promise<SaleRow[]> {
    return this.db
      .select()
      .from(sales)
      .where(eq(sales.skillId, skillId))
      .orderBy(desc(sales.createdAt))
      .limit(limit);
  }
}
