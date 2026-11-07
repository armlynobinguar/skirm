// The showreel's matches (Showreel.tsx draws them): two greedy-bot crews play a real v2 match on a
// map, tick by tick, with the same engine and bot as practice, here in the browser. Nothing is
// scripted: the captions are read off the engine's events. Each reel starts a few ticks in (past the
// head start, so something is already happening) and is cut after REEL_TICKS or at the result.
import { greedyAct, greedySay } from '@skirm/decision-engine/v2';
import {
  MAPS_V2,
  botCrew,
  createMatch,
  frameFor,
  observe,
  stepMatch,
  type Action,
  type AgentSpec,
  type MapDefV2,
  type MatchEvent,
  type MatchState,
  type SayInput,
  type Team,
  type V2Frame,
} from '@skirm/engine/v2';

/** Ticks played instantly before a reel shows, so it opens mid-action. */
export const PREROLL_TICKS = 25;
/** Ticks a reel shows before the cut (or fewer when the match ends first). */
export const REEL_TICKS = 40;
/** How many reels play before the loop comes back round. */
export const REEL_COUNT = 4;

export const CREW_NAMES: Record<Team, string> = { A: 'Ember crew', B: 'Tide crew' };
const AGENT_NAMES: Record<Team, string[]> = { A: ['Vex', 'Kade', 'Juno'], B: ['Moth', 'Iris', 'Pike'] };

function crew(team: Team): AgentSpec[] {
  return botCrew(3, team.toLowerCase()).map((a, i) => ({ ...a, name: AGENT_NAMES[team][i] ?? a.name }));
}

/** The reels' maps: REEL_COUNT different maps, starting from one that changes every day. */
export function reelMaps(day = Math.floor(Date.now() / 86_400_000)): MapDefV2[] {
  const n = MAPS_V2.length;
  return Array.from({ length: Math.min(REEL_COUNT, n) }, (_, i) => MAPS_V2[(day + i * 3) % n]!);
}

export interface Caption {
  id: number;
  team: Team | null;
  text: string;
}

export interface Reel {
  def: MapDefV2;
  s: MatchState;
  goal: number;
  /** Ticks shown so far (after the pre-roll). */
  shown: number;
  frame: V2Frame;
  done: boolean;
  /** Hazards already captioned this reel (each breaks out once). */
  announced: Set<string>;
}

/** Plays one tick for both crews with the greedy bot (its delivery callout as its only line). */
function tick(s: MatchState): MatchEvent[] {
  const actions: Record<string, Action> = {};
  const says: SayInput[] = [];
  for (const a of s.agents) {
    if (a.out) continue;
    const o = observe(s, a.id);
    const act = greedyAct(o);
    actions[a.id] = act;
    const say = greedySay(o, act);
    if (say) says.push({ agent: a.id, channel: 'say', text: say });
  }
  return stepMatch(s, { actions, says });
}

export function startReel(def: MapDefV2): Reel {
  const s = createMatch(def, { A: crew('A'), B: crew('B') });
  let ev: MatchEvent[] = [];
  for (let i = 0; i < PREROLL_TICKS && !s.result; i++) ev = tick(s);
  const first = s.agents[0]!;
  return { def, s, goal: observe(s, first.id).map.goal, shown: 0, frame: frameFor(s, 'watch', ev), done: !!s.result, announced: new Set() };
}

/** Plays the next tick; returns its events. */
export function stepReel(r: Reel): MatchEvent[] {
  if (r.done) return [];
  const ev = tick(r.s);
  r.shown++;
  r.frame = frameFor(r.s, 'watch', ev);
  r.done = !!r.s.result || r.shown >= REEL_TICKS;
  return ev;
}

const HAZARD: Record<string, string> = { water: 'flood', lava: 'lava', fire: 'fire', gas: 'gas' };

/** One line per event worth a caption, in plain words. */
export function captionsOf(r: Reel, ev: readonly MatchEvent[]): Omit<Caption, 'id'>[] {
  const who = (id: string) => r.s.agents.find((a) => a.id === id);
  const name = (id: string) => who(id)?.name ?? id;
  const team = (id: string) => who(id)?.team ?? null;
  const out: Omit<Caption, 'id'>[] = [];
  for (const e of ev) {
    switch (e.kind) {
      case 'delivered':
        out.push({ team: e.team, text: `${name(e.agent)} delivers ${e.count} · ${CREW_NAMES[e.team]} ${e.score}/${r.goal}` });
        break;
      case 'picked':
        if (e.stolen) out.push({ team: team(e.agent), text: `${name(e.agent)} steals one from the rival stash` });
        break;
      case 'knocked_down':
        out.push({ team: team(e.agent), text: `${name(e.agent)} is knocked down${e.dropped ? ` and drops ${e.dropped}` : ''}` });
        break;
      case 'eliminated':
        out.push({ team: team(e.agent), text: `${name(e.agent)} is out: ${HAZARD[e.by] ?? e.by}` });
        break;
      case 'stunned':
        out.push({ team: team(e.agent), text: `${name(e.agent)} is stunned` });
        break;
      case 'tool_used':
        out.push({ team: team(e.agent), text: `${name(e.agent)} uses the ${e.tool}` });
        break;
      case 'supply_drop':
        out.push({ team: null, text: 'Supply drop incoming' });
        break;
      case 'hazard':
        // Once per hazard: every wave would bury the plays.
        if (!e.receding && !r.announced.has(e.hazard) && r.announced.add(e.hazard)) out.push({ team: null, text: `${(HAZARD[e.hazard] ?? e.hazard).replace(/^./, (c) => c.toUpperCase())} breaks out` });
        break;
      default:
        break;
    }
  }
  // One line per text (several hazard tiles or agents can fire the same event in one tick).
  const seen = new Set<string>();
  for (let i = out.length - 1; i >= 0; i--) {
    if (seen.has(out[i]!.text)) out.splice(i, 1);
    else seen.add(out[i]!.text);
  }
  const res = r.s.result;
  if (res && r.done && r.shown > 0) {
    out.push({
      team: res.winner === 'draw' ? null : res.winner,
      text: res.winner === 'draw' ? `Result: a draw, ${res.score.A}–${res.score.B}` : `Result: ${CREW_NAMES[res.winner]} wins ${res.score[res.winner]}–${res.score[res.winner === 'A' ? 'B' : 'A']}`,
    });
  }
  return out;
}
