// Writer backing (contracts/backing): rounds, backers' stakes and the royalty payouts routed to a
// round. In `near` mode these rows mirror the backing contract's events; in `credits` mode (the
// keyless local stack) they are the record itself and royalties come from mirrored sales
// (`settleFromSales`). Amounts are yoctoNEAR strings; the arithmetic is @skirm/shared's, the same
// as the contract's.
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import {
  backerEntitled,
  backingCap,
  splitRoyalty,
  splitSale,
  type BackingRoundStatus,
} from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import {
  accounts,
  backingPayouts,
  backingRounds,
  backings,
  sales,
  skillVersions,
  skills,
} from '../schema';
import { RepoError } from '../types';
import { isUniqueViolation, tx } from './util';

export type BackingRoundRow = typeof backingRounds.$inferSelect;
export type BackingRow = typeof backings.$inferSelect;
export type BackingPayoutRow = typeof backingPayouts.$inferSelect;
export type BackingMode = 'credits' | 'near';

/** A round as lists show it: terms, progress and who wrote it. */
export interface BackingRoundView {
  id: string;
  writerId: string;
  writerHandle: string;
  writerNearAccountId: string | null;
  skillId: string | null;
  skillName: string | null;
  shareBps: number;
  capMultipleBps: number;
  maxRaiseYocto: string;
  raisedYocto: string;
  backers: number;
  status: BackingRoundStatus;
  mode: BackingMode;
  chainRoundId: string | null;
  royaltiesInYocto: string;
  backersEarnedYocto: string;
  /** What the backers can earn at most: raised × cap multiple. */
  capYocto: string;
  createdAt: string;
  closedAt: string | null;
}

/** One backer's position: stake, what it earned, what is left to pull. */
export interface BackingPositionView {
  backingId: string;
  round: BackingRoundView;
  stakeYocto: string;
  /** floor(stake · earned / raised): the backer's part of the round's earnings so far. */
  earnedYocto: string;
  claimedYocto: string;
  /** Earned and not pulled yet (on a cancelled round: the stake, until refunded). */
  claimableYocto: string;
  /** The most this stake can ever earn: stake × cap multiple. */
  capYocto: string;
  refunded: boolean;
}

export interface OpenRoundInput {
  writerId: string;
  skillId: string | null;
  shareBps: number;
  capMultipleBps: number;
  maxRaiseYocto: string;
  mode: BackingMode;
  chainRoundId?: string | null;
  /** Mirror of a chain round that already has stakes (near mode). */
  createdAt?: Date;
}

const big = (v: string | number | bigint | null | undefined) => BigInt(v ?? 0);

const ROUND_COLUMNS = {
  id: backingRounds.id,
  writerId: backingRounds.writerId,
  writerHandle: accounts.handle,
  writerNearAccountId: accounts.nearAccountId,
  skillId: backingRounds.skillId,
  skillName: skills.name,
  shareBps: backingRounds.shareBps,
  capMultipleBps: backingRounds.capMultipleBps,
  maxRaiseYocto: backingRounds.maxRaiseYocto,
  raisedYocto: backingRounds.raisedYocto,
  backers: backingRounds.backers,
  status: backingRounds.status,
  mode: backingRounds.mode,
  chainRoundId: backingRounds.chainRoundId,
  royaltiesInYocto: backingRounds.royaltiesInYocto,
  backersEarnedYocto: backingRounds.backersEarnedYocto,
  createdAt: backingRounds.createdAt,
  closedAt: backingRounds.closedAt,
};

type RoundSelect = {
  [K in keyof typeof ROUND_COLUMNS]: unknown;
} & { createdAt: Date; closedAt: Date | null };

function toView(r: RoundSelect): BackingRoundView {
  const raised = big(r.raisedYocto as string);
  return {
    id: r.id as string,
    writerId: r.writerId as string,
    writerHandle: r.writerHandle as string,
    writerNearAccountId: (r.writerNearAccountId as string | null) ?? null,
    skillId: (r.skillId as string | null) ?? null,
    skillName: (r.skillName as string | null) ?? null,
    shareBps: r.shareBps as number,
    capMultipleBps: r.capMultipleBps as number,
    maxRaiseYocto: String(r.maxRaiseYocto),
    raisedYocto: raised.toString(),
    backers: r.backers as number,
    status: r.status as BackingRoundStatus,
    mode: r.mode as BackingMode,
    chainRoundId: (r.chainRoundId as string | null) ?? null,
    royaltiesInYocto: String(r.royaltiesInYocto),
    backersEarnedYocto: String(r.backersEarnedYocto),
    capYocto: backingCap(raised, r.capMultipleBps as number).toString(),
    createdAt: r.createdAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
  };
}

