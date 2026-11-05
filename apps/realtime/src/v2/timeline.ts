// Each crew's decision timeline for the debrief ("why did it do that?"): per agent per tick what it
// saw (summarised from its own fogged observation), the crew plan in force, the action it took with
// what the engine made of it, the equipped skill the model said drove it (by id, never its text),
// its inner voice, and the key moments for the scrubber (hazard breaches, switches, supply drops,
// deliveries). Built as the match plays and stored once it ends (MatchTimelinesRepo).
//
// The same rules as the live mind panel (withOwnCrew): a crew plan shaped by a bought skill is kept
// as `hidden`, never as text, and an agent on a bought or rented skill keeps no inner voice. The
// inner voice and the plan are never part of the match log.
import { observedSummary, type V2Decision } from '@skirm/decision-engine/v2';
import { actionText, type AgentState, type MatchEvent, type MatchState, type Observation, type Team } from '@skirm/engine/v2';
import type { MatchTimelineInput, V2DecisionRecord, V2MomentRecord, V2PlanRecord } from '@skirm/db';

const TEAMS: readonly Team[] = ['A', 'B'];

export interface TimelineCrew {
  brain: string;
  /** Per agent slot: runs a skill this player did not write (plan and inner voice withheld). */
  bought: readonly boolean[];
  /** Per agent slot: the skill versions in the order the brain was given their prompts. */
  skillKeys: readonly (readonly { id: string; version: number }[])[];
}

export class DecisionTimeline {
  private readonly plans: Record<Team, V2PlanRecord[]> = { A: [], B: [] };
  private readonly decisions: Record<Team, V2DecisionRecord[]> = { A: [], B: [] };
  private readonly moments: Record<Team, V2MomentRecord[]> = { A: [], B: [] };
  /** What each agent saw on its turn this tick, by agent id. */
  private readonly seen = new Map<string, string>();
  /** This tick's turns, by agent id, until the engine has resolved them. */
  private pending = new Map<string, V2DecisionRecord>();

  constructor(private readonly crews: Record<Team, TimelineCrew>) {}

  /** The observation an agent's brain got this tick. */
  observe(agentId: string, o: Observation): void {
    this.seen.set(agentId, observedSummary(o));
  }

  /** A crew plan from `tick` on (the plan the next actions read). */
  plan(team: Team, tick: number, text: string | null, why: string | null): void {
    const hidden = this.crews[team].bought.some(Boolean);
    const rec: V2PlanRecord = hidden ? { tick, text: null, why: null, hidden: true } : { tick, text, why };
    const last = this.plans[team].at(-1);
    if (last && last.text === rec.text && last.why === rec.why && last.hidden === rec.hidden) return;
    if (last && last.tick === tick) this.plans[team].pop();
    this.plans[team].push(rec);
  }

  /** An agent's decision this tick, before the engine resolves it. */
  turn(a: AgentState, d: V2Decision): void {
    const crew = this.crews[a.team];
    const key = d.skill !== undefined ? crew.skillKeys[a.slot]?.[d.skill] : undefined;
    const rec: V2DecisionRecord = {
      tick: 0,
      agentId: a.id,
      observed: this.seen.get(a.id) ?? '',
      action: actionText(d.action),
      reason: d.reason,
      ...(d.thought && !crew.bought[a.slot] ? { thought: d.thought } : {}),
      ...(key ? { skill: { id: key.id, version: key.version } } : {}),
    };
    this.pending.set(a.id, rec);
  }

  /** The tick as the engine resolved it: each turn's outcome, then the key moments. */
  resolve(s: MatchState, ev: readonly MatchEvent[]): void {
    const agent = (id: string) => s.agents.find((x) => x.id === id);
    const tag = (id: string, t: string) => {
      const r = this.pending.get(id);
      if (r) (r.outcome ??= []).push(t);
    };
    const moment = (team: Team, m: Omit<V2MomentRecord, 'tick'>) => this.moments[team].push({ tick: s.tick, ...m });
    for (const e of ev) {
      switch (e.kind) {
        case 'verb': {
          tag(e.agent, `used ${e.verb}`);
          const r = this.pending.get(e.agent);
          if (r) r.effect = e.effect;
          break;
        }
        case 'dug': {
          tag(e.agent, e.done ? 'dug through' : 'dug');
          const r = this.pending.get(e.agent);
          if (r) r.effect = 'remove_solid';
          break;
        }
        case 'blocked':
          tag(e.agent, 'blocked');
          break;
        case 'stunned':
          tag(e.agent, 'stunned');
          break;
        case 'refused':
          tag(e.agent, `refused: ${e.reason}`);
          break;
        case 'bluff':
          tag(e.agent, e.believed ? 'bluff believed' : 'bluff doubted');
          break;
        case 'said': {
          const r = this.pending.get(e.agent);
          if (r) r.said = e.text;
          break;
        }
        case 'picked': {
          tag(e.agent, e.origin === 'drop' ? 'took the supply drop' : e.stolen ? 'stole an item' : 'picked up');
          const a = agent(e.agent);
          if (a && e.origin === 'drop')
            for (const t of TEAMS) moment(t, { kind: 'supply_drop', team: a.team, agentId: a.id, text: `${a.name} took the supply drop` });
          break;
        }
        case 'delivered': {
          tag(e.agent, `delivered ${e.count}`);
          const a = agent(e.agent);
          if (a) for (const t of TEAMS) moment(t, { kind: 'goal', team: a.team, agentId: a.id, text: `${a.name} delivered ${e.count} (${e.score} in)` });
          break;
        }
        case 'knocked_down': {
          tag(e.agent, `knocked down by ${e.by}`);
          const a = agent(e.agent);
          // Only an agent's own crew sees its hazard breach on the timeline.
          if (a && e.by !== 'switch')
            moment(a.team, { kind: 'hazard_breach', team: a.team, agentId: a.id, text: `${e.by} reached ${a.name}${e.dropped ? `, ${e.dropped} dropped` : ''}` });
          break;
        }
        case 'eliminated': {
          tag(e.agent, `removed by ${e.by}`);
          const a = agent(e.agent);
          if (a) moment(a.team, { kind: 'hazard_breach', team: a.team, agentId: a.id, text: `${e.by} removed ${a.name} for the match` });
          break;
        }
        case 'switch': {
          tag(e.agent, `flipped ${e.name}`);
          const a = agent(e.agent);
          if (a) for (const t of TEAMS) moment(t, { kind: 'switch', team: a.team, agentId: a.id, text: `${a.name} flipped ${e.name}: crew ${e.floods}'s lane floods` });
          break;
        }
        case 'supply_drop':
          for (const t of TEAMS) moment(t, { kind: 'supply_drop', team: t, agentId: null, text: `A supply drop landed at ${e.at[0]},${e.at[1]}` });
          break;
        case 'tool_picked':
          tag(e.agent, `took the ${e.tool}`);
          break;
        case 'tool_used':
          tag(e.agent, `placed the ${e.tool} at ${e.at[0]},${e.at[1]}`);
          break;
        default:
          break;
      }
    }
    for (const [id, r] of this.pending) {
      const a = agent(id);
      if (!a) continue;
      r.tick = s.tick;
      this.decisions[a.team].push(r);
    }
    this.pending = new Map();
    this.seen.clear();
  }

  /** Each crew's timeline as stored. */
  records(): MatchTimelineInput[] {
    return TEAMS.map((t) => ({ team: t, brain: this.crews[t].brain, plans: this.plans[t], decisions: this.decisions[t], moments: this.moments[t] }));
  }
}
