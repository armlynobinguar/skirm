// Puzzle mode: a solo board solved in as few ticks as possible. Each puzzle is a small hand-made map
// with fixed hazards and a goal (deliver items, reach a tile, or hold out for a number of ticks). It
// plays on the ordinary v2 engine: the board is a normal v2 map whose right half is solid rock with
// the rival crew's starts sealed in single-tile pockets (start tiles never flood), so the rival crew
// is inert. It fields as many agents as the player (no head start either way), never moves, never
// speaks and may tell no bluffs. The engine is deterministic, so a puzzle's map and the player's
// crew and choices are the whole setup: the same crew playing the same moves always scores the same.
//
// A run ends on the puzzle's own check (puzzleStatus), applied after every tick: solved on the goal,
// failed when the whole crew is removed or the tick cap runs out. Score is ticks (lower is better);
// a hold-out puzzle scores its length plus DOWN_TICKS per knock-down, less SURVIVE_DELIVERY_BONUS per
// item delivered. Medals are score thresholds per puzzle (at or under).
//
// Puzzle layouts are written as the left half of the board, the centre column last: '1'..'3' are
// the crew's starts and 'X' a reach goal (both open floor), every other character a v2 map tile.
import type { MapDefV2, MapVerb, HazardKind, Team } from './map';
import { DOWN_TICKS, type AgentSpec, type MatchResult, type MatchState } from './match';

export type PuzzleGoal =
  /** Deliver `count` items to the delivery point. */
  | { kind: 'deliver'; count: number }
  /** Get any agent of the crew (standing) onto the tile. */
  | { kind: 'reach'; at: [number, number] }
  /** Keep at least one agent in the match until tick `ticks`. */
  | { kind: 'survive'; ticks: number };

export type PuzzleMedal = 'gold' | 'silver' | 'bronze';
export const PUZZLE_MEDALS: readonly PuzzleMedal[] = ['gold', 'silver', 'bronze'];

/** Each item delivered takes this many ticks off a hold-out score. */
export const SURVIVE_DELIVERY_BONUS = 5;
/** Puzzle runs an account may start per rolling hour. */
export const PUZZLE_RUNS_PER_HOUR = 30;
/** The inert crew's agent ids are `<prefix>-<n>`. */
export const PUZZLE_RIVAL_PREFIX = 'pz';

export interface PuzzleDef {
  /** `pz-<n>`, stable: best results key on it. */
  id: string;
  /** 1-based order in the puzzle list. */
  n: number;
  title: string;
  /** Two sentences shown on the puzzle card. */
  briefing: string;
  /** Most agents the player fields. */
  crewSize: 1 | 2 | 3;
  /** The run ends failed on this tick if the goal is not met. */
  cap: number;
  /** Score at or under each threshold earns that medal (gold < silver < bronze). */
  medals: Record<PuzzleMedal, number>;
  item: string;
  deliverTo: string;
  /** The left half of the board, centre column last (see the header). */
  layout: string[];
  hazards: { kind: HazardKind; every: number; cap: number }[];
  blockSupply: number;
  kind: PuzzleGoal['kind'];
  /** deliver: items to deliver; survive: ticks to hold out (reach reads its tile off the layout). */
  target?: number;
}

/** The verbs every puzzle board offers (one per effect class a crew can use there). */
const PUZZLE_VERBS: MapVerb[] = [
  { id: 'clear_rubble', name: 'Clear rubble', effect: 'remove_solid' },
  { id: 'brace_wall', name: 'Brace a wall', effect: 'add_solid' },
  { id: 'douse', name: 'Douse flames', effect: 'extinguish' },
  { id: 'push_crate', name: 'Push a crate', effect: 'push' },
];

