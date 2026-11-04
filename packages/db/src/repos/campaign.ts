// Campaign progress and chapter rewards (@skirm/shared CAMPAIGN_CHAPTERS). Realtime records each
// campaign match's result (`record`); the first result that meets a mission's objective clears it,
// and a chapter whose missions are all cleared grants its rewards once: the account-bound starter
// skill (a skill_ownership row with no token, like Flood Warden) and any cosmetic. `campaign_rewards`
// keys on (account, chapter), so a repeat or a race grants nothing twice.
//
// The reward skills are written by the system account and sealed by the api's vault
// (`ensureRewardSkills`, before any mission starts). Hidden-prompt rule: CAMPAIGN_SKILL_TEXT is
// sealed at that point and never returned by any API.
import { and, eq, sql } from 'drizzle-orm';
import {
  CAMPAIGN_CHAPTERS,
  campaignChapterOf,
  campaignMission,
  chapterComplete,
  cosmeticById,
  objectiveMet,
  type CampaignChapter,
  type CampaignResult,
} from '@skirm/shared';
import type { Executor } from '../client';
import { accounts, campaignProgress, campaignRewards, cosmeticsOwned, skillOwnership, skillVersions, skills } from '../schema';
import { SYSTEM_ACCOUNT_ID, SYSTEM_HANDLE } from '../starter';
import { RepoError, type SkillSealer } from '../types';
import { tx } from './util';

export type CampaignProgressRow = typeof campaignProgress.$inferSelect;
export type CampaignRewardRow = typeof campaignRewards.$inferSelect;

/** The sealed text of each chapter's reward skill, by skill id. Never returned by any API. */
export const CAMPAIGN_SKILL_TEXT: Readonly<Record<string, { prompt: string; reflexes: string }>> = {
  skl_01JBK0CAMPA1GNWATER0000001: {
    prompt:
      'Find every tile tagged spreads+liquid and each open gap one tile wide it can reach. Work out which gap the water reaches first from its spread interval. If you can stand beside that gap before then, go there and place a block in it. Then collect what the goal needs, nearest first, and carry it to the goal. Never end a tick on a tile the water enters next.',
    reflexes: 'If a spreads+liquid tile is next to an open gap and place_block is legal toward the gap, place it.',
  },
  skl_01JBK0CAMPA1GNF1RE00000001: {
    prompt:
      'Find every spreads+damages tile and the flammable tiles touching it. Plan a route to the collectibles and the goal that keeps at least one tile from fire. If fire sits on the only route and extinguish is legal toward it, put it out. Collect what the goal needs and walk to the goal.',
    reflexes: 'If a spreads+damages tile is next to you and extinguish is legal toward it, extinguish.',
  },
  skl_01JBK0CAMPA1GNN1GHT0000001: {
    prompt:
      'In fog or at night, remember every collectible and hazard tile you or a teammate has seen. Order the known collectibles so the walk through them to the goal is shortest, skipping any next to a spreading hazard, and explore toward the goal when none is known. Collect only what the goal needs, then go to the goal.',
    reflexes: 'Move toward the next known collectible; once the goal count is met, move toward the goal.',
  },
};

/** What `record` did: whether this result cleared the mission now, and the chapters it completed. */
export interface CampaignRecordResult {
  cleared: boolean;
  /** Cleared by this result (false when it was cleared already or the objective was missed). */
  newlyCleared: boolean;
  /** Chapters whose rewards this call granted. */
  granted: string[];
}

export class CampaignRepo {
  constructor(private readonly db: Executor) {}

  async progress(accountId: string): Promise<CampaignProgressRow[]> {
    return this.db.select().from(campaignProgress).where(eq(campaignProgress.accountId, accountId));
  }

  async rewards(accountId: string): Promise<CampaignRewardRow[]> {
    return this.db.select().from(campaignRewards).where(eq(campaignRewards.accountId, accountId));
  }

