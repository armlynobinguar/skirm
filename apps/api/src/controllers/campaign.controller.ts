// /campaign*: the single-player campaign against the greedy bot (@skirm/shared CAMPAIGN_CHAPTERS).
// GET /campaign is the chapter map: every mission with its briefing, setup, objective and state
// (locked, open, cleared), and each chapter's rewards. POST /campaign/missions/:id/start checks the
// mission is unlocked and answers the exact v2_queue to send over the socket; realtime checks again,
// plays it as practice and records the result when the match ends (CampaignRepo.record), granting a
// completed chapter's starter skill and cosmetic once. Free on the greedy brain; with a model the
// player's crew holds and pays as in any practice match.
import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { AccountRow, CampaignProgressRow, CampaignRewardRow } from '@skirm/db';
import { v2BrainKind } from '@skirm/decision-engine/v2';
import { BOT_HANDLE, DIFF_MODS, holdFor, practiceRival, mapV2 } from '@skirm/engine/v2';
import {
  CAMPAIGN_CHAPTERS,
  campaignMission,
  chapterComplete,
  cosmeticById,
  missionUnlocked,
  objectiveLabel,
  type CampaignMission,
} from '@skirm/shared';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';

export type CampaignMissionStatus = 'locked' | 'open' | 'cleared';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

@Controller('campaign')
export class CampaignController {
  /** The reward skills are sealed once per process (and on a failure, tried again next call). */
  private ensured: Promise<void> | null = null;

  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  private ensureRewardSkills(): Promise<void> {
    this.ensured ??= this.deps.repos.campaign.ensureRewardSkills(this.deps.vault).catch((err: unknown) => {
      this.ensured = null;
      throw err;
    });
    return this.ensured;
  }

  /** Credits a mission holds from the player's crew (Standard talk), 0 on the greedy brain. */
  private costOf(m: CampaignMission): number {
    if (v2BrainKind(this.deps.config) === 'greedy') return 0;
    return holdFor(Array.from({ length: m.crewSize }, () => ({ tier: 'standard' as const })), false, DIFF_MODS[m.difficulty].ticks);
  }

  private missionView(m: CampaignMission, cleared: Set<string>, row: CampaignProgressRow | undefined) {
    const def = mapV2(m.mapId);
    const rival = practiceRival(m.difficulty, m.crewSize, def ? Math.min(3, def.starts.A.length, def.starts.B.length) : 3);
    const status: CampaignMissionStatus = cleared.has(m.id) ? 'cleared' : missionUnlocked(m.id, cleared) ? 'open' : 'locked';
    return {
      id: m.id,
      title: m.title,
      briefing: m.briefing,
      mapId: m.mapId,
      mapName: def?.name ?? m.mapId,
      difficulty: m.difficulty,
      crewSize: m.crewSize,
      objective: { ...m.objective, label: objectiveLabel(m.objective) },
      rival: { handle: BOT_HANDLE, size: rival.size, tier: rival.tier },
      costCredits: this.costOf(m),
      status,
      attempts: row?.attempts ?? 0,
      bestTicks: row?.bestTicks ?? null,
      clearedAt: iso(row?.clearedAt ?? null),
    };
  }

  private async view(accountId: string) {
    const { campaign } = this.deps.repos;
    const [rows, rewards] = await Promise.all([campaign.progress(accountId), campaign.rewards(accountId)]);
    return campaignView(rows, rewards, (m, cleared, row) => this.missionView(m, cleared, row), v2BrainKind(this.deps.config));
  }

  @Get()
  async get(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    await this.ensureRewardSkills();
    // A chapter cleared while a grant failed is granted here (idempotent).
    await this.deps.repos.campaign.grantDue(account.id);
    return this.view(account.id);
  }

  /** The v2_queue that plays this mission; 403 mission_locked until the missions before it are cleared. */
  @Post('missions/:id/start')
  @HttpCode(200)
  async start(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const m = campaignMission(id);
    if (!m) throw notFound('mission');
    const { campaign } = this.deps.repos;
    const cleared = await campaign.cleared(account.id);
    if (!missionUnlocked(m.id, cleared)) throw new ApiError(403, 'mission_locked', 'clear the missions before this one first');
    // Its chapter's skill must exist before the chapter can be completed.
    await this.ensureRewardSkills();
    const row = (await campaign.progress(account.id)).find((r) => r.missionId === m.id);
    return {
      mission: this.missionView(m, cleared, row),
      queue: { type: 'v2_queue' as const, ranked: false, opponent: 'bot' as const, mapId: m.mapId, difficulty: m.difficulty, mission: m.id },
    };
  }
}

/** GET /campaign's body: chapters in order, each with its missions, its state and its rewards. */
export function campaignView<M extends { status: CampaignMissionStatus }>(
  rows: CampaignProgressRow[],
  rewards: CampaignRewardRow[],
  mission: (m: CampaignMission, cleared: Set<string>, row: CampaignProgressRow | undefined) => M,
  brain: string,
) {
  const cleared = new Set(rows.filter((r) => r.clearedAt).map((r) => r.missionId));
  const byMission = new Map(rows.map((r) => [r.missionId, r]));
  const granted = new Map(rewards.map((r) => [r.chapterId, r]));
  const chapters = CAMPAIGN_CHAPTERS.map((c, i) => {
    const missions = c.missions.map((m) => mission(m, cleared, byMission.get(m.id)));
    const reward = granted.get(c.id);
    const cosmetic = c.rewards.cosmetic ? cosmeticById(c.rewards.cosmetic) : undefined;
    return {
      id: c.id,
      index: i + 1,
      title: c.title,
      blurb: c.blurb,
      unlocked: missions[0]?.status !== 'locked',
      complete: chapterComplete(c, cleared),
      cleared: missions.filter((m) => m.status === 'cleared').length,
      missions,
      rewards: {
        skill: { id: c.rewards.skill.id, version: c.rewards.skill.version, name: c.rewards.skill.name, summary: c.rewards.skill.summary, requires_actions: c.rewards.skill.requiresActions, handles_tags: c.rewards.skill.handlesTags },
        cosmetic: cosmetic ? { id: cosmetic.id, name: cosmetic.name, kind: cosmetic.kind } : null,
        granted: !!reward,
        grantedAt: iso(reward?.grantedAt ?? null),
      },
    };
  });
  const total = chapters.reduce((n, c) => n + c.missions.length, 0);
  return {
    brain,
    free: brain === 'greedy',
    progress: { cleared: cleared.size, total },
    chapters,
  };
}
