// The four roles added after the original six (Builder, Digger, Firefighter, Scout, Runner, Hauler).
// None of them gates a map verb; each has its own rule, written out here. Every rule only runs for
// an agent of that role (or for a decoy, which only a Saboteur makes), so a match of the original
// six plays, logs and hashes exactly as before (test/v2-role-parity.test.ts pins that).
//
//   Medic     Action { type: 'tend', agent } on a crewmate within 1 tile (its own tile counts, a
//             knocked-down agent does not hold its tile). A knock-down with 2 or more ticks left
//             loses MEDIC_DOWN_CUT (2) of them, never going under 1: the crewmate still gets up at
//             its start, 2 ticks sooner (4 → 2 on a plain knock-down). A stun is cleared: the
//             crewmate acts next tick. Then the Medic waits MEDIC_COOLDOWN (5) ticks to tend again.
//             It cannot tend itself (it would be down or stunned) or a rival.
//   Engineer  Pulls a valve (a switch) from up to ENGINEER_SWITCH_REACH (2) tiles away instead of
//             only next to it (the nearest switch in reach, map order on a tie); the switch's shared
//             reset is unchanged. Carries ENGINEER_BRIDGES (2) bridges of its own: `use bridge <dir>`
//             lays one on adjacent water exactly like a supply-drop bridge (tools.ts), without taking
//             its tool slot. A bridge it carries from a drop goes down first. Bridges never break in
//             skirm, so there is nothing to repair.
//   Saboteur  Action { type: 'plant', dir } puts a decoy on an adjacent open floor tile ('.', not
//             grass, ice, an item, the exit, a start tile, a tool or placed gear, nor a tile an agent
//             stands on). It has SABOTEUR_DECOYS (2) per match, and each one uses one of its crew's
//             bluffs (lieCap, bluff.ts): bluffs told plus decoys planted never pass the cap, so a
//             Saboteur trades lies for traps. The planting crew sees the tile as it is (and its
//             frames mark the decoy); the rival crew sees an item there whenever it has that tile in
//             sight, through fog like any tile, and remembers it the same way. A rival that ends a
//             move on it with room to carry springs it: the decoy is gone, nothing is picked up and
//             the rival loses its next action (DECOY_STUN, a 1-tick stun). The planting crew walks over
//             its own decoys. A decoy whose tile stops being open floor (a hazard, a flood, a block, a
//             dropped item) is gone. Bluffs never name a decoy: they are only about real middle items.
//   Courier   Carries 1 item (carryOf). A move whose first tile is open ground ('.' or grass, not
//             ice, water, a bridge, an item, a decoy its crew sees as an item, the exit or a tool)
//             continues one more tile the same way when that tile is open floor, grass, an item or
//             the exit, inside the walls and not held by another agent. Rubble, walls and hazards stop
//             the second tile. It resolves after every other move and slide, in agent order. Pickups
//             and deliveries happen where it ends.
//
// Balance: the Medic saves 2 ticks per knock-down (half the down time) or 2 of a Scout's 3 stun
// ticks, at most every 5 ticks and only next to the crewmate, so it trades its own moves for its
// crew's. The Engineer's valve reach is one tile more and its 2 bridges matter on water maps only.
// The Saboteur's decoys come out of the same budget as its crew's bluffs, cost an action each and
// cost the victim one action plus the walk. The Courier covers up to twice the ground per move but
// brings home half a Runner's load per trip and stops at every item, so it shines on scattered
// items and steals, not on clustered ones.
import type { Dir, Team } from './map';
import type { Action, AgentState, MatchEvent, MatchState, Role } from './match';
import { carryOf, manhattan } from './match';
import { gearOf } from './tools';
import { timerFor } from './traits';

/** Ticks a Medic's tend takes off a knock-down (never below 1 left). */
export const MEDIC_DOWN_CUT = 2;
/** Ticks between a Medic's tends. */
export const MEDIC_COOLDOWN = 5;
/** How far (Manhattan) an Engineer reaches a switch. Everyone else: 1. */
export const ENGINEER_SWITCH_REACH = 2;
/** Bridges an Engineer carries of its own per match. */
export const ENGINEER_BRIDGES = 2;
/** Decoys a Saboteur may plant per match (each also uses one of the crew's bluffs). */
export const SABOTEUR_DECOYS = 2;
/** Ticks a rival that springs a decoy is stunned: it loses its next action. */
export const DECOY_STUN = 1;

