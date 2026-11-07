// Typed access to the prototype's v2 world (./proto/world.ts): the 10-map roster with mirrored
// 2-crew arenas, and the draw calls the arena canvas needs. Screens read maps through here, never
// through the proto module directly.
import type { Dress, Social } from '@skirm/ui';
import { mapV2, type Difficulty as DifficultyKey, type GoalCheck, type TalkTier } from '@skirm/engine/v2';
import type { LiveGear } from './gear';
import * as proto from './proto/world';

export type { DifficultyKey, GoalCheck };

export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type EffectClass =
  | 'grow'
  | 'add_solid'
  | 'remove_solid'
  | 'push'
  | 'add_liquid'
  | 'ignite'
  | 'extinguish'
  | 'area_repel'
  | 'take'
  | 'deliver';

/** A generated arena: tiles row-major, mirrored starts, the shared delivery point. */
export interface Arena {
  w: number;
  h: number;
  grid: (string | null)[];
  starts: { A: [number, number][]; B: [number, number][] };
  exit: [number, number];
  /** Items a crew must deliver to win. */
  n: number;
  valves: { pos: [number, number]; name: string; kind: string }[];
  drops: [number, number, number][];
  fog?: boolean;
  steal?: boolean;
  night?: boolean;
  /** Difficulty rules this arena was generated from. */
  spec: ArenaSpec;
}

/** Per-difficulty arena rules (the prototype's SPEC). */
export interface ArenaSpec {
  size: [number, number];
  /** Half-width of the open middle band. */
  band: number;
  routes: number;
  /** Contested items in the middle. */
  cont: number;
  valves: number;
  /** Supply drop ticks. */
  drops: number[];
  /** Items on each crew's own half. */
  own: number;
  fog: boolean;
  steal: boolean;
  night: boolean;
}

export interface V2Map {
  id: string;
  /** Short code, e.g. "CH-05". */
  code: string;
  name: string;
  region: string;
  diff: Difficulty;
  /** Tier label: Tutorial, Starter, Standard, Veteran, Extreme or Elite. */
  label: string;
  blurb: string;
  mood: string;
  /** Public pressure, e.g. "Pump shaft floods every 8 s". */
  pressure: string;
  /** Themed verbs: [theme text, effect class]. */
  verbs: [string, EffectClass][];
  /** The role this map rewards (Builder, Digger, ...). */
  unlock: string;
  /** Goal item and delivery point names. */
  item: string;
  exitN: string;
  crew: string;
  /** Hazards and how often they spread, in ticks, e.g. { water: 4 }. */
  ev: Record<string, number>;
  /** Waves a hazard grows before it recedes. */
  cap: number;
  /** The generated arena. */
  A: Arena;
}

export const MAPS = proto.MAPS as unknown as V2Map[];
/** Index of today's ranked rotation map (Copper Hollow, the hand-built arena). */
export const ROTATION_INDEX: number = proto.ROT;

/** Community maps loaded this session (features/maps/convert.ts registers them), by id. */
const extraMaps = new Map<string, V2Map>();

/** Makes a community map findable by mapById (the crew screen, the match screen, the arena). */
export function registerMap(m: V2Map): void {
  extraMaps.set(m.id, m);
}

export function mapById(id: string): V2Map | undefined {
  return MAPS.find((m) => m.id === id) ?? extraMaps.get(id);
}

/** The atlas puts the first five maps on the teal Starter side and the last five on the red Veteran side. */
export function isStarter(m: V2Map): boolean {
  return MAPS.indexOf(m) < 5;
}

/** An agent on the board: crew side, place, carried items, and (live frames) what it is doing. */
export interface ArenaAgent {
  id: string;
  name: string;
  team: 'A' | 'B';
  slot: number;
  x: number;
  y: number;
  inv: unknown[];
  tool?: string;
  /** Its role (Builder, Digger, ...): picks the figure's look. Absent: the generic look. */
  role?: string;
  /** Removed from the match (hidden). */
  out?: boolean;
  /** Knocked down this tick (drawn tipped over until it gets back up). */
  down?: boolean;
  /** Stunned (stars and a wobble). */
  stun?: boolean;
  /** Last tick the stun lasts (carried from frame to frame). */
  stunTill?: number;
  /** The verb effect it used this tick ('remove_solid' for a dig, 'tool' for a tool). */
  act?: string | null;
  /** It delivered this tick (a short celebration). */
  cheer?: boolean;
  /** Body (outfit) and head (skin) colours; absent: the crew's default palette. */
  c?: string;
  bone?: string;
  /** How its owner dressed it (live frames with a look). */
  dress?: Dress;
  /** How it reacts to the others this frame (live.ts socialOf; render only). */
  social?: Social;
  /** The tile it turns toward for that reaction (who it talks to, the rival it squares up to). */
  faceTo?: [number, number];
  /** What it is going for right now (live.ts intentsOf; render only): drawn beside its nameplate. */
  intent?: 'item' | 'exit' | 'switch';
}