export const PUZZLES: readonly PuzzleDef[] = [
  {
    id: 'pz-1',
    n: 1,
    title: 'First Steps',
    briefing: 'One crate of rations sits at the end of a winding store room. Bring it to the hatch.',
    crewSize: 1,
    cap: 60,
    medals: { gold: 17, silver: 20, bronze: 26 },
    item: 'Rations',
    deliverTo: 'Hatch',
    kind: 'deliver',
    target: 1,
    hazards: [],
    blockSupply: 0,
    layout: [
      '###########',
      '#1....#...#',
      '#.###.#.#.#',
      '#...#...#*#',
      '###.#####.#',
      '#.........E',
      '#.#####.#.#',
      '#.......#.#',
      '###########',
    ],
  },
  {
    id: 'pz-2',
    n: 2,
    title: 'Rubble Run',
    briefing: 'The beacon is behind a rockfall. Dig straight through or walk the long way round: a Digger clears rubble in one blow.',
    crewSize: 1,
    cap: 70,
    medals: { gold: 8, silver: 10, bronze: 16 },
    item: 'Ore',
    deliverTo: 'Lift',
    kind: 'reach',
    hazards: [],
    blockSupply: 0,
    layout: [
      '###########',
      '#1..d...X.#',
      '#.###d###.#',
      '#...#.#...#',
      '###.#.#.###',
      '#.........E',
      '#.#######.#',
      '#.........#',
      '###########',
    ],
  },
  {
    id: 'pz-3',
    n: 3,
    title: 'Rising Tide',
    briefing: 'Water creeps in from the sluice every few ticks. Fetch both water jugs before the tide cuts the lane.',
    crewSize: 2,
    cap: 80,
    medals: { gold: 16, silver: 22, bronze: 34 },
    item: 'Water jug',
    deliverTo: 'Stilt shelter',
    kind: 'deliver',
    target: 2,
    hazards: [{ kind: 'water', every: 4, cap: 6 }],
    blockSupply: 2,
    layout: [
      '###########',
      '#~~....*..#',
      '#.........#',
      '#1..##.##.#',
      '#2....#...E',
      '#...###.#.#',
      '#.......*.#',
      '#~~.......#',
      '###########',
    ],
  },
  {
    id: 'pz-4',
    n: 4,
    title: 'Firebreak',
    briefing: 'A grass fire races across the meadow toward the signal tower. Reach the tower before the flames close the path.',
    crewSize: 1,
    cap: 60,
    medals: { gold: 14, silver: 22, bronze: 36 },
    item: 'Torch',
    deliverTo: 'Tower',
    kind: 'reach',
    hazards: [{ kind: 'fire', every: 2, cap: 8 }],
    blockSupply: 0,
    layout: [
      '###########',
      '#,,,,,,,,,#',
      '#,,,,,^,,,#',
      '#1..,,,..,#',
      '#.##,#,##.#',
      '#.,,,,,,,.E',
      '#.,,,#,,X,#',
      '#,,,,,,,,,#',
      '###########',
    ],
  },
  {
    id: 'pz-5',
    n: 5,
    title: 'Hold Out',
    briefing: 'Flood season: stay in for 40 ticks. Every jug you deliver takes 5 ticks off your time, every knock-down adds 4.',
    crewSize: 2,
    cap: 40,
    medals: { gold: 15, silver: 25, bronze: 33 },
    item: 'Water jug',
    deliverTo: 'Stilt shelter',
    kind: 'survive',
    target: 40,
    hazards: [{ kind: 'water', every: 6, cap: 4 }],
    blockSupply: 2,
    layout: [
      '###########',
      '#~...*....#',
      '#.##.#.##.#',
      '#*.#...#*.#',
      '#..#1.2#..E',
      '#*.#...#..#',
      '#.##.#.##.#',
      '#~...*....#',
      '###########',
    ],
  },
  {
    id: 'pz-6',
    n: 6,
    title: 'Many Hands',
    briefing: 'Four ore chunks lie around a lava vent. Lava removes whoever it reaches: split the work and stay off its edge.',
    crewSize: 3,
    cap: 100,
    medals: { gold: 15, silver: 20, bronze: 32 },
    item: 'Ore',
    deliverTo: 'Cage lift',
    kind: 'deliver',
    target: 4,
    hazards: [{ kind: 'lava', every: 6, cap: 3 }],
    blockSupply: 0,
    layout: [
      '###########',
      '#1...*....#',
      '#2.#####..#',
      '#3.#...#*.#',
      '#..#.L.#..E',
      '#..#...#..#',
      '#*.##.##..#',
      '#....*....#',
      '###########',
    ],
  },
];

export function puzzleById(id: string): PuzzleDef | undefined {
  return PUZZLES.find((p) => p.id === id);
}

/** The puzzle's goal, read off its definition (a reach tile is the layout's 'X'). */
export function puzzleGoal(p: PuzzleDef): PuzzleGoal {
  if (p.kind === 'deliver') return { kind: 'deliver', count: p.target ?? 1 };
  if (p.kind === 'survive') return { kind: 'survive', ticks: p.target ?? p.cap };
  for (let y = 0; y < p.layout.length; y++) {
    const x = p.layout[y]!.indexOf('X');
    if (x >= 0) return { kind: 'reach', at: [x, y] };
  }
  throw new Error(`${p.id}: a reach puzzle needs an X on its layout`);
}

/**
 * The full v2 map of a puzzle: the layout's half, then the rival's half as solid rock with a sealed
 * single-tile pocket at each mirrored start. Reach and hold-out puzzles set a goal no board can meet
 * (more than its items), so only the puzzle's own check ends them early.
 */
