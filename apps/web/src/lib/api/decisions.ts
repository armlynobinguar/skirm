// GET /v2/matches/:id/decisions (apps/api src/decisions.ts): a player's decision timeline of an
// ended match, for the debrief's "why did it do that?". Own crew only (practice adds the bot's);
// skill text only for skills the caller wrote.
import type { Side } from './types';

export interface DecisionSkillRef {
  id: string;
  version: number;
  /** 'model': the agent's model named it; 'inferred': the only equipped skill needing that verb. */
  by: 'model' | 'inferred';
}

export interface MatchDecision {
  tick: number;
  agentId: string;
  /** What the agent saw, summarised from its own fogged view. */
  observed: string;
  action: string;
  reason: 'chosen' | 'timeout' | 'error' | 'illegal';
  outcome?: string[];
  effect?: string;
  said?: string;
  thought?: string;
  skill: DecisionSkillRef | null;
}

export interface MatchPlan {
  tick: number;
  text: string | null;
  why: string | null;
  /** A bought skill shaped this plan, so its text was never kept. */
  hidden?: true;
}

export type MomentKind = 'hazard_breach' | 'switch' | 'supply_drop' | 'goal';

export interface MatchMoment {
  tick: number;
  kind: MomentKind;
  team: Side;
  agentId: string | null;
  text: string;
}

export interface DecisionCrew {
  team: Side;
  /** The caller's own crew (false: the practice bot). */
  own: boolean;
  brain: string;
  agents: { id: string; name: string; role: string; skills: { id: string; version: number }[] }[];
  plans: MatchPlan[];
  decisions: MatchDecision[];
  moments: MatchMoment[];
}

export interface DecisionSkill {
  id: string;
  version: number;
  name: string;
  /** The caller wrote it: `prompt` is their own text. */
  mine: boolean;
  prompt?: string;
}

export interface MatchDecisions {
  matchId: string;
  you: Side;
  ticks: number;
  crews: DecisionCrew[];
  skills: DecisionSkill[];
}
