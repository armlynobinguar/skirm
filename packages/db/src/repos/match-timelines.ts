// Each crew's decision timeline of a v2 match (the debrief's "why did it do that?"), written by
// realtime once the match has ended and read by GET /v2/matches/:id/decisions.
import { and, asc, eq } from 'drizzle-orm';
import type { Executor } from '../client';
import { matchTimelines, type V2DecisionRecord, type V2MomentRecord, type V2PlanRecord } from '../schema';

export type MatchTimelineRow = typeof matchTimelines.$inferSelect;

export interface MatchTimelineInput {
  team: 'A' | 'B';
  brain: string;
  plans: V2PlanRecord[];
  decisions: V2DecisionRecord[];
  moments: V2MomentRecord[];
}

export class MatchTimelinesRepo {
  constructor(private readonly db: Executor) {}

  /** Stores each crew's timeline once: a second write for the same match and crew is ignored. */
  async put(matchId: string, crews: readonly MatchTimelineInput[]): Promise<void> {
    if (!crews.length) return;
    await this.db
      .insert(matchTimelines)
      .values(crews.map((c) => ({ matchId, team: c.team, brain: c.brain, plans: c.plans, decisions: c.decisions, moments: c.moments })))
      .onConflictDoNothing();
  }

  /** A match's timelines, crew A first; only `teams` when given. */
  async list(matchId: string, teams?: readonly ('A' | 'B')[]): Promise<MatchTimelineRow[]> {
    const rows = await this.db.select().from(matchTimelines).where(eq(matchTimelines.matchId, matchId)).orderBy(asc(matchTimelines.team));
    return teams ? rows.filter((r) => teams.includes(r.team)) : rows;
  }

  async get(matchId: string, team: 'A' | 'B'): Promise<MatchTimelineRow | undefined> {
    const [row] = await this.db
      .select()
      .from(matchTimelines)
      .where(and(eq(matchTimelines.matchId, matchId), eq(matchTimelines.team, team)));
    return row;
  }
}