export function puzzleMap(p: PuzzleDef): MapDefV2 {
  const h = p.layout.length;
  const half = p.layout[0]!.length;
  const w = half * 2 - 1;
  const startsA: [number, number][] = [];
  let exit: [number, number] = [half - 1, 1];
  let items = 0;
  const left = p.layout.map((row, y) =>
    [...row]
      .map((ch, x) => {
        if (ch >= '1' && ch <= '3') {
          startsA[Number(ch) - 1] = [x, y];
          return '.';
        }
        if (ch === 'X') return '.';
        if (ch === 'E') exit = [x, y];
        if (ch === '*') items++;
        return ch;
      })
      .join(''),
  );
  const starts = { A: startsA, B: startsA.map(([x, y]) => [w - 1 - x, y] as [number, number]) };
  const rows = left.map((row, y) => {
    const right = Array.from({ length: half - 1 }, (_, i) => {
      const x = half + i;
      return starts.B.some(([bx, by]) => bx === x && by === y) ? '.' : '#';
    }).join('');
    return row + right;
  });
  const g = puzzleGoal(p);
  return {
    schema: 'skirm.map/v2',
    id: `puzzle-${p.id}`,
    code: `PZ-${String(p.n).padStart(2, '0')}`,
    name: p.title,
    region: 'Puzzle',
    difficulty: 1,
    label: 'Puzzle',
    blurb: p.briefing,
    item: p.item,
    deliverTo: p.deliverTo,
    goal: g.kind === 'deliver' ? g.count : items + 1,
    rows,
    starts,
    exit,
    verbs: PUZZLE_VERBS,
    hazards: p.hazards,
    switches: [],
    drops: [],
    blockSupply: p.blockSupply,
    fog: false,
    steal: false,
    night: false,
  };
}

/** The inert crew: as many agents as the player fields, on the Quiet tier (no free text, no bluffs). */
export function puzzleRivals(size: number): AgentSpec[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `${PUZZLE_RIVAL_PREFIX}-${i + 1}`,
    name: 'Rock',
    role: 'Runner' as const,
    vision: 1,
    comms: 1,
    tier: 'quiet' as const,
  }));
}

/** The match options a puzzle plays with (crew B never acts: it holds the whole run and tells no bluffs). */
export function puzzleMatchOptions(p: PuzzleDef): { ticks: number; difficulty: 'normal'; hold: Partial<Record<Team, number>>; lieCap: Partial<Record<Team, number>> } {
  return { ticks: p.cap, difficulty: 'normal', hold: { B: p.cap }, lieCap: { B: 0 } };
}

export type PuzzleStatus = 'solved' | 'failed';

/** Where a puzzle run stands after a tick: solved, failed (crew removed or tick cap), or still on (null). */
export function puzzleStatus(p: PuzzleDef, s: Readonly<MatchState>): PuzzleStatus | null {
  const crew = s.agents.filter((a) => a.team === 'A');
  const g = puzzleGoal(p);
  if (crew.every((a) => a.out)) return 'failed';
  if (g.kind === 'deliver' && s.score.A >= g.count) return 'solved';
  if (g.kind === 'reach' && crew.some((a) => !a.out && !a.down && a.x === g.at[0] && a.y === g.at[1])) return 'solved';
  if (g.kind === 'survive' && s.tick >= g.ticks) return 'solved';
  if (s.tick >= p.cap) return 'failed';
  return null;
}

/** A puzzle's status as a match result (crew A wins a solved run), or null while it is still on. */
export function puzzleResult(p: PuzzleDef, s: Readonly<MatchState>): MatchResult | null {
  const st = puzzleStatus(p, s);
  if (!st) return null;
  const base = { score: { ...s.score }, ticks: s.tick };
  if (st === 'solved') return { winner: 'A', reason: 'goal', decidedBy: 'goal', ...base };
  const out = s.agents.filter((a) => a.team === 'A').every((a) => a.out);
  return { winner: 'draw', reason: out ? 'eliminated' : 'time', decidedBy: 'draw', ...base };
}

/**
 * A solved run's score (lower is better): its ticks; a hold-out scores its length plus DOWN_TICKS
 * per knock-down, less SURVIVE_DELIVERY_BONUS per item delivered (at least 1).
 */
export function puzzleScore(p: PuzzleDef, run: { ticks: number; knockdowns: number; delivered: number }): number {
  if (p.kind !== 'survive') return run.ticks;
  return Math.max(1, run.ticks + DOWN_TICKS * run.knockdowns - SURVIVE_DELIVERY_BONUS * run.delivered);
}

/** The best medal a score earns, or null above the bronze threshold. */
export function puzzleMedal(p: Pick<PuzzleDef, 'medals'>, score: number): PuzzleMedal | null {
  return PUZZLE_MEDALS.find((m) => score <= p.medals[m]) ?? null;
}

/** One line for agents (and the model prompt): what solves the puzzle. */
export function puzzleObjectiveText(p: PuzzleDef): string {
  const g = puzzleGoal(p);
  const base =
    g.kind === 'deliver'
      ? `deliver ${g.count} ${p.item} to the ${p.deliverTo}`
      : g.kind === 'reach'
        ? `get any agent of your crew onto tile ${g.at[0]},${g.at[1]}`
        : `keep your crew in for ${g.ticks} ticks; each ${p.item} delivered takes ${SURVIVE_DELIVERY_BONUS} ticks off your time and each knock-down adds ${DOWN_TICKS}`;
  return `Puzzle "${p.title}": ${base}, in as few ticks as you can. There is no rival crew; the agents on the right are rock. Run cap ${p.cap} ticks.`;
}
