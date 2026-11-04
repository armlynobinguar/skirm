// /quests*, /achievements*: daily and weekly quests drawn per UTC day and week, the play streak,
// and permanent achievements with optional soulbound badges (@skirm/shared quests).
// Progress is derived from the player's ended matches; a quest reward refills the day's free
// allowance (QuestsRepo.claim), an achievement may grant a premium cosmetic when it unlocks.
import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { AccountRow, AchievementRow, QuestClaimRow } from '@skirm/db';
import { badgeTokenId } from '@skirm/server';
import {
  ACHIEVEMENTS,
  achievementById,
  achievementStats,
  cosmeticById,
  drawQuests,
  playStreak,
  questProgress,
  questReward,
  questWindow,
  type QuestDef,
  type QuestMatch,
  type QuestWindow,
} from '@skirm/shared';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';

const iso = (d: Date | number | null | undefined) =>
  d === null || d === undefined ? null : new Date(d).toISOString();

function questView(q: QuestDef, w: QuestWindow, matches: readonly QuestMatch[], claim?: QuestClaimRow) {
  const progress = questProgress(q, w, matches);
  const done = progress >= q.target;
  return {
    id: q.id,
    period: q.period,
    title: q.title,
    target: q.target,
    progress,
    done,
    claimed: !!claim,
    claimable: done && !claim,
    rewardCredits: questReward(q.period),
    credited: claim?.credited ?? null,
  };
}

function badgeView(row: AchievementRow | undefined) {
  if (!row || row.badgeStatus === 'none') return null;
  return {
    status: row.badgeStatus,
    tokenId: row.badgeTokenId,
    txHash: row.badgeTx,
    owner: row.badgeOwner,
    mintedAt: iso(row.badgeAt),
  };
}

@Controller()
export class QuestsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  private async board(accountId: string) {
    const { quests } = this.deps.repos;
    const now = quests.now();
    const daily = questWindow('daily', now);
    const weekly = questWindow('weekly', now);
    const [matches, claims, days, credits] = await Promise.all([
      quests.matches(accountId, new Date(weekly.startsAt)),
      quests.claims(accountId, [...new Set([daily.key, weekly.key])]),
      quests.playDays(accountId),
      this.deps.repos.ledger.balance(accountId),
    ]);
    const claimOf = (q: QuestDef, w: QuestWindow) =>
      claims.find((c) => c.questId === q.id && c.periodKey === w.key);
    const section = (w: QuestWindow) => ({
      key: w.key,
      endsAt: iso(w.endsAt),
      quests: drawQuests(w).map((q) => questView(q, w, matches, claimOf(q, w))),
    });
    return {
      daily: section(daily),
      weekly: section(weekly),
      streak: playStreak(days, now),
      allowanceLeft: credits.allowanceLeft,
      windows: { daily, weekly },
      matches,
    };
  }

  @Get('quests')
  async list(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { daily, weekly, streak, allowanceLeft } = await this.board(account.id);
    return { daily, weekly, streak, allowanceLeft };
  }

  /**
   * Claims a finished quest of the current day or week. 404 when it is not drawn now, 409
   * `quest_incomplete`, `already_claimed`, or `allowance_full` (nothing spent today to refill).
   */
  @Post('quests/:id/claim')
  @HttpCode(200)
  async claim(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const board = await this.board(account.id);
    const found = (['daily', 'weekly'] as const)
      .map((p) => ({ w: board.windows[p], q: drawQuests(board.windows[p]).find((q) => q.id === id) }))
      .find((x) => x.q);
    if (!found?.q) throw notFound('quest');
    const { q, w } = found;
    if (questProgress(q, w, board.matches) < q.target)
      throw new ApiError(409, 'quest_incomplete', 'finish the quest first');
    const res = await this.deps.repos.quests.claim({
      accountId: account.id,
      questId: q.id,
      period: q.period,
      periodKey: w.key,
      rewardCredits: questReward(q.period),
    });
    if (!res.ok) {
      if (res.error === 'unknown_account') throw notFound('account');
      throw new ApiError(409, res.error, res.message);
    }
    return {
      quest: questView(q, w, board.matches, res.claim),
      credited: res.claim.credited,
      allowanceLeft: res.allowanceLeft,
    };
  }

  /** Records achievements newly met (granting their cosmetics) and returns every row. */
  private async syncAchievements(accountId: string) {
    const { quests } = this.deps.repos;
    const [matches, days, claimed, rows] = await Promise.all([
      quests.matches(accountId),
      quests.playDays(accountId),
      quests.claimCount(accountId),
      quests.achievements(accountId),
    ]);
    const streak = playStreak(days, quests.now());
    const stats = achievementStats(matches, streak.best, claimed);
    const have = new Set(rows.map((r) => r.achievementId));
    const fresh = ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.value(stats) >= a.target).map(
      (a) => a.id,
    );
    const unlocked = fresh.length ? await quests.unlock(accountId, fresh) : rows;
    return { stats, streak, unlocked };
  }

  @Get('achievements')
  async achievements(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { stats, streak, unlocked } = await this.syncAchievements(account.id);
    return {
      streak,
      achievements: ACHIEVEMENTS.map((a) => {
        const row = unlocked.find((r) => r.achievementId === a.id);
        const item = a.cosmetic ? cosmeticById(a.cosmetic) : undefined;
        return {
          id: a.id,
          title: a.title,
          detail: a.detail,
          target: a.target,
          progress: Math.min(a.target, a.value(stats)),
          unlocked: !!row,
          unlockedAt: iso(row?.unlockedAt),
          cosmetic: item ? { id: item.id, name: item.name } : null,
          badge: badgeView(row),
        };
      }),
    };
  }

  /**
   * Mints the achievement as a soulbound badge on the `badges` contract (ops key; a no-op locally,
   * status `local`). Once per player and achievement: a minted badge is returned as is.
   */
  @Post('achievements/:id/badge')
  @HttpCode(200)
  async mintBadge(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const def = achievementById(id);
    if (!def) throw notFound('achievement');
    const badges = this.deps.near.badges;
    if (badges.kind === 'near' && !account.nearAccountId)
      throw new ApiError(422, 'near_account_required', 'link a NEAR account to mint a badge');
    const { unlocked } = await this.syncAchievements(account.id);
    const row = unlocked.find((r) => r.achievementId === id);
    if (!row) throw new ApiError(409, 'not_unlocked', 'unlock the achievement first');
    if (row.badgeStatus === 'minted' || row.badgeStatus === 'local') return { badge: badgeView(row) };

    const owner = account.nearAccountId ?? account.id;
    const tokenId = badgeTokenId(id, account.id);
    if (!(await this.deps.repos.quests.startBadge(account.id, id, owner, tokenId)))
      throw new ApiError(409, 'mint_in_progress', 'this badge is being minted, try again shortly');
    try {
      const res = await badges.mint({
        accountId: account.id,
        achievementId: id,
        receiverId: owner,
        title: def.title,
        detail: def.detail,
        unlockedAtMs: row.unlockedAt.getTime(),
      });
      const done = await this.deps.repos.quests.finishBadge(
        account.id,
        id,
        res.status === 'local' ? 'local' : 'minted',
        res.txHash ?? null,
      );
      return { badge: badgeView(done) };
    } catch {
      await this.deps.repos.quests.finishBadge(account.id, id, 'failed');
      throw new ApiError(502, 'mint_failed', 'minting the badge on NEAR failed, try again');
    }
  }
}