const DIRS: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const DIR_LIST: readonly Dir[] = ['N', 'E', 'S', 'W'];

/** The role's own stock at the start of a match (spread into the agent state; nothing for other roles, so their state is unchanged). */
export function kitOf(role: Role): { kit?: number } {
  if (role === 'Engineer') return { kit: ENGINEER_BRIDGES };
  if (role === 'Saboteur') return { kit: SABOTEUR_DECOYS };
  return {};
}

// ---------- Medic ----------

/** Why the Medic cannot tend `target` now, or null when it can (at action time, after this tick's timers). */
function tendRefusal(s: MatchState, a: AgentState, o: AgentState | undefined, tick: number): string | null {
  if (a.role !== 'Medic') return 'only a Medic can tend';
  if ((a.tendReady ?? 0) > tick) return 'still catching breath from the last tend';
  if (!o || o === a || o.team !== a.team || o.out) return 'no crewmate to tend';
  if (manhattan(o, a) > 1) return `${o.name} is not next to you`;
  return null;
}

/** Medic: tends a crewmate next to it. Returns why not, or null. */
export function tend(s: MatchState, a: AgentState, targetId: string, ev: MatchEvent[]): string | null {
  const o = s.agents.find((x) => x.id === targetId);
  const why = tendRefusal(s, a, o, s.tick);
  if (why) return why;
  let was: 'down' | 'stunned';
  if (o!.down >= 2) {
    o!.down = Math.max(1, o!.down - MEDIC_DOWN_CUT);
    was = 'down';
  } else if (o!.stun > 0 && !o!.down) {
    o!.stun = 0;
    was = 'stunned';
  } else return `${o!.name} needs no tending`;
  a.tendReady = s.tick + MEDIC_COOLDOWN;
  ev.push({ kind: 'tended', agent: a.id, target: o!.id, was });
  return null;
}

/**
 * Legal tends for next tick. Timers tick down before actions, so a knock-down needs 3 or more left
 * now (2 at action time) and a stun 2 or more (1 at action time).
 */
export function tendActions(s: MatchState, a: AgentState): Action[] {
  const out: Action[] = [];
  for (const o of s.agents) {
    if (tendRefusal(s, a, o, s.tick + 1)) continue;
    if (o.down >= 3 || (!o.down && o.stun >= 2)) out.push({ type: 'tend', agent: o.id });
  }
  return out;
}

// ---------- Engineer ----------

/** The switch an agent can pull from where it stands: the nearest within reach (1, or 2 for an Engineer), map order on a tie; -1 when none. */
export function switchReach(s: MatchState, a: AgentState): number {
  const reach = a.role === 'Engineer' ? ENGINEER_SWITCH_REACH : 1;
  let best = -1;
  let bestD = Infinity;
  s.map.def.switches.forEach((sw, k) => {
    const d = manhattan({ x: sw.at[0], y: sw.at[1] }, a);
    if (d >= 1 && d <= reach && d < bestD) {
      best = k;
      bestD = d;
    }
  });
  return best;
}

/** An Engineer with a bridge of its own left (tools.ts lets it lay one without holding the tool). */
export const engineerBridges = (a: AgentState) => (a.role === 'Engineer' ? (a.kit ?? 0) : 0);

// ---------- Saboteur ----------

/** Is tile `i` a decoy planted by the crew other than `team` (one `team` would take for an item)? */
export function decoyFor(s: MatchState, i: number, team: Team): boolean {
  const by = s.decoys?.[i];
  return by !== undefined && by !== team;
}

/** Bluffs and decoys a crew has used against its cap (bluff.ts reads the same budget). */
export const liesUsed = (s: MatchState, T: Team) => s.tally[T].lies + (s.tally[T].decoys ?? 0);

