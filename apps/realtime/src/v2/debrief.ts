// The debrief each crew gets with v2_end (its own numbers only): per-agent counts from the engine's
// agent state (MVP = delivered × 3 + used + picks), messages sent and rival team talk overheard from
// the tick events, the goal report, credits held / used / returned, the Elo change and the registry line.
import { evaluateGoals, type Difficulty, type MatchEvent, type MatchState, type Team } from '@skirm/engine/v2';
import type { V2Debrief, V2DebriefAgent } from '@skirm/server';

/** Counts the talk the debrief needs from each tick's events (agent counts live in the engine). */
export class DebriefTally {
  readonly talk: Record<Team, { sent: number; overheard: number }> = { A: { sent: 0, overheard: 0 }, B: { sent: 0, overheard: 0 } };

  constructor(private readonly teamOf: (agentId: string) => Team | undefined) {}

  add(events: readonly MatchEvent[]): void {
    for (const e of events) {
      if (e.kind === 'said') {
        const from = this.teamOf(e.agent);
        if (!from) continue;
        this.talk[from].sent++;
        const rival: Team = from === 'A' ? 'B' : 'A';
        // overheardBy only ever lists the other crew's agents (team talk caught in range).
        if (e.overheardBy.some((id) => this.teamOf(id) === rival)) this.talk[rival].overheard++;
      }
    }
  }

}

/** One line per agent of the crew, in slot order: the engine's counts (verbs, switches, finished digs). */
export function agentsOf(s: MatchState, team: Team): V2DebriefAgent[] {
  return s.agents
    .filter((a) => a.team === team)
    .sort((a, b) => a.slot - b.slot)
    .map((a) => ({ agentId: a.id, name: a.name, delivered: a.delivered, used: a.used, picks: a.picks }));
}

/** The crew's best agent: delivered × 3 + used + picks, the earlier slot on a tie; null for no agents. */
export function mvpOf(agents: readonly V2DebriefAgent[]): string | null {
  let best: V2DebriefAgent | null = null;
  const score = (a: V2DebriefAgent) => a.delivered * 3 + a.used + a.picks;
  for (const a of agents) if (!best || score(a) > score(best)) best = a;
  return best?.agentId ?? null;
}

export interface DebriefInput {
  /** null when the match never went live (void before the start). */
  state: MatchState | null;
  team: Team;
  difficulty: Difficulty;
  tally: DebriefTally;
  /** Credits held for this crew at the start (0 when nothing was held). */
  held: number;
  /** Credits charged for the ticks played; a void returns them all. */
  charged: number;
  void: boolean;
  eloDelta: number | null;
  registry: V2Debrief['registry'];
}

export function buildDebrief(i: DebriefInput): V2Debrief {
  const agents = i.state ? agentsOf(i.state, i.team) : [];
  const used = i.void ? 0 : Math.min(i.charged, i.held);
  const goals = i.state?.result
    ? evaluateGoals(i.state, i.team, i.difficulty).map((g) => ({ title: g.title, met: g.met, available: g.available, progress: g.progress }))
    : [];
  return {
    eloDelta: i.eloDelta,
    mvp: mvpOf(agents),
    goals,
    talk: { ...i.tally.talk[i.team] },
    credits: { held: i.held, used, returned: i.held - used },
    registry: i.registry,
    agents,
    difficulty: i.difficulty,
  };
}
