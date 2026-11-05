// Community maps (apps/api community-maps.controller.ts; docs/backend-contract.md, Community maps).
// Players draw v2 maps in the map editor, save drafts and publish them for practice and casual play.
import type { MapDefV2, MapIssue } from '@skirm/engine/v2';

export type CommunityMapStatus = 'draft' | 'published';

export interface CommunityMap {
  id: string;
  name: string;
  /** The official map whose look the board borrows. */
  theme: string;
  author: string;
  status: CommunityMapStatus;
  plays: number;
  likes: number;
  /** Browsing signed in: whether the caller liked it. */
  liked?: boolean;
  /** The skirm.map/v2 JSON (a draft's may not be valid yet). */
  map: MapDefV2;
  balance?: BalanceReport;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface BalanceRun {
  seed: string;
  difficulty: string;
  size: number;
  swapped: boolean;
  winner: 'A' | 'B' | 'draw';
  side: 'left' | 'right' | 'draw';
  reason: string;
  decidedBy: string;
  score: { A: number; B: number };
  ticks: number;
}

export interface BalanceReport {
  runs: BalanceRun[];
  /** Wins by the half the winning crew started on (every seed is played both ways round). */
  wins: { left: number; right: number; draw: number };
  fair: boolean;
  playable: boolean;
  ok: boolean;
  problems: string[];
}

export interface TestPlayResult {
  valid: boolean;
  issues: MapIssue[];
  balance?: BalanceReport;
}

export interface CommunityMapList {
  sort: 'new' | 'popular';
  maps: CommunityMap[];
}

export interface MyCommunityMaps {
  maps: CommunityMap[];
  maxDrafts: number;
  publishPerDay: number;
}

export interface CommunityMapBody {
  name?: string;
  theme?: string;
  map?: MapDefV2;
}
