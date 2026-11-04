// Quests, play streaks and achievements (@skirm/shared quests). Progress is derived from the
// account's ended v2 matches; this repo stores only what was claimed (quest_claims) and which
// achievements were first seen met (achievements_unlocked), with their soulbound badges.
//
// A quest reward refills the free allowance of the day, never past the daily allowance and only
// by credits actually spent today (credits still held by an open match come back on settle), so a
// claim never makes free credits out of nothing: holds still draw on the global free budget.
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { DEFAULT_LEDGER_CONFIG } from '@skirm/ledger';
import { achievementById, cosmeticById, type QuestMatch, type QuestPeriod } from '@skirm/shared';
import type { Executor } from '../client';
import {
  achievementsUnlocked,
  cosmeticsOwned,
  ledgerAccounts,
  questClaims,
  runHolds,
  v2Matches,
} from '../schema';
import { isUniqueViolation, rowsOf, tx, utcDay, type Clock } from './util';

export type QuestClaimRow = typeof questClaims.$inferSelect;
export type AchievementRow = typeof achievementsUnlocked.$inferSelect;
export type BadgeStatus = AchievementRow['badgeStatus'];

export type QuestClaimResult =
  | { ok: true; claim: QuestClaimRow; allowanceLeft: number }
  | { ok: false; error: 'already_claimed' | 'allowance_full' | 'unknown_account'; message: string };

export interface QuestsRepoOptions {
  clock?: Clock;
  /** Daily free allowance (LedgerRepo's config.freeAllowance). */
  freeAllowance?: number;
}

export class QuestsRepo {
  private readonly clock: Clock;
  private readonly freeAllowance: number;

  constructor(
    private readonly db: Executor,
    opts: QuestsRepoOptions = {},
  ) {
    this.clock = opts.clock ?? (() => Date.now());
    this.freeAllowance = opts.freeAllowance ?? DEFAULT_LEDGER_CONFIG.freeAllowance;
  }

  /** The repo's clock (ms), so callers pick the same quest windows the claims are written in. */
  now(): number {
    return this.clock();
  }

  /** The account's ended (not void) matches from its side, oldest first; `since` filters on ended_at. */
  async matches(accountId: string, since?: Date): Promise<QuestMatch[]> {
    const mine = or(eq(v2Matches.teamAAccountId, accountId), eq(v2Matches.teamBAccountId, accountId));
    const rows = await this.db
      .select({
        id: v2Matches.id,
        endedAt: v2Matches.endedAt,
        winner: v2Matches.winner,
        reason: v2Matches.reason,
        ticks: v2Matches.ticks,
        practice: v2Matches.practice,
        ranked: v2Matches.ranked,
        teamA: v2Matches.teamAAccountId,
        crews: v2Matches.crews,
        scoreA: v2Matches.scoreA,
        scoreB: v2Matches.scoreB,
        debriefs: v2Matches.debriefs,
      })
      .from(v2Matches)
      .where(
        and(
          eq(v2Matches.status, 'ended'),
          mine,
          since ? gte(v2Matches.endedAt, since) : undefined,
        ),
      )
      .orderBy(v2Matches.endedAt);
    const out: QuestMatch[] = [];
    for (const r of rows) {
      if (!r.winner || !r.endedAt) continue;
      const team = r.teamA === accountId ? 'A' : 'B';
      out.push({
        id: r.id,
        endedAt: r.endedAt.getTime(),
        outcome: r.winner === 'draw' ? 'draw' : r.winner === team ? 'win' : 'loss',
        practice: r.practice,
        ranked: r.ranked,
        reason: r.reason,
        ticks: r.ticks,
        tiers: (r.crews?.[team] ?? []).map((c) => c.tier),
        delivered: (team === 'A' ? r.scoreA : r.scoreB) ?? 0,
        talkSent: r.debriefs?.[team]?.talk?.sent ?? 0,
      });
    }
    return out;
  }

  /** UTC days (YYYY-MM-DD) the account ended a match on. */
  async playDays(accountId: string): Promise<string[]> {
    const res = await this.db.execute<{ day: string }>(sql`
      select distinct to_char(${v2Matches.endedAt} at time zone 'UTC', 'YYYY-MM-DD') as day
      from ${v2Matches}
      where ${v2Matches.status} = 'ended' and ${v2Matches.winner} is not null
        and ${v2Matches.endedAt} is not null
        and (${v2Matches.teamAAccountId} = ${accountId} or ${v2Matches.teamBAccountId} = ${accountId})`);
    return rowsOf<{ day: string }>(res).map((r) => r.day);
  }

  /** Claims of the given windows (period keys). */
  async claims(accountId: string, periodKeys: string[]): Promise<QuestClaimRow[]> {
    if (!periodKeys.length) return [];
    return this.db
      .select()
      .from(questClaims)
      .where(and(eq(questClaims.accountId, accountId), inArray(questClaims.periodKey, periodKeys)));
  }

  async claimCount(accountId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(questClaims)
      .where(eq(questClaims.accountId, accountId));
    return Number(r?.n ?? 0);
  }

  async allClaims(accountId: string): Promise<QuestClaimRow[]> {
    return this.db.select().from(questClaims).where(eq(questClaims.accountId, accountId));
  }