/** What a backer may pull now from a round (see BackingPositionView.claimableYocto). */
export function claimableOf(
  round: Pick<BackingRoundRow, 'status' | 'raisedYocto' | 'backersEarnedYocto'>,
  backing: Pick<BackingRow, 'stakeYocto' | 'claimedYocto' | 'refunded'>,
): bigint {
  if (round.status === 'cancelled') return backing.refunded ? 0n : big(backing.stakeYocto);
  if (round.status !== 'closed') return 0n;
  const owed =
    backerEntitled(big(backing.stakeYocto), big(round.backersEarnedYocto), big(round.raisedYocto)) -
    big(backing.claimedYocto);
  return owed > 0n ? owed : 0n;
}

export class BackingRepo {
  constructor(private readonly db: Executor) {}

  /** Opens a round. A writer has at most one open round at a time (`round_open`). */
  async openRound(input: OpenRoundInput): Promise<BackingRoundRow> {
    if (input.skillId) {
      const [s] = await this.db
        .select({ creatorId: skills.creatorId })
        .from(skills)
        .where(eq(skills.id, input.skillId));
      if (!s) throw new RepoError('not_found', 'skill not found');
      if (s.creatorId !== input.writerId)
        throw new RepoError('forbidden', 'only the skill’s writer can open a round for it');
    }
    return tx(this.db, async (t) => {
      if (input.mode === 'credits') {
        const [open] = await t
          .select({ id: backingRounds.id })
          .from(backingRounds)
          .where(and(eq(backingRounds.writerId, input.writerId), eq(backingRounds.status, 'open')))
          .for('update');
        if (open) throw new RepoError('round_open', 'close your open round before opening another');
      }
      try {
        const [row] = await t
          .insert(backingRounds)
          .values({
            id: newId('brd'),
            writerId: input.writerId,
            skillId: input.skillId,
            shareBps: input.shareBps,
            capMultipleBps: input.capMultipleBps,
            maxRaiseYocto: input.maxRaiseYocto,
            mode: input.mode,
            chainRoundId: input.chainRoundId ?? null,
            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
          })
          .returning();
        return row!;
      } catch (err) {
        if (isUniqueViolation(err))
          throw new RepoError('duplicate_round', 'this chain round is already mirrored');
        throw err;
      }
    });
  }

  async getRound(id: string): Promise<BackingRoundRow | undefined> {
    const [row] = await this.db.select().from(backingRounds).where(eq(backingRounds.id, id));
    return row;
  }

  async roundByChainId(chainRoundId: string): Promise<BackingRoundRow | undefined> {
    const [row] = await this.db
      .select()
      .from(backingRounds)
      .where(eq(backingRounds.chainRoundId, chainRoundId));
    return row;
  }

  /** The round row, locked for the rest of the transaction. */
  async lockRound(id: string): Promise<BackingRoundRow | undefined> {
    const [row] = await this.db
      .select()
      .from(backingRounds)
      .where(eq(backingRounds.id, id))
      .for('update');
    return row;
  }

