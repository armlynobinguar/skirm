// GET /campaign and POST /campaign/missions/:id/start (apps/api campaign.controller.ts).
import type { Difficulty } from '../realtime/protocol';

export type CampaignMissionStatus = 'locked' | 'open' | 'cleared';

export interface CampaignMissionView {
  id: string;
  title: string;
  briefing: string;
  mapId: string;
  mapName: string;
  difficulty: Difficulty;
  crewSize: 1 | 2 | 3;
  objective: { kind: 'win' | 'win_within' | 'shutout'; ticks?: number; label: string };
  rival: { handle: string; size: number; tier: 'quiet' | 'standard' | 'open' };
  /** Credits the crew holds on a model brain; 0 on the offline greedy brain. */
  costCredits: number;
  status: CampaignMissionStatus;
  attempts: number;
  bestTicks: number | null;
  clearedAt: string | null;
}

export interface CampaignChapterView {
  id: string;
  index: number;
  title: string;
  blurb: string;
  unlocked: boolean;
  complete: boolean;
  cleared: number;
  missions: CampaignMissionView[];
  rewards: {
    skill: { id: string; version: number; name: string; summary: string; requires_actions: string[]; handles_tags: string[] };
    cosmetic: { id: string; name: string; kind: 'outfit' | 'hair' } | null;
    granted: boolean;
    grantedAt: string | null;
  };
}

export interface Campaign {
  brain: string;
  free: boolean;
  progress: { cleared: number; total: number };
  chapters: CampaignChapterView[];
}

export interface CampaignStart {
  mission: CampaignMissionView;
  queue: { type: 'v2_queue'; ranked: false; opponent: 'bot'; mapId: string; difficulty: Difficulty; mission: string };
}