  /**
   * Records a completed quest's claim and refills the free allowance by up to `rewardCredits`.
   * The caller checks completion. Refused with `allowance_full` when nothing spent today is left
   * to refill (the claim stays open, so the player can claim after playing).
   * Locks ledger_accounts first, the ledger's own lock order.
   */
  async claim(input: {
    accountId: string;
    questId: string;
    period: QuestPeriod;
    periodKey: string;
    rewardCredits: number;
  }): Promise<QuestClaimResult> {
    try {
      return await tx(this.db, async (t) => {
        const now = this.clock();
        const today = utcDay(now);
        const [acc] = await t
          .select()
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.accountId, input.accountId))
          .for('update');
        if (!acc) return { ok: false, error: 'unknown_account', message: 'no ledger account' } as const;
        const [done] = await t
          .select({ questId: questClaims.questId })
          .from(questClaims)
          .where(
            and(
              eq(questClaims.accountId, input.accountId),
              eq(questClaims.questId, input.questId),
              eq(questClaims.periodKey, input.periodKey),
            ),
          );
        if (done) return { ok: false, error: 'already_claimed', message: 'quest already claimed' } as const;

        const left = acc.allowanceDay === today ? acc.allowanceLeft : this.freeAllowance;
        const [h] = await t
          .select({
            out: sql<number>`coalesce(sum(${runHolds.freeHeld} - ${runHolds.chargedFree}), 0)::int`,
          })
          .from(runHolds)
          .where(
            and(
              eq(runHolds.accountId, input.accountId),
              eq(runHolds.status, 'held'),
              eq(runHolds.day, today),
            ),
          );
        const spent = Math.max(0, this.freeAllowance - left - Number(h?.out ?? 0));
        const credited = Math.min(input.rewardCredits, spent);
        if (credited <= 0)
          return {
            ok: false,
            error: 'allowance_full',
            message: 'today’s free credits are full; the reward refills what you spend',
          } as const;

        const [claim] = await t
          .insert(questClaims)
          .values({
            accountId: input.accountId,
            questId: input.questId,
            period: input.period,
            periodKey: input.periodKey,
            rewardCredits: input.rewardCredits,
            credited,
            claimedAt: new Date(now),
          })
          .returning();
        await t
          .update(ledgerAccounts)
          .set({ allowanceLeft: left + credited, allowanceDay: today, updatedAt: new Date(now) })
          .where(eq(ledgerAccounts.accountId, input.accountId));
        return { ok: true, claim: claim!, allowanceLeft: left + credited } as const;
      });
    } catch (err) {
      if (isUniqueViolation(err))
        return { ok: false, error: 'already_claimed', message: 'quest already claimed' };
      throw err;
    }
  }

  // ---------- Achievements ----------

  async achievements(accountId: string): Promise<AchievementRow[]> {
    return this.db
      .select()
      .from(achievementsUnlocked)
      .where(eq(achievementsUnlocked.accountId, accountId))
      .orderBy(achievementsUnlocked.unlockedAt);
  }

  /**
   * Records achievements newly met (idempotent) and grants each one's cosmetic, if any, in the same
   * transaction. Returns every unlocked row.
   */
  async unlock(accountId: string, achievementIds: string[]): Promise<AchievementRow[]> {
    if (achievementIds.length) {
      await tx(this.db, async (t) => {
        const now = new Date(this.clock());
        const fresh = await t
          .insert(achievementsUnlocked)
          .values(achievementIds.map((achievementId) => ({ accountId, achievementId, unlockedAt: now })))
          .onConflictDoNothing()
          .returning({ id: achievementsUnlocked.achievementId });
        const items = fresh.flatMap((r) => {
          const item = achievementById(r.id)?.cosmetic;
          return item && cosmeticById(item) ? [{ accountId, itemId: item, source: `achievement:${r.id}` }] : [];
        });
        if (items.length) await t.insert(cosmeticsOwned).values(items).onConflictDoNothing();
      });
    }
    return this.achievements(accountId);
  }

  /** none | failed → pending, for one minter at a time. False when another mint holds it or it is done. */
  async startBadge(accountId: string, achievementId: string, owner: string, tokenId: string): Promise<boolean> {
    const rows = await this.db
      .update(achievementsUnlocked)
      .set({ badgeStatus: 'pending', badgeOwner: owner, badgeTokenId: tokenId })
      .where(
        and(
          eq(achievementsUnlocked.accountId, accountId),
          eq(achievementsUnlocked.achievementId, achievementId),
          inArray(achievementsUnlocked.badgeStatus, ['none', 'failed']),
        ),
      )
      .returning({ id: achievementsUnlocked.achievementId });
    return rows.length > 0;
  }

  async finishBadge(
    accountId: string,
    achievementId: string,
    status: Exclude<BadgeStatus, 'none' | 'pending'>,
    txHash?: string | null,
  ): Promise<AchievementRow | undefined> {
    const [row] = await this.db
      .update(achievementsUnlocked)
      .set({
        badgeStatus: status,
        badgeTx: txHash ?? null,
        badgeAt: status === 'failed' ? null : new Date(this.clock()),
      })
      .where(
        and(
          eq(achievementsUnlocked.accountId, accountId),
          eq(achievementsUnlocked.achievementId, achievementId),
        ),
      )
      .returning();
    return row;
  }
}