  /** Rounds, newest first, by writer, skill (a skill's rounds include its writer's all-skill rounds) or status. */
  async rounds(
    filter: { writerId?: string; skillId?: string; status?: BackingRoundStatus; limit?: number } = {},
  ): Promise<BackingRoundView[]> {
    let skillWriter: string | undefined;
    if (filter.skillId) {
      const [s] = await this.db
        .select({ creatorId: skills.creatorId })
        .from(skills)
        .where(eq(skills.id, filter.skillId));
      if (!s) return [];
      skillWriter = s.creatorId;
    }
    const rows = await this.db
      .select(ROUND_COLUMNS)
      .from(backingRounds)
      .innerJoin(accounts, eq(accounts.id, backingRounds.writerId))
      .leftJoin(skills, eq(skills.id, backingRounds.skillId))
      .where(
        and(
          filter.writerId ? eq(backingRounds.writerId, filter.writerId) : undefined,
          filter.skillId
            ? and(
                eq(backingRounds.writerId, skillWriter!),
                sql`(${backingRounds.skillId} is null or ${backingRounds.skillId} = ${filter.skillId})`,
              )
            : undefined,
          filter.status ? eq(backingRounds.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(backingRounds.createdAt))
      .limit(Math.min(filter.limit ?? 50, 100));
    return rows.map(toView);
  }

  async roundView(id: string): Promise<BackingRoundView | undefined> {
    const [row] = await this.db
      .select(ROUND_COLUMNS)
      .from(backingRounds)
      .innerJoin(accounts, eq(accounts.id, backingRounds.writerId))
      .leftJoin(skills, eq(skills.id, backingRounds.skillId))
      .where(eq(backingRounds.id, id));
    return row ? toView(row) : undefined;
  }

  async backingOf(roundId: string, backerId: string): Promise<BackingRow | undefined> {
    const [row] = await this.db
      .select()
      .from(backings)
      .where(and(eq(backings.roundId, roundId), eq(backings.backerId, backerId)));
    return row;
  }

  async backingsOf(roundId: string): Promise<BackingRow[]> {
    return this.db
      .select()
      .from(backings)
      .where(eq(backings.roundId, roundId))
      .orderBy(asc(backings.createdAt));
  }

  /**
   * Adds `stakeYocto` to the backer's stake (credits mode; the caller locked the round with
   * `lockRound` and checked the terms). Keeps the round's raise and backer count in step.
   */
  async addStake(roundId: string, backerId: string, stakeYocto: bigint): Promise<BackingRow> {
    const prev = await this.backingOf(roundId, backerId);
    const stake = big(prev?.stakeYocto) + stakeYocto;
    return this.setStake(roundId, backerId, stake);
  }

  /** Sets the backer's total stake (near mode: the `backed` event's `stake`) and recounts the round. */
  async setStake(roundId: string, backerId: string, stakeYocto: bigint): Promise<BackingRow> {
    return tx(this.db, async (t) => {
      const [row] = await t
        .insert(backings)
        .values({ id: newId('bkg'), roundId, backerId, stakeYocto: stakeYocto.toString() })
        .onConflictDoUpdate({
          target: [backings.roundId, backings.backerId],
          set: { stakeYocto: stakeYocto.toString(), updatedAt: new Date() },
        })
        .returning();
      await t
        .update(backingRounds)
        .set({
          raisedYocto: sql`(select coalesce(sum(${backings.stakeYocto}), 0) from ${backings} where ${backings.roundId} = ${roundId})`,
          backers: sql`(select count(*) from ${backings} where ${backings.roundId} = ${roundId})`,
        })
        .where(eq(backingRounds.id, roundId));
      return row!;
    });
  }

  async setStatus(roundId: string, status: 'closed' | 'cancelled', at = new Date()): Promise<void> {
    await this.db
      .update(backingRounds)
      .set({ status, closedAt: at })
      .where(and(eq(backingRounds.id, roundId), eq(backingRounds.status, 'open')));
  }

  async setClaimed(backingId: string, claimedYocto: bigint): Promise<void> {
    await this.db
      .update(backings)
      .set({ claimedYocto: claimedYocto.toString(), updatedAt: new Date() })
      .where(eq(backings.id, backingId));
  }

  async markRefunded(backingId: string): Promise<boolean> {
    const rows = await this.db
      .update(backings)
      .set({ refunded: true, updatedAt: new Date() })
      .where(and(eq(backings.id, backingId), eq(backings.refunded, false)))
      .returning({ id: backings.id });
    return rows.length > 0;
  }

  /** The backer's row, locked for the rest of the transaction. */
  async lockBacking(roundId: string, backerId: string): Promise<BackingRow | undefined> {
    const [row] = await this.db
      .select()
      .from(backings)
      .where(and(eq(backings.roundId, roundId), eq(backings.backerId, backerId)))
      .for('update');
    return row;
  }

  /**
   * Records royalty income routed to a round and adds the backers' part to its earnings. A sale
   * (per round) or a distribute transaction is recorded once; a repeat returns false.
   */
  async recordPayout(input: {
    roundId: string;
    saleId?: string | null;
    txHash?: string | null;
    royaltyYocto: bigint;
    toBackersYocto: bigint;
    toWriterYocto: bigint;
    /** near mode: the contract's `backers_earned` after the payout (else: earned + toBackers). */
    backersEarnedYocto?: bigint;
  }): Promise<boolean> {
    return tx(this.db, async (t) => {
      const [row] = await t
        .insert(backingPayouts)
        .values({
          id: newId('bpo'),
          roundId: input.roundId,
          saleId: input.saleId ?? null,
          txHash: input.txHash ?? null,
          royaltyYocto: input.royaltyYocto.toString(),
          toBackersYocto: input.toBackersYocto.toString(),
          toWriterYocto: input.toWriterYocto.toString(),
        })
        .onConflictDoNothing()
        .returning({ id: backingPayouts.id });
      if (!row) return false;
      await t
        .update(backingRounds)
        .set({
          royaltiesInYocto: sql`${backingRounds.royaltiesInYocto} + ${input.royaltyYocto.toString()}::numeric`,
          backersEarnedYocto:
            input.backersEarnedYocto !== undefined
              ? input.backersEarnedYocto.toString()
              : sql`${backingRounds.backersEarnedYocto} + ${input.toBackersYocto.toString()}::numeric`,
        })
        .where(eq(backingRounds.id, input.roundId));
      return true;
    });
  }

  async payouts(roundId: string, limit = 50): Promise<BackingPayoutRow[]> {
    return this.db
      .select()
      .from(backingPayouts)
      .where(eq(backingPayouts.roundId, roundId))
      .orderBy(desc(backingPayouts.createdAt))
      .limit(limit);
  }

  /**
   * Resales of the writer's skills (the creator royalty is paid) after `since`, oldest first, with
   * the royalty each paid, limited to one skill when `skillId` is set.
   */
  async royaltySales(
    writerId: string,
    since: Date,
    skillId: string | null,
  ): Promise<{ saleId: string; skillId: string; royaltyYocto: bigint; createdAt: Date }[]> {
    const rows = await this.db
      .select({
        saleId: sales.id,
        skillId: sales.skillId,
        priceYocto: sales.priceYocto,
        royaltyBps: skillVersions.royaltyBps,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .innerJoin(skills, eq(skills.id, sales.skillId))
      .innerJoin(
        skillVersions,
        and(eq(skillVersions.skillId, sales.skillId), eq(skillVersions.version, sales.version)),
      )
      .where(
        and(
          eq(skills.creatorId, writerId),
          isNotNull(sales.sellerId),
          ne(sales.sellerId, writerId),
          sql`${sales.createdAt} > ${since.toISOString()}`,
          skillId ? eq(sales.skillId, skillId) : undefined,
        ),
      )
      .orderBy(asc(sales.createdAt));
    return rows
      .map((r) => ({
        saleId: r.saleId,
        skillId: r.skillId,
        royaltyYocto: splitSale(big(r.priceYocto), { primary: false, royaltyBps: r.royaltyBps })
          .royalty,
        createdAt: r.createdAt,
      }))
      .filter((r) => r.royaltyYocto > 0n);
  }

  /**
   * Credits mode: routes the writer's royalties from resales since each round closed. Each sale
   * goes to the oldest closed round that covers its skill and still has room under the cap
   * (rounds never share a sale); a sale no round can take stays the writer's. Returns the payouts
   * recorded.
   */
  async settleFromSales(writerId: string): Promise<number> {
    const rounds = await this.db
      .select()
      .from(backingRounds)
      .where(
        and(
          eq(backingRounds.writerId, writerId),
          eq(backingRounds.status, 'closed'),
          eq(backingRounds.mode, 'credits'),
        ),
      )
      .orderBy(asc(backingRounds.closedAt));
    const open = rounds.filter(
      (r) => r.closedAt && big(r.backersEarnedYocto) < backingCap(big(r.raisedYocto), r.capMultipleBps),
    );
    if (!open.length) return 0;
    const since = open.reduce((m, r) => (r.closedAt! < m ? r.closedAt! : m), open[0]!.closedAt!);
    const candidates = await this.royaltySales(writerId, since, null);
    if (!candidates.length) return 0;
    const done = new Set(
      (
        await this.db
          .select({ saleId: backingPayouts.saleId })
          .from(backingPayouts)
          .innerJoin(backingRounds, eq(backingRounds.id, backingPayouts.roundId))
          .where(
            and(
              eq(backingRounds.writerId, writerId),
              inArray(
                backingPayouts.saleId,
                candidates.map((c) => c.saleId),
              ),
            ),
          )
      ).map((r) => r.saleId),
    );
    const earned = new Map(open.map((r) => [r.id, big(r.backersEarnedYocto)]));
    let recorded = 0;
    for (const sale of candidates) {
      if (done.has(sale.saleId)) continue;
      const round = open.find((r) => {
        if (r.closedAt! >= sale.createdAt) return false;
        if (r.skillId && r.skillId !== sale.skillId) return false;
        return earned.get(r.id)! < backingCap(big(r.raisedYocto), r.capMultipleBps);
      });
      if (!round) continue;
      const split = splitRoyalty(sale.royaltyYocto, {
        shareBps: round.shareBps,
        capMultipleBps: round.capMultipleBps,
        raised: big(round.raisedYocto),
        earned: earned.get(round.id)!,
      });
      const ok = await this.recordPayout({
        roundId: round.id,
        saleId: sale.saleId,
        royaltyYocto: sale.royaltyYocto,
        toBackersYocto: split.toBackers,
        toWriterYocto: split.toWriter,
      });
      if (ok) {
        earned.set(round.id, earned.get(round.id)! + split.toBackers);
        recorded++;
      }
    }
    return recorded;
  }

  /**
   * near mode: royalties the writer has earned on resales since the round closed that have not
   * been routed to it with `distribute` yet (the gross royalty; the contract splits it).
   */
  async owedYocto(round: BackingRoundRow): Promise<bigint> {
    if (round.status !== 'closed' || !round.closedAt) return 0n;
    if (big(round.backersEarnedYocto) >= backingCap(big(round.raisedYocto), round.capMultipleBps))
      return 0n;
    const salesSince = await this.royaltySales(round.writerId, round.closedAt, round.skillId);
    const gross = salesSince.reduce((s, r) => s + r.royaltyYocto, 0n);
    const owed = gross - big(round.royaltiesInYocto);
    return owed > 0n ? owed : 0n;
  }

  /** The backer's positions, newest first. */
  async positions(backerId: string): Promise<BackingPositionView[]> {
    const rows = await this.db
      .select({ ...ROUND_COLUMNS, b: backings })
      .from(backings)
      .innerJoin(backingRounds, eq(backingRounds.id, backings.roundId))
      .innerJoin(accounts, eq(accounts.id, backingRounds.writerId))
      .leftJoin(skills, eq(skills.id, backingRounds.skillId))
      .where(eq(backings.backerId, backerId))
      .orderBy(desc(backings.createdAt));
    return rows.map(({ b, ...r }) => positionView(toView(r), b));
  }

  async position(roundId: string, backerId: string): Promise<BackingPositionView | undefined> {
    const [round, b] = await Promise.all([this.roundView(roundId), this.backingOf(roundId, backerId)]);
    return round && b ? positionView(round, b) : undefined;
  }
}

function positionView(round: BackingRoundView, b: BackingRow): BackingPositionView {
  const stake = big(b.stakeYocto);
  const earned = backerEntitled(stake, big(round.backersEarnedYocto), big(round.raisedYocto));
  return {
    backingId: b.id,
    round,
    stakeYocto: stake.toString(),
    earnedYocto: earned.toString(),
    claimedYocto: String(b.claimedYocto),
    claimableYocto: claimableOf(
      { status: round.status, raisedYocto: round.raisedYocto, backersEarnedYocto: round.backersEarnedYocto },
      b,
    ).toString(),
    capYocto: backingCap(stake, round.capMultipleBps).toString(),
    refunded: b.refunded,
  };
}