/** Why the Saboteur cannot plant toward `dir` now, or null. */
function plantRefusal(s: MatchState, a: AgentState, dir: Dir | undefined): string | null {
  if (a.role !== 'Saboteur') return 'only a Saboteur can plant a decoy';
  if ((a.kit ?? 0) <= 0) return 'no decoys left';
  if (liesUsed(s, a.team) >= s.lieCap[a.team]) return 'your crew has used all its bluffs';
  if (!dir || !DIRS[dir]) return 'a decoy needs a direction';
  const { w, h } = s.map;
  const x = a.x + DIRS[dir][0];
  const y = a.y + DIRS[dir][1];
  if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return 'that tile is the map edge';
  const j = y * w + x;
  if (s.grid[j] !== null) return 'a decoy goes on open floor';
  if (s.decoys?.[j] !== undefined) return 'there is a decoy there already';
  const g = gearOf(s);
  if (g.ground[j] || g.placed[j]) return 'a tool is there';
  if (s.agents.some((o) => !o.out && !o.down && o.x === x && o.y === y)) return 'someone stands there';
  if (s.agents.some((o) => o.start[0] === x && o.start[1] === y)) return 'not on a start tile';
  return null;
}

/** Saboteur: plants a decoy toward `dir`. Returns why not, or null. */
export function plantDecoy(s: MatchState, a: AgentState, dir: Dir | undefined, ev: MatchEvent[]): string | null {
  const why = plantRefusal(s, a, dir);
  if (why) return why;
  const x = a.x + DIRS[dir!][0];
  const y = a.y + DIRS[dir!][1];
  (s.decoys ??= {})[y * s.map.w + x] = a.team;
  a.kit = (a.kit ?? 0) - 1;
  const T = s.tally[a.team];
  T.decoys = (T.decoys ?? 0) + 1;
  ev.push({ kind: 'planted', agent: a.id, at: [x, y] });
  return null;
}

/** Legal plants for next tick. */
export function plantActions(s: MatchState, a: AgentState): Action[] {
  return DIR_LIST.filter((dir) => plantRefusal(s, a, dir) === null).map((dir) => ({ type: 'plant', dir }));
}

/** Pickups: a rival with room to carry that ends its move on a decoy springs it. */
export function springDecoy(s: MatchState, a: AgentState, j: number, ev: MatchEvent[]) {
  const by = s.decoys?.[j];
  if (by === undefined || by === a.team || s.grid[j] !== null || a.carrying.length >= carryOf(a.role)) return;
  delete s.decoys![j];
  a.stun = Math.max(a.stun, timerFor(DECOY_STUN, a, 'stun'));
  ev.push({ kind: 'decoy_sprung', agent: a.id, team: by, at: [a.x, a.y] });
}

/** Drops every decoy whose tile is no longer open floor (tile order, so it is the same on every run). */
export function pruneDecoys(s: MatchState) {
  for (const key of Object.keys(s.decoys!).map(Number)) if (s.grid[key] !== null) delete s.decoys![key];
}

/** Decoys as [x, y] with the crew that planted each, in tile order (frames and observations). */
export function decoyView(s: MatchState, team: Team | null): { at: [number, number]; team: Team }[] {
  const { w } = s.map;
  return Object.keys(s.decoys ?? {})
    .map(Number)
    .sort((p, q) => p - q)
    .filter((j) => team === null || s.decoys![j] === team)
    .map((j) => ({ at: [j % w, (j / w) | 0], team: s.decoys![j]! }));
}

// ---------- Courier ----------

/** A Courier that moved from `from` onto `t` takes one more tile the same way, when the ground allows (see the top of this file). */
export function courierStride(s: MatchState, a: AgentState, t: number, from: number, ev: MatchEvent[]) {
  const { w, h } = s.map;
  if (a.y * w + a.x !== t) return; // it slid on ice instead
  const first = s.grid[t];
  if (first !== null && first !== 'grass') return;
  if (decoyFor(s, t, a.team) || s.gear?.ground[t]) return;
  const k = 2 * t - from;
  const x = k % w;
  const y = (k / w) | 0;
  if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return;
  const next = s.grid[k];
  if (next !== null && next !== 'grass' && next !== 'item' && next !== 'exit') return;
  if (s.agents.some((o) => o !== a && !o.out && !o.down && o.x === x && o.y === y)) return;
  ev.push({ kind: 'strode', agent: a.id, from: [a.x, a.y], to: [x, y] });
  a.x = x;
  a.y = y;
}