/** A board state the renderer draws: tiles plus agents with their crew side. */
export interface ArenaState {
  grid: (string | null)[];
  agents: ArenaAgent[];
  /** Tiles under a gas cloud (live matches on maps with gas vents). */
  gas?: number[];
  /** Electrified water tiles (live matches on maps with sparking cables). */
  shock?: number[];
  /** Tools on the ground and placed objects (live v2 frames only; absent: none). */
  gear?: LiveGear | null;
}

const resting = new Map<string, ArenaState>();
/** The map at rest: two of your agents and two rivals on their starts (the prototype's restOf). */
export function restingState(m: V2Map): ArenaState {
  let s = resting.get(m.id);
  if (!s) {
    const R = proto.ROSTER;
    const B = proto.RIVALS;
    // Ice patches are the engine map's, not the prototype's: lay them on the resting board too.
    const grid = m.A.grid.slice();
    for (const [x, y] of mapV2(m.id)?.ice ?? []) grid[y * m.A.w + x] = 'ice';
    s = {
      grid,
      agents: [
        ...m.A.starts.A.slice(0, 2).map(([x, y], i) => ({ ...R[i]!, team: 'A' as const, slot: i, x, y, inv: [] })),
        ...m.A.starts.B.slice(0, 2).map(([x, y], i) => ({ ...B[i]!, team: 'B' as const, slot: i, x, y, inv: [] })),
      ],
    };
    resting.set(m.id, s);
  }
  return s;
}

/** One match difficulty as the prototype draws it (DIFFS). The engine's rules are DIFF_MODS in @skirm/engine/v2. */
export interface DiffLevel {
  k: DifficultyKey;
  /** Name, e.g. "Mega Agentic". */
  n: string;
  /** Tag colour. */
  c: string;
  /** Hazard interval scale (above 1: slower). */
  haz: number;
  /** Wave cap change. */
  cap: number;
  /** Rival bluff cap. */
  lies: number;
  /** Change to the items needed. */
  dn: number;
  /** Clock in ticks. */
  limit: number;
  rivalTalk: TalkTier;
  /** Extra rival hold, ticks. */
  wait?: number;
  fog?: boolean;
  night?: boolean;
  /** Full rival crew. */
  full?: boolean;
  /** One line for the picker. */
  line: string;
}

/** Easy, Normal, Hard, Agentic, Mega Agentic (picker order; ranked is Normal, index 1). */
export const DIFFS = proto.DIFFS as unknown as readonly DiffLevel[];

export function diffIndex(k: DifficultyKey): number {
  return Math.max(0, DIFFS.findIndex((d) => d.k === k));
}

/** A goal's check and threshold, e.g. ['verb', 3]. */
export type GoalCheckRow = [check: GoalCheck, n?: number];
/** [title, what to do, check]. */
export type GoalRow = [title: string, text: string, check: GoalCheckRow];

/** Five goals per map, one per difficulty (DIFFS order). */
export const GOALS = proto.GOALS as unknown as Readonly<Record<string, readonly GoalRow[]>>;

export interface MapGoal {
  /** Title. */
  t: string;
  /** What to do. */
  d: string;
  chk: GoalCheckRow;
}

/** The goal of a map at difficulty index `d` (a plain win for a map without goals). */
export function goalOf(m: V2Map, d: number): MapGoal {
  return proto.goalOf(m, d) as MapGoal;
}

/** 22×22 stroke icon paths per effect class (the prototype's VERB_ICON). */
export const VERB_ICON = proto.VERB_ICON as Readonly<Record<string, string>>;

/** The heard-by ear glyph, a 24×24 stroke path (the prototype's EAR_D). */
export const EAR_D: string = proto.EAR_D;
