// The debrief's decision timeline ("why did it do that?"), as plain functions over GET
// /v2/matches/:id/decisions: the plan in force at a tick, an agent's turn at a tick, where each key
// moment sits on the scrubber, and the words for the skill behind a turn.
import type { DecisionCrew, DecisionSkill, MatchDecision, MatchMoment, MatchPlan, MomentKind } from '@/lib/api/decisions';

/** The crew plan the agents read on `tick`: the latest one written at or before it. */
export function planAt(plans: readonly MatchPlan[], tick: number): MatchPlan | null {
  let at: MatchPlan | null = null;
  for (const p of plans) if (p.tick <= tick && (!at || p.tick >= at.tick)) at = p;
  return at;
}

/** An agent's turn on `tick`, else its latest turn before it (a knocked-out agent stops asking). */
export function decisionAt(decisions: readonly MatchDecision[], agentId: string, tick: number): MatchDecision | null {
  let at: MatchDecision | null = null;
  for (const d of decisions) if (d.agentId === agentId && d.tick <= tick && (!at || d.tick >= at.tick)) at = d;
  return at;
}

/** Where a tick sits on a scrubber of `ticks`, as a percentage from the left (1 at 0 %, `ticks` at 100 %). */
export function markLeft(tick: number, ticks: number): number {
  if (ticks <= 1) return 0;
  return (Math.min(Math.max(tick, 1), ticks) - 1) / (ticks - 1) * 100;
}

/** The last tick any turn or moment of a crew was recorded on (the scrubber's end when the match row has none). */
export function lastTick(crew: DecisionCrew, ticks: number): number {
  let n = ticks;
  for (const d of crew.decisions) n = Math.max(n, d.tick);
  for (const m of crew.moments) n = Math.max(n, m.tick);
  return Math.max(1, n);
}

/** The next (dir 1) or previous (dir -1) moment's tick from `tick`, or null when there is none. */
export function stepMoment(moments: readonly MatchMoment[], tick: number, dir: 1 | -1): number | null {
  const ticks = [...new Set(moments.map((m) => m.tick))].sort((a, b) => a - b);
  if (dir === 1) return ticks.find((t) => t > tick) ?? null;
  return [...ticks].reverse().find((t) => t < tick) ?? null;
}

export const MOMENT_LABEL: Record<MomentKind, string> = {
  hazard_breach: 'Hazard breach',
  switch: 'Switch flipped',
  supply_drop: 'Supply drop',
  goal: 'Delivered',
};

const REASON: Record<MatchDecision['reason'], string | null> = {
  chosen: null,
  timeout: 'The model missed the 1.5 s deadline, so it waited.',
  error: 'The model call failed, so it waited.',
  illegal: 'The model answered nothing legal, so it waited.',
};

export const reasonNote = (d: MatchDecision) => REASON[d.reason];

/** The words for the skill behind a turn: its name and how it was named, or why there is none. */
export function skillLine(d: MatchDecision, crew: Pick<DecisionCrew, 'brain' | 'agents'>, skills: readonly DecisionSkill[]): { name: string | null; how: string; skill: DecisionSkill | null } {
  if (crew.brain === 'greedy') return { name: null, how: 'The greedy brain plays without skills.', skill: null };
  if (!d.skill) {
    const carries = crew.agents.find((a) => a.id === d.agentId)?.skills.length ?? 0;
    return { name: null, how: carries ? 'No equipped skill drove this move.' : 'No skills equipped.', skill: null };
  }
  const s = skills.find((x) => x.id === d.skill!.id && x.version === d.skill!.version) ?? null;
  return {
    name: `${s?.name ?? d.skill.id} v${d.skill.version}`,
    how: d.skill.by === 'model' ? 'named by the agent’s model' : 'the only equipped skill that uses this verb',
    skill: s,
  };
}