  /** The missions the account has cleared. */
  async cleared(accountId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ missionId: campaignProgress.missionId })
      .from(campaignProgress)
      .where(and(eq(campaignProgress.accountId, accountId), sql`${campaignProgress.clearedAt} is not null`));
    return new Set(rows.map((r) => r.missionId));
  }

  /**
   * One campaign match's result for the player (crew A). Counts an attempt, clears the mission the
   * first time the objective is met (keeping the fewest ticks), then grants any chapter now complete.
   * A void match (no result) is not recorded.
   */
  async record(accountId: string, missionId: string, matchId: string, result: CampaignResult, now = new Date()): Promise<CampaignRecordResult> {
    const mission = campaignMission(missionId);
    if (!mission) throw new RepoError('not_found', `no campaign mission ${missionId}`);
    const met = objectiveMet(mission.objective, result);
    return tx(this.db, async (t) => {
      const [before] = await t
        .select({ clearedAt: campaignProgress.clearedAt })
        .from(campaignProgress)
        .where(and(eq(campaignProgress.accountId, accountId), eq(campaignProgress.missionId, missionId)));
      const ticks = met ? result.ticks : null;
      await t
        .insert(campaignProgress)
        .values({ accountId, missionId, attempts: 1, clearedAt: met ? now : null, bestTicks: ticks, lastMatchId: matchId, updatedAt: now })
        .onConflictDoUpdate({
          target: [campaignProgress.accountId, campaignProgress.missionId],
          set: {
            attempts: sql`${campaignProgress.attempts} + 1`,
            lastMatchId: matchId,
            updatedAt: now,
            ...(met
              ? {
                  clearedAt: sql`coalesce(${campaignProgress.clearedAt}, ${now.toISOString()}::timestamptz)`,
                  bestTicks: sql`least(coalesce(${campaignProgress.bestTicks}, ${ticks}), ${ticks})`,
                }
              : {}),
          },
        });
      const granted = met ? await new CampaignRepo(t).grantDue(accountId, campaignChapterOf(missionId)) : [];
      return { cleared: met || !!before?.clearedAt, newlyCleared: met && !before?.clearedAt, granted };
    });
  }

  /**
   * Grants the rewards of every complete chapter (or just `only`) the account has not had yet.
   * Idempotent: the (account, chapter) key of campaign_rewards decides who grants.
   */
  async grantDue(accountId: string, only?: CampaignChapter): Promise<string[]> {
    const cleared = await this.cleared(accountId);
    const granted: string[] = [];
    for (const chapter of only ? [only] : CAMPAIGN_CHAPTERS) {
      if (!chapterComplete(chapter, cleared)) continue;
      const { skill, cosmetic } = chapter.rewards;
      const done = await tx(this.db, async (t) => {
        const rows = await t
          .insert(campaignRewards)
          .values({ accountId, chapterId: chapter.id, skillId: skill.id, cosmeticId: cosmetic ?? null })
          .onConflictDoNothing()
          .returning({ chapterId: campaignRewards.chapterId });
        if (!rows.length) return false;
        await t.insert(skillOwnership).values({ skillId: skill.id, version: skill.version, ownerId: accountId, tokenId: null }).onConflictDoNothing();
        if (cosmetic && cosmeticById(cosmetic))
          await t.insert(cosmeticsOwned).values({ accountId, itemId: cosmetic, source: `campaign:${chapter.id}` }).onConflictDoNothing();
        return true;
      });
      if (done) granted.push(chapter.id);
    }
    return granted;
  }

  /** Whether every chapter's reward skill is in place (sealed and held by the system account). */
  async rewardSkillsExist(): Promise<boolean> {
    for (const c of CAMPAIGN_CHAPTERS) {
      const [row] = await this.db
        .select({ v: skillVersions.version })
        .from(skillVersions)
        .where(and(eq(skillVersions.skillId, c.rewards.skill.id), eq(skillVersions.version, c.rewards.skill.version)));
      if (!row) return false;
    }
    return true;
  }

  /**
   * Writes the reward skills that are missing: account-bound (never minted or listed), created by
   * the system account, version 1 sealed by `sealer`. Fixed ids, so concurrent callers converge.
   */
  async ensureRewardSkills(sealer: SkillSealer): Promise<void> {
    for (const c of CAMPAIGN_CHAPTERS) {
      const def = c.rewards.skill;
      const [row] = await this.db
        .select({ v: skillVersions.version })
        .from(skillVersions)
        .where(and(eq(skillVersions.skillId, def.id), eq(skillVersions.version, def.version)));
      if (row) continue;
      const text = CAMPAIGN_SKILL_TEXT[def.id];
      if (!text) throw new RepoError('not_found', `no sealed text for campaign skill ${def.id}`);
      const sealed = await sealer.encryptSkill(text.prompt, text.reflexes);
      await tx(this.db, async (t) => {
        await t.insert(accounts).values({ id: SYSTEM_ACCOUNT_ID, handle: SYSTEM_HANDLE, system: true }).onConflictDoNothing();
        await t
          .insert(skills)
          .values({ id: def.id, creatorId: SYSTEM_ACCOUNT_ID, name: def.name, summary: def.summary, accountBound: true })
          .onConflictDoNothing();
        await t
          .insert(skillVersions)
          .values({
            skillId: def.id,
            version: def.version,
            name: def.name,
            summary: def.summary,
            requiresActions: [...def.requiresActions],
            handlesTags: [...def.handlesTags],
            royaltyBps: 0,
            promptSha256: sealed.promptSha256,
            ciphertext: sealed.ciphertext,
            iv: sealed.iv,
            authTag: sealed.authTag,
            wrappedKey: sealed.wrappedKey,
            keyId: sealed.keyId,
            status: 'draft',
          })
          .onConflictDoNothing();
      });
    }
  }
}
