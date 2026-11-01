// The engine's half of a crew's debrief: per-agent counts, the MVP, talk and the goal report. The
// server adds what the engine cannot know (Elo, credits, the registry write).
import type { Difficulty } from './difficulty';
import { evaluateGoals, type GoalOutcome } from './goals';
import type { Team } from './map';
import type { AgentState, MatchState } from './match';

export interface AgentReport {
  agentId: string;
  name: string;
  delivered: number;
  /** Themed verbs and switches used, plus digs a Digger finished. */
  used: number;
  picks: number;
}

export interface CrewReport {
  /** Agent id of the crew's MVP (null for an empty crew). */
  mvp: string | null;
  goals: GoalOutcome[];
  /** Messages the crew sent, and rival team messages its agents overheard. */
  talk: { sent: number; overheard: number };
  verbs: number;
  /** Switches used: this crew's and the rival's. */
  switches: { mine: number; rival: number };
  steals: number;
  agents: AgentReport[];
}

/** MVP score: a delivery is worth three, every verb and pickup one. */
export const mvpScore = (a: Pick<AgentState, 'delivered' | 'used' | 'picks'>) => a.delivered * 3 + a.used + a.picks;

/** The crew's MVP: highest mvpScore, the earlier slot on a tie. */
export function mvpOf(s: MatchState, team: Team): string | null {
  let best: AgentState | null = null;
  for (const a of s.agents) if (a.team === team && (!best || mvpScore(a) > mvpScore(best))) best = a;
  return best?.id ?? null;
}

export function crewReport(s: MatchState, team: Team, difficulty: Difficulty = s.difficulty): CrewReport {
  const T = s.tally[team];
  const rival = team === 'A' ? 'B' : 'A';
  return {
    mvp: mvpOf(s, team),
    goals: evaluateGoals(s, team, difficulty),
    talk: { sent: T.sent, overheard: T.overheard },
    verbs: T.verbs,
    switches: { mine: T.switches, rival: s.tally[rival].switches },
    steals: T.steals,
    agents: s.agents.filter((a) => a.team === team).map((a) => ({ agentId: a.id, name: a.name, delivered: a.delivered, used: a.used, picks: a.picks })),
  };
}
