// What each side is shown of a live match after every tick. A crew sees the board through its own
// fog, its own agents, the rivals in its sight, the talk its agents heard (rival team talk only when
// overheard) and its own refusals; a watcher sees everything. Plans: own-crew plans only; skills
// only by public name and trigger (own crew), never their prompts.
import type { FrameCommands } from './commands';
import type { HazardKind, Team } from './map';
import type { MatchEvent, MatchResult, MatchState, Role } from './match';
import { rowsFor } from './observe';
import type { Channel, TalkTier } from './talk';
import type { SkillTrigger } from './triggers';

export type FrameView = Team | 'watch';

/** Where a carried item was picked up: your half, the middle, a supply drop, a rival's drop, or your own drop back. */
export type ItemOrigin = 'own' | 'middle' | 'drop' | 'stolen' | 'recovered';

export interface FrameItem {
  /** The map's goal item (maps name it, e.g. "Lamp oil"). */
  kind: 'item';
  /** Where it was picked up (null only for an item the engine did not tag). */
  origin: ItemOrigin | null;
  /** Tick it was picked up, when known. */
  tick?: number;
}

export interface FrameAgent {
  id: string;
  name: string;
  team: Team;
  role: Role;
  x: number;
  y: number;
  /** What the agent carries, in pickup order (its length is the old `carrying` count). */
  items: FrameItem[];
  delivered: number;
  down: boolean;
  out: boolean;
  tier: TalkTier;
  /** The agent's current plan: own crew only, never a rival's. */
  plan?: string;
  /** Why the planner chose that plan (the mind panel's planner trace): own crew only, withheld with the plan. */
  planWhy?: string;
  /** The agent's latest inner voice, first person: own crew only, withheld when it runs a bought skill. */
  thought?: string;
  /** The plan is withheld because the agent runs a bought (encrypted) skill. */
  planHidden?: boolean;
  /**
   * The agent's equipped skills this tick: public name and trigger, and whether the trigger held
   * (the skill was in its prompt). Own crew only; never the prompt. Absent: no skills.
   */
  skills?: FrameSkill[];
}

/** One equipped skill in the mind panel: public metadata and whether it is active this tick. */
export interface FrameSkill {
  name: string;
  trigger: SkillTrigger;
  active: boolean;
}

export interface FrameMessage {
  tick: number;
  from: string;
  fromName: string;
  team: Team;
  channel: Channel;
  text: string;
  /** A rival's team message this crew overheard. */
  overheard: boolean;
  /** Your crew's message: names of the rival agents that overheard it (absent: none or not reported). */
  overheardBy?: string[];
}

export interface V2Frame {
  view: FrameView;
  mapId: string;
  tick: number;
  limit: number;
  rows: string[];
  agents: FrameAgent[];
  score: Record<Team, number>;
  goal: number;
  holdTicks: Record<Team, number>;
  blocks: Record<Team, number>;
  events: MatchEvent[];
  comms: FrameMessage[];
  result: MatchResult | null;
  /** Tick each map switch can be used again (map order). */
  switchReady?: number[];
  /** Each hazard's state: waves grown so far and whether it is receding. */
  hazards?: { kind: HazardKind; waves: number; receding: boolean }[];
  /** The viewing crew's live commands (its own frames only; never the rival's or the watch view). */
  commands?: FrameCommands;
  /** The viewing crew's crew playbook for this match, by its name (its own frames only; never the text). */
  playbook?: string;
}

/** What the server knows beside the match state: each agent's current plan. */
export interface FrameExtras {
  /** Current plan by agent id. Only the viewing crew's own agents get theirs. */
  plans?: Readonly<Record<string, string>>;
  /** Agents running a bought (encrypted) skill: their plan is withheld, even from their own crew. */
  planHidden?: readonly string[];
}

export function frameFor(s: MatchState, view: FrameView, events: MatchEvent[], extras: FrameExtras = {}): V2Frame {
  const team = view === 'watch' ? null : view;
  const { w } = s.map;
  const sees = (a: { team: Team; x: number; y: number }) => !team || a.team === team || s.visible[team][a.y * w + a.x];
  const agents = s.agents
    .filter((a) => !a.out || !team || a.team === team)
    .filter(sees)
    .map((a): FrameAgent => {
      const items = a.carrying.map((_, i): FrameItem => {
        const tag = a.tags[i];
        return tag ? { kind: 'item', origin: tag.origin, tick: tag.tick } : { kind: 'item', origin: null };
      });
      const f: FrameAgent = { id: a.id, name: a.name, team: a.team, role: a.role, x: a.x, y: a.y, items, delivered: a.delivered, down: a.down > 0, out: a.out, tier: a.tier };
      if (team && a.team === team) {
        if (extras.planHidden?.includes(a.id)) f.planHidden = true;
        else if (extras.plans?.[a.id]) f.plan = extras.plans[a.id];
      }
      return f;
    });
  const shown = new Set(agents.map((a) => a.id));
  const teamOf = (id: string) => s.agents.find((a) => a.id === id)?.team;
  const mine = (id: string) => !team || teamOf(id) === team;
  const comms: FrameMessage[] = [];
  const out: MatchEvent[] = [];
  for (const e of events) {
    if (e.kind === 'said') {
      const from = s.agents.find((a) => a.id === e.agent)!;
      const ours = mine(e.agent);
      const heard = e.heardBy.some(mine);
      const overheard = !ours && e.overheardBy.some(mine);
      if (!team || ours || heard || overheard) {
        const m: FrameMessage = { tick: s.tick, from: from.id, fromName: from.name, team: from.team, channel: e.channel, text: e.text, overheard };
        // The amber "heard by" ear: which rivals overheard your crew's team message.
        if (ours && e.overheardBy.length) m.overheardBy = e.overheardBy.map((id) => s.agents.find((a) => a.id === id)?.name ?? id);
        comms.push(m);
        out.push(e);
      }
      continue;
    }
    if (e.kind === 'refused') {
      if (mine(e.agent)) out.push(e);
      continue;
    }
    // A bluff: the liar's crew and the target's crew both know of it (the target heard it), even
    // when the other agent is out of sight.
    if (e.kind === 'bluff') {
      if (mine(e.agent) || mine(e.victim)) out.push(e);
      continue;
    }
    // Hazards, drops and switches are public; agent events only for agents this side can see.
    if ('agent' in e && !mine(e.agent) && !shown.has(e.agent)) continue;
    out.push(e);
  }
  return {
    view,
    mapId: s.map.def.id,
    tick: s.tick,
    limit: s.limit,
    rows: rowsFor(s, team),
    agents,
    score: { ...s.score },
    goal: s.map.def.goal,
    holdTicks: { ...s.holdTicks },
    blocks: { ...s.blocks },
    events: out,
    comms,
    result: s.result,
    switchReady: s.switchReady.slice(),
    hazards: [...new Set(s.map.def.hazards.map((h) => h.kind))].map((kind) => {
      const H = s.hazards[kind];
      return { kind, waves: H?.waves.length ?? 0, receding: H?.receding ?? false };
    }),
  };
}
