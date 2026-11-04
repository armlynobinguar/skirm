// The v2 match: two crews of 1 to 3 agents on one shared mirrored map, 150 ticks of 2 s (5:00).
// Deterministic: the same map, crews and per-tick inputs always give the same match. Agents (or
// models) only choose; the engine decides what happens.
//
// Each tick, in order (design doc "Match format"):
//   1. timers: switch floods run out, cooldowns tick down, supply drops land (known to both crews)
//   2. every agent's action resolves together: verbs first, then moves (two agents stepping onto one
//      tile both stay put), digging takes three hits by hand; an agent standing in gas loses every
//      other action, and a mover that lands on ice slides one more tile the same way unless blocked
//   3. pickups and deliveries
//   4. the environment: hazards spread for `cap` waves, then recede, then grow again; anyone a
//      hazard reaches is knocked down (lava removes them). Then gas clouds drift and thin (vents
//      puff), and sparking cables electrify the water they touch (anyone on or next to it is stunned)
//   5. what each crew can see (fog)
//   6. talk: messages sent this tick are delivered to whoever hears them, bluffs among them (bluff.ts,
//      judged on what the crews see now), then the goal check
//
// A difficulty level (difficulty.ts) rewrites the map's rules before the first tick. Each crew keeps
// a running tally (middle items, verbs, switches, steals, knock-downs, talk) for goals and the debrief.
import { talkHold } from '@skirm/shared';
import { avoidedTile, BLUFF_CAP, judgeBluffs, planBluffs } from './bluff';
import type { Difficulty } from './difficulty';
import { DIFF_MODS, RANKED_DIFFICULTY, withDifficulty } from './difficulty';
import type { ItemOrigin } from './frame';
import type { Dir, EffectClass, HazardKind, MapDefV2, ParsedMap, Team, Tile } from './map';
import { middleTiles, parseMapV2 } from './map';
import { deliverTalk, TALK_TIERS, type HeardMessage, type SayInput, type TalkTier } from './talk';

export const TICK_MS = 2000;
export const MATCH_TICKS = 150;
export const DOWN_TICKS = 4;
export const STUN_TICKS = 3;
export const FLOOD_TICKS = 8;
export const SWITCH_COOLDOWN = 26;
export const REPEL_RADIUS = 2;
export const REPEL_COOLDOWN = 15;
/** Each agent a crew fields beyond the rival's gives the rival a 10 s head start. */
export const HEAD_START_TICKS_PER_AGENT = 5;
export const DIG_HITS = 3;
/** Ticks an agent on or next to electrified water is stunned. */
export const SHOCK_STUN = 2;

export type Role = 'Builder' | 'Digger' | 'Firefighter' | 'Scout' | 'Runner' | 'Hauler';
export const ROLES: readonly Role[] = ['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'];
/** The effect class only this role can use. Verbs of other classes are open to everyone. */
export const ROLE_EFFECT: Readonly<Record<Role, EffectClass | null>> = {
  Builder: 'add_solid',
  Digger: 'remove_solid',
  Firefighter: 'extinguish',
  Scout: 'area_repel',
  Runner: null,
  Hauler: null,
};
const GATED = new Set<EffectClass>(['add_solid', 'remove_solid', 'extinguish', 'area_repel']);
/** Items an agent can carry: Haulers carry 3. */
export const carryOf = (role: Role) => (role === 'Hauler' ? 3 : 2);

export interface AgentSpec {
  id: string;
  name: string;
  role: Role;
  /** 1 to 5: how far the agent sees (1 + vision tiles, one less at night). */
  vision: number;
  /** 1 to 5: how far its voice carries (2 + comms tiles). */
  comms: number;
  tier: TalkTier;
}

export interface MatchOptions {
  /** Ranked fixes every agent's talk tier at Standard and always plays Normal. */
  ranked?: boolean;
  /** Match length; defaults to the difficulty's clock (150 ticks on Normal). */
  ticks?: number;
  /** Casual difficulty (DIFF_MODS, see withDifficulty); Normal when unset. Ignored in ranked. */
  difficulty?: Difficulty;
  /** Extra ticks a crew holds at the start, on top of the head start (the practice bot on Easy). */
  hold?: Partial<Record<Team, number>>;
  /** Bluffs each crew may tell this match (BLUFF_CAP when unset; the practice bot's from the difficulty). */
  lieCap?: Partial<Record<Team, number>>;
}

export type Action = { type: 'wait' } | { type: 'move'; dir: Dir } | { type: 'verb'; verb: string; dir?: Dir } | { type: 'switch' };

export interface AgentState {
  id: string;
  name: string;
  team: Team;
  slot: number;
  role: Role;
  vision: number;
  comms: number;
  tier: TalkTier;
  x: number;
  y: number;
  start: [number, number];
  /** Tile indexes the carried items came from. */
  carrying: number[];
  /** Where and when each carried item was picked up, in step with `carrying`. */
  tags: CarriedTag[];
  /** Ticks left knocked down (0: up). */
  down: number;
  stun: number;
  /** Removed for the rest of the match (lava). */
  out: boolean;
  delivered: number;
  /** Items picked up this match (debrief, MVP). */
  picks: number;
  /** Themed verbs and switches this agent used, plus digs a Digger finished (debrief, MVP). */
  used: number;
  /** Tick each verb can be used again. */
  cooldown: Record<string, number>;
  lastSpoke: number;
  /** Messages heard last tick, read when choosing this tick. */
  inbox: HeardMessage[];
  /** A bluff this agent believed: it treats `tile` as empty until tick `until` (bluff.ts). */
  avoid: { tile: number; until: number } | null;
  /** The last bluff told to this agent: who, about which tile, on which tick, and whether it believed it. */
  heardBluff: { by: string; tile: number; tick: number; believed: boolean } | null;
  /** Bluffs it told and the rival believed, and rival bluffs it heard and doubted (the agent record). */
  bluffs: { told: number; landed: number; seenThrough: number };
  /** Lost last tick's action to gas: it acts this tick even in gas (gas halves an agent's pace). */
  gasp?: boolean;
}

export type MatchEvent =
  | { kind: 'verb'; agent: string; verb: string; effect: EffectClass; at: [number, number] }
  | { kind: 'dug'; agent: string; at: [number, number]; done: boolean }
  | { kind: 'blocked'; agent: string }
  | { kind: 'picked'; agent: string; at: [number, number]; stolen: boolean; origin: ItemOrigin }
  | { kind: 'delivered'; agent: string; team: Team; count: number; score: number }
  | { kind: 'knocked_down'; agent: string; by: HazardKind | 'switch'; dropped: number }
  | { kind: 'eliminated'; agent: string; by: HazardKind }
  | { kind: 'respawned'; agent: string }
  | { kind: 'stunned'; agent: string; by: string }
  | { kind: 'switch'; agent: string; name: string; floods: Team; until: number }
  | { kind: 'supply_drop'; at: [number, number] }
  | { kind: 'hazard'; hazard: HazardKind; wave: number; receding: boolean }
  | { kind: 'said'; agent: string; channel: 'say' | 'team'; text: string; heardBy: string[]; overheardBy: string[]; bluff?: true }
  | { kind: 'bluff'; agent: string; victim: string; at: [number, number]; believed: boolean }
  | { kind: 'refused'; agent: string; reason: string }
  /** Gas: the agent lost this tick's action coughing. */
  | { kind: 'choked'; agent: string }
  /** Ice: the agent slid one more tile after its move. */
  | { kind: 'slid'; agent: string; from: [number, number]; to: [number, number] }
  /** A sparking cable electrified the water it touches until `until`; `tiles` is how many water tiles. */
  | { kind: 'sparked'; name: string; at: [number, number]; until: number; tiles: number }
  /** Electrified water stunned the agent (`by`: the cable's name). */
  | { kind: 'shocked'; agent: string; by: string }
  /** A gas vent puffed. */
  | { kind: 'gas_vent'; at: [number, number] };

export interface MatchResult {
  winner: Team | 'draw';
  /** goal: a crew delivered the goal; time: the clock ran out; eliminated: a crew was all removed. */
  reason: 'goal' | 'time' | 'eliminated';
  /** What decided it at time-out: more delivered, fewer agents fielded, reached its score first. */
  decidedBy: 'score' | 'fewer_agents' | 'earlier' | 'draw' | 'goal';
  score: Record<Team, number>;
  ticks: number;
}

export interface CarriedTag {
  origin: ItemOrigin;
  /** Tick it was picked up. */
  tick: number;
}

/** Running counts per crew, for goals and the debrief. */
export interface CrewTally {
  /** Middle item tiles this crew took (each counted once). */
  middle: number[];
  /** Themed verbs and switches used, plus digs a Digger finished (the prototype's verbsUsed). */
  verbs: number;
  /** Shared switches used on the rival. */
  switches: number;
  /** Rival-dropped items picked up. */
  steals: number;
  /** Times an agent was knocked down or removed (hazard or switch). */
  swept: number;
  /** Messages sent. */
  sent: number;
  /** Rival team messages at least one of this crew's agents overheard. */
  overheard: number;
  /** Bluffs told to the rival (each reached its target). */
  lies: number;
  /** Of those, the ones the rival believed. */
  believed: number;
}

export interface MatchState {
  map: ParsedMap;
  /** The level the match plays (the map in `map` already has its rules applied). */
  difficulty: Difficulty;
  /** Middle item tiles at the start (middleTiles). */
  middle: number[];
  tally: Record<Team, CrewTally>;
  tick: number;
  limit: number;
  grid: (Tile | null)[];
  agents: AgentState[];
  score: Record<Team, number>;
  /** Tick each crew reached its current score (tiebreak). */
  scoredAt: Record<Team, number>;
  /** Bluffs each crew may tell this match. */
  lieCap: Record<Team, number>;
  /** Ticks each crew waits at the start: the larger crew waits 5 per agent of difference, plus any `hold`. */
  holdTicks: Record<Team, number>;
  blocks: Record<Team, number>;
  /** Dig hits so far per dirt tile. */
  dig: Record<number, number>;
  /** Dropped items by tile, and the crew that dropped them. */
  dropped: Record<number, Team>;
  hazards: Record<string, { waves: (readonly [number, Tile | null])[][]; receding: boolean; count: number }>;
  floods: { team: Team; until: number; tiles: number[]; kind: Tile }[];
  switchReady: number[];
  /** Gas strength by tile (absent: clear air). */
  gas: Record<number, number>;
  /** Tick each sparking cable stops (map order); live while tick < it. */
  sparkUntil: number[];
  /** Water tiles electrified this tick. */
  shocked: number[];
  /** Fog: per crew, the last tile seen at each index (undefined: never seen). */
  seen: Record<Team, (Tile | null | undefined)[]>;
  visible: Record<Team, boolean[]>;
  result: MatchResult | null;
}

const DIRS: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const DIR_LIST: Dir[] = ['N', 'E', 'S', 'W'];
const SOLID = new Set<Tile>(['wall', 'tree', 'crate', 'block', 'valve', 'dirt']);
const HAZ = new Set<Tile>(['water', 'fire', 'lava']);

export function createMatch(def: MapDefV2, crews: Record<Team, AgentSpec[]>, opts: MatchOptions = {}): MatchState {
  const difficulty = opts.ranked ? RANKED_DIFFICULTY : (opts.difficulty ?? RANKED_DIFFICULTY);
  const map = parseMapV2(withDifficulty(def, difficulty));
  for (const T of ['A', 'B'] as const) {
    const n = crews[T].length;
    if (n < 1 || n > 3) throw new Error(`crew ${T} must field 1 to 3 agents`);
    if (n > def.starts[T].length) throw new Error(`${def.id} has ${def.starts[T].length} starts for crew ${T}`);
  }
  const ids = new Set<string>();
  const agents: AgentState[] = [];
  for (const T of ['A', 'B'] as const)
    crews[T].forEach((spec, slot) => {
      if (ids.has(spec.id)) throw new Error(`agent ${spec.id} twice`);
      ids.add(spec.id);
      const [x, y] = def.starts[T][slot]!;
      agents.push({
        id: spec.id,
        name: spec.name,
        team: T,
        slot,
        role: spec.role,
        vision: clamp(spec.vision, 1, 5),
        comms: clamp(spec.comms, 1, 5),
        tier: opts.ranked ? 'standard' : spec.tier,
        x,
        y,
        start: [x, y],
        carrying: [],
        tags: [],
        down: 0,
        stun: 0,
        out: false,
        delivered: 0,
        picks: 0,
        used: 0,
        cooldown: {},
        lastSpoke: -Infinity,
        inbox: [],
        avoid: null,
        heardBluff: null,
        bluffs: { told: 0, landed: 0, seenThrough: 0 },
      });
    });
  const diff = crews.A.length - crews.B.length;
  const size = map.w * map.h;
  const tally = (): CrewTally => ({ middle: [], verbs: 0, switches: 0, steals: 0, swept: 0, sent: 0, overheard: 0, lies: 0, believed: 0 });
  const s: MatchState = {
    map,
    difficulty,
    middle: middleTiles(map),
    tally: { A: tally(), B: tally() },
    tick: 0,
    limit: opts.ticks ?? DIFF_MODS[difficulty].ticks,
    grid: map.grid.slice(),
    agents,
    score: { A: 0, B: 0 },
    scoredAt: { A: 0, B: 0 },
    holdTicks: {
      A: (diff > 0 ? diff * HEAD_START_TICKS_PER_AGENT : 0) + Math.max(0, opts.hold?.A ?? 0),
      B: (diff < 0 ? -diff * HEAD_START_TICKS_PER_AGENT : 0) + Math.max(0, opts.hold?.B ?? 0),
    },
    lieCap: { A: Math.max(0, opts.lieCap?.A ?? BLUFF_CAP), B: Math.max(0, opts.lieCap?.B ?? BLUFF_CAP) },
    blocks: { A: def.blockSupply, B: def.blockSupply },
    dig: {},
    dropped: {},
    hazards: {},
    floods: [],
    switchReady: def.switches.map(() => 0),
    gas: {},
    sparkUntil: (def.sparks ?? []).map(() => 0),
    shocked: [],
    seen: { A: new Array(size), B: new Array(size) },
    visible: { A: new Array(size).fill(false), B: new Array(size).fill(false) },
    result: null,
  };
  // Both crews know where every item starts (the prototype's known items): fog hides what happens
  // to them later, not where they were laid out.
  s.grid.forEach((t, i) => {
    if (t !== 'item') return;
    s.seen.A[i] = 'item';
    s.seen.B[i] = 'item';
  });
  updateSight(s);
  return s;
}

/** A deep copy (the grid and agents are plain data). */
export function cloneMatch(s: MatchState): MatchState {
  return { ...structuredClone({ ...s, map: undefined }), map: s.map } as MatchState;
}

export interface TickInput {
  actions: Record<string, Action>;
  says?: SayInput[];
}

/** Plays one tick in place and returns what happened. A missing action is a wait. */
export function stepMatch(s: MatchState, input: TickInput): MatchEvent[] {
  if (s.result) return [];
  const ev: MatchEvent[] = [];
  const { w } = s.map;
  const def = s.map.def;
  s.tick++;

  // 1. timers
  s.floods = s.floods.filter((f) => {
    if (s.tick < f.until) return true;
    for (const j of f.tiles) if (s.grid[j] === f.kind) s.grid[j] = null;
    return false;
  });
  for (const d of def.drops)
    if (d.tick === s.tick) {
      const j = idx(s, d.at);
      if (s.grid[j] === null) {
        s.grid[j] = 'item';
        // Announced to both crews, fog or not (the prototype marks a drop as known to both).
        s.seen.A[j] = 'item';
        s.seen.B[j] = 'item';
      }
      ev.push({ kind: 'supply_drop', at: d.at });
    }

  // 2. actions. Agents that cannot act this tick: head start, knocked down, stunned, removed.
  const actors: AgentState[] = [];
  for (const a of s.agents) {
    if (a.out) continue;
    if (a.down > 0) {
      a.down--;
      if (a.down === 0) {
        [a.x, a.y] = a.start;
        ev.push({ kind: 'respawned', agent: a.id });
      }
      continue;
    }
    if (a.stun > 0) {
      a.stun--;
      continue;
    }
    if (s.tick <= s.holdTicks[a.team]) continue;
    // Gas: every other action is lost while the agent stands in it.
    if (s.gas[a.y * w + a.x] && !a.gasp) {
      a.gasp = true;
      ev.push({ kind: 'choked', agent: a.id });
      continue;
    }
    delete a.gasp;
    actors.push(a);
  }
  const moves = new Map<AgentState, number>();
  for (const a of actors) {
    const act = input.actions[a.id] ?? { type: 'wait' };
    if (act.type === 'move') {
      const [dx, dy] = DIRS[act.dir];
      const j = (a.y + dy) * w + a.x + dx;
      const t = s.grid[j];
      if (t === 'dirt') {
        const hits = (s.dig[j] ?? 0) + (a.role === 'Digger' ? DIG_HITS : 1);
        const done = hits >= DIG_HITS;
        if (done) {
          s.grid[j] = null;
          delete s.dig[j];
          if (a.role === 'Digger') used(s, a);
        } else s.dig[j] = hits;
        ev.push({ kind: 'dug', agent: a.id, at: [a.x + dx, a.y + dy], done });
      } else if (t === null || (t !== undefined && passable(t))) moves.set(a, j);
      else ev.push({ kind: 'blocked', agent: a.id });
    } else if (act.type === 'verb') {
      const refused = useVerb(s, a, act.verb, act.dir, ev);
      if (refused) ev.push({ kind: 'refused', agent: a.id, reason: refused });
      else used(s, a);
    } else if (act.type === 'switch') {
      const refused = useSwitch(s, a, ev);
      if (refused) ev.push({ kind: 'refused', agent: a.id, reason: refused });
      else {
        used(s, a);
        s.tally[a.team].switches++;
      }
    }
  }
  resolveMoves(s, moves, ev);

  // 3. pickups and deliveries
  const [ex, ey] = def.exit;
  for (const a of s.agents) {
    if (a.out || a.down) continue;
    const j = a.y * w + a.x;
    // A fooled agent walks over the item it was told is gone.
    if (s.grid[j] === 'item' && a.carrying.length < carryOf(a.role) && avoidedTile(s, a) !== j) {
      s.grid[j] = null;
      const by = s.dropped[j];
      delete s.dropped[j];
      const origin = originOf(s, j, a.team, by);
      a.carrying.push(j);
      a.tags.push({ origin, tick: s.tick });
      a.picks++;
      const T = s.tally[a.team];
      if (origin === 'stolen') T.steals++;
      if (origin === 'middle' && !T.middle.includes(j)) T.middle.push(j);
      ev.push({ kind: 'picked', agent: a.id, at: [a.x, a.y], stolen: origin === 'stolen', origin });
    }
    if (a.x === ex && a.y === ey && a.carrying.length) {
      const n = a.carrying.length;
      s.score[a.team] += n;
      s.scoredAt[a.team] = s.tick;
      a.delivered += n;
      a.carrying = [];
      a.tags = [];
      ev.push({ kind: 'delivered', agent: a.id, team: a.team, count: n, score: s.score[a.team] });
    }
  }

  // 4. environment
  for (const hz of def.hazards) if (s.tick % hz.every === 0) spreadHazard(s, hz.kind, hz.cap, ev);
  if (def.gas?.length) spreadGas(s, ev);
  if (def.sparks?.length) electrify(s, ev);

  // 5. sight, before talk: a bluff is judged on what the target's crew sees after this tick's moves
  updateSight(s);

  // 6. talk, with any bluff spoken as an ordinary say and judged once it lands
  const says = input.says ?? [];
  const bluffs = planBluffs(s, says);
  const spoken = deliverTalk(s, [...says, ...bluffs.map((b) => b.say)]);
  for (const m of spoken) {
    ev.push(m);
    if (m.kind !== 'said') continue;
    const team = s.agents.find((a) => a.id === m.agent)!.team;
    s.tally[team].sent++;
    if (m.overheardBy.length) s.tally[team === 'A' ? 'B' : 'A'].overheard++;
  }
  ev.push(...judgeBluffs(s, bluffs, spoken));

  s.result = checkResult(s);
  return ev;
}

/** A crew's own drop back is recovered, a rival's is stolen; else the middle, a supply drop, or the crew's own half. */
function originOf(s: MatchState, j: number, team: Team, droppedBy: Team | undefined): ItemOrigin {
  if (droppedBy) return droppedBy === team ? 'recovered' : 'stolen';
  if (s.middle.includes(j)) return 'middle';
  if (s.map.def.drops.some((d) => idx(s, d.at) === j)) return 'drop';
  return 'own';
}

function used(s: MatchState, a: AgentState) {
  a.used++;
  s.tally[a.team].verbs++;
}

function passable(t: Tile): boolean {
  return t === 'item' || t === 'exit' || t === 'grass' || t === 'ice';
}

/** Moves resolve together: shared targets and targets held by agents that stay all block. */
function resolveMoves(s: MatchState, moves: Map<AgentState, number>, ev: MatchEvent[]) {
  const { w } = s.map;
  const from = new Map([...moves.keys()].map((a) => [a, a.y * w + a.x]));
  const count = new Map<number, number>();
  for (const t of moves.values()) count.set(t, (count.get(t) ?? 0) + 1);
  for (const [a, t] of [...moves]) if (count.get(t)! > 1) moves.delete(a), ev.push({ kind: 'blocked', agent: a.id });
  let changed = true;
  while (changed) {
    changed = false;
    const held = new Set(s.agents.filter((a) => !a.out && !a.down && !moves.has(a)).map((a) => a.y * w + a.x));
    for (const [a, t] of [...moves])
      if (held.has(t)) {
        moves.delete(a);
        ev.push({ kind: 'blocked', agent: a.id });
        changed = true;
      }
  }
  for (const [a, t] of moves) {
    a.x = t % w;
    a.y = (t / w) | 0;
  }
  // Ice: a mover that landed on ice slides one more tile the same way, unless that tile is solid,
  // a hazard, the map's edge or held by an agent. Slides resolve in agent order.
  for (const [a, t] of moves) {
    if (s.grid[t] !== 'ice') continue;
    const k = 2 * t - from.get(a)!;
    const x = k % w;
    const y = (k / w) | 0;
    if (x <= 0 || y <= 0 || x >= w - 1 || y >= s.map.h - 1) continue;
    const tt = s.grid[k];
    if (tt !== null && (tt === undefined || !passable(tt))) continue;
    if (s.agents.some((o) => o !== a && !o.out && !o.down && o.x === x && o.y === y)) continue;
    ev.push({ kind: 'slid', agent: a.id, from: [a.x, a.y], to: [x, y] });
    a.x = x;
    a.y = y;
  }
}

/** Uses a themed verb toward `dir` (or around the agent for area_repel). Returns why not, or null. */
function useVerb(s: MatchState, a: AgentState, verbId: string, dir: Dir | undefined, ev: MatchEvent[]): string | null {
  const verb = s.map.def.verbs.find((v) => v.id === verbId);
  if (!verb) return `no verb ${verbId} on this map`;
  if (GATED.has(verb.effect) && ROLE_EFFECT[a.role] !== verb.effect) return `${verb.name} needs a ${roleFor(verb.effect)}`;
  if ((a.cooldown[verb.id] ?? 0) > s.tick) return `${verb.name} is cooling down`;
  const { w } = s.map;
  if (verb.effect === 'area_repel') {
    const hit = s.agents.filter((o) => o.team !== a.team && !o.out && !o.down && manhattan(o, a) <= REPEL_RADIUS);
    for (const o of hit) {
      o.stun = STUN_TICKS;
      ev.push({ kind: 'stunned', agent: o.id, by: a.id });
    }
    a.cooldown[verb.id] = s.tick + REPEL_COOLDOWN;
    ev.push({ kind: 'verb', agent: a.id, verb: verb.id, effect: verb.effect, at: [a.x, a.y] });
    return null;
  }
  if (!dir) return `${verb.name} needs a direction`;
  const [dx, dy] = DIRS[dir];
  const x = a.x + dx;
  const y = a.y + dy;
  const j = y * w + x;
  const t = s.grid[j];
  const occupied = s.agents.some((o) => !o.out && !o.down && o.x === x && o.y === y);
  const edge = x <= 0 || y <= 0 || x >= w - 1 || y >= s.map.h - 1;
  const done = (): null => {
    ev.push({ kind: 'verb', agent: a.id, verb: verb.id, effect: verb.effect, at: [x, y] });
    return null;
  };
  switch (verb.effect) {
    case 'add_solid':
      if (s.blocks[a.team] <= 0) return 'no blocks left';
      if (edge || occupied || (t !== null && t !== 'grass')) return 'that tile is not empty';
      s.grid[j] = 'block';
      s.blocks[a.team]--;
      return done();
    case 'remove_solid':
      if (t !== 'dirt' && t !== 'block' && t !== 'crate' && t !== 'tree') return 'nothing to clear there';
      s.grid[j] = null;
      delete s.dig[j];
      return done();
    case 'extinguish':
      if (t !== 'fire') return 'no fire there';
      s.grid[j] = null;
      return done();
    case 'ignite':
      if (t !== 'grass' && t !== 'tree' && t !== 'crate') return 'nothing to burn there';
      s.grid[j] = 'fire';
      return done();
    case 'add_liquid':
      if (edge || occupied || t !== null) return 'that tile is not empty';
      s.grid[j] = 'water';
      return done();
    case 'grow':
      if (edge || occupied || t !== null) return 'that tile is not empty';
      s.grid[j] = 'grass';
      return done();
    case 'push': {
      if (t !== 'crate') return 'no crate there';
      const j2 = (y + dy) * w + x + dx;
      const beyond = s.grid[j2];
      const blocked = beyond !== null || s.agents.some((o) => !o.out && o.x === x + dx && o.y === y + dy);
      if (blocked || x + dx <= 0 || y + dy <= 0 || x + dx >= w - 1 || y + dy >= s.map.h - 1) return 'the crate is stuck';
      s.grid[j] = null;
      s.grid[j2] = 'crate';
      return done();
    }
    default:
      return `${verb.name} happens on its own`;
  }
}

/** Operates an adjacent shared switch: the rival crew's lane floods, burns or fills for 8 ticks. */
function useSwitch(s: MatchState, a: AgentState, ev: MatchEvent[]): string | null {
  const k = s.map.def.switches.findIndex((sw) => manhattan({ x: sw.at[0], y: sw.at[1] }, a) === 1);
  if (k < 0) return 'no switch next to the agent';
  if (s.switchReady[k]! > s.tick) return 'the switch is resetting';
  const sw = s.map.def.switches[k]!;
  const rival: Team = a.team === 'A' ? 'B' : 'A';
  const { w } = s.map;
  const occ = new Set(s.agents.filter((o) => !o.out).map((o) => o.y * w + o.x));
  const tiles = sw.lanes[rival].filter((j) => s.grid[j] === null && (sw.kind !== 'dirt' || !occ.has(j)));
  for (const j of tiles) s.grid[j] = sw.kind;
  s.floods.push({ team: rival, until: s.tick + FLOOD_TICKS, tiles, kind: sw.kind });
  s.switchReady[k] = s.tick + SWITCH_COOLDOWN;
  ev.push({ kind: 'switch', agent: a.id, name: sw.name, floods: rival, until: s.tick + FLOOD_TICKS });
  if (sw.kind !== 'dirt') {
    const hit = new Set(tiles);
    for (const o of s.agents) if (!o.out && !o.down && hit.has(o.y * w + o.x)) knockDown(s, o, 'switch', ev);
  }
  return null;
}

function spreadHazard(s: MatchState, kind: HazardKind, cap: number, ev: MatchEvent[]) {
  const { w, h } = s.map;
  const H = (s.hazards[kind] ??= { waves: [], receding: false, count: 0 });
  if (H.receding) {
    const back = H.waves.pop() ?? [];
    for (const [j, orig] of back) if (s.grid[j] === kind) s.grid[j] = orig;
    if (!H.waves.length) H.receding = false;
    ev.push({ kind: 'hazard', hazard: kind, wave: H.waves.length, receding: true });
    return;
  }
  const flooded = new Set(s.floods.flatMap((f) => f.tiles));
  const starts = new Set(s.agents.map((a) => a.start[1] * w + a.start[0]));
  const snap = s.grid.slice();
  const changed = new Map<number, Tile | null>();
  snap.forEach((t, i) => {
    if (t !== kind || flooded.has(i)) return;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
      const j = ny * w + nx;
      if (changed.has(j) || starts.has(j)) continue;
      const tt = snap[j]!;
      const catches = kind === 'fire' ? tt === 'grass' || tt === 'tree' || tt === 'crate' : tt === null || tt === 'grass';
      if (catches) changed.set(j, tt);
    }
  });
  for (const j of changed.keys()) s.grid[j] = kind;
  H.waves.push([...changed]);
  H.count++;
  if (H.waves.length >= cap || !changed.size) H.receding = true;
  ev.push({ kind: 'hazard', hazard: kind, wave: H.waves.length, receding: false });
  for (const a of s.agents) {
    if (a.out || a.down || !changed.has(a.y * w + a.x)) continue;
    if (kind === 'lava') {
      dropItems(s, a);
      a.out = true;
      s.tally[a.team].swept++;
      ev.push({ kind: 'eliminated', agent: a.id, by: kind });
    } else knockDown(s, a, kind, ev);
  }
}

/**
 * Gas: every tile's cloud drifts one tile to its open neighbours and thins by one (strength 3 at a
 * vent reaches two tiles out, then clears). Walls, trees, crates, blocks, switches and rubble stop
 * it; it drifts over water, fire and ice. Then each vent puffs on its beat.
 */
function spreadGas(s: MatchState, ev: MatchEvent[]) {
  const { w, h } = s.map;
  const next: Record<number, number> = {};
  const put = (j: number, v: number) => {
    if (v > 0 && v > (next[j] ?? 0)) next[j] = v;
  };
  for (const key of Object.keys(s.gas)) {
    const j = Number(key);
    const v = s.gas[j]! - 1;
    put(j, v);
    const x = j % w;
    const y = (j / w) | 0;
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
      const k = ny * w + nx;
      const t = s.grid[k];
      if (t != null && SOLID.has(t)) continue;
      put(k, v);
    }
  }
  for (const v of s.map.def.gas ?? [])
    if (s.tick % v.every === 0) {
      put(idx(s, v.at), v.strength);
      ev.push({ kind: 'gas_vent', at: v.at });
    }
  // Integer keys iterate in ascending order, so the record (and the match) is the same on every run.
  s.gas = next;
}

/**
 * Sparking cables: on its beat a cable electrifies the water body it touches (every water tile
 * joined to it, as the water stands this tick) for `ticks` ticks. While live, any agent on or next to
 * that water and not already stunned is stunned for SHOCK_STUN ticks.
 */
function electrify(s: MatchState, ev: MatchEvent[]) {
  const { w } = s.map;
  const sparks = s.map.def.sparks ?? [];
  const bodies: { name: string; tiles: Set<number> }[] = [];
  sparks.forEach((sp, k) => {
    const starting = s.tick % sp.every === 0;
    if (starting) s.sparkUntil[k] = s.tick + sp.ticks;
    if (s.tick >= s.sparkUntil[k]!) return;
    const body = waterBody(s, idx(s, sp.at));
    bodies.push({ name: sp.name, tiles: new Set(body) });
    if (starting) ev.push({ kind: 'sparked', name: sp.name, at: sp.at, until: s.sparkUntil[k]!, tiles: body.length });
  });
  s.shocked = [...new Set(bodies.flatMap((b) => [...b.tiles]))].sort((p, q) => p - q);
  if (!s.shocked.length) return;
  for (const a of s.agents) {
    if (a.out || a.down || a.stun > 0) continue;
    const here = [a.y * w + a.x, ...Object.values(DIRS).map(([dx, dy]) => (a.y + dy) * w + a.x + dx)];
    const hit = bodies.find((b) => here.some((j) => b.tiles.has(j)));
    if (!hit) continue;
    a.stun = SHOCK_STUN;
    ev.push({ kind: 'shocked', agent: a.id, by: hit.name });
  }
}

/** Every water tile joined (orthogonally) to the water next to tile `from`, in tile order. */
function waterBody(s: MatchState, from: number): number[] {
  const { w } = s.map;
  const q = [from - w, from - 1, from + 1, from + w].filter((j) => s.grid[j] === 'water');
  const seen = new Set(q);
  for (let i = 0; i < q.length; i++) {
    const j = q[i]!;
    for (const k of [j - w, j - 1, j + 1, j + w])
      if (!seen.has(k) && s.grid[k] === 'water') {
        seen.add(k);
        q.push(k);
      }
  }
  return q.sort((p, r) => p - r);
}

function knockDown(s: MatchState, a: AgentState, by: HazardKind | 'switch', ev: MatchEvent[]) {
  const dropped = dropItems(s, a);
  a.down = DOWN_TICKS;
  s.tally[a.team].swept++;
  ev.push({ kind: 'knocked_down', agent: a.id, by, dropped });
}

/** Drops what an agent carries: next to it when stealing is on, else back where each item came from. */
function dropItems(s: MatchState, a: AgentState): number {
  const n = a.carrying.length;
  const { w } = s.map;
  for (const origin of a.carrying) {
    if (!s.map.def.steal) {
      s.grid[origin] = 'item';
      continue;
    }
    const spots = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => (a.y + dy!) * w + a.x + dx!);
    const j = spots.find((k) => s.grid[k] === null && !s.dropped[k]);
    if (j === undefined) s.grid[origin] = 'item';
    else {
      s.grid[j] = 'item';
      s.dropped[j] = a.team;
    }
  }
  a.carrying = [];
  a.tags = [];
  return n;
}

function updateSight(s: MatchState) {
  const { w, h } = s.map;
  for (const T of ['A', 'B'] as const) {
    const v = s.visible[T];
    v.fill(!s.map.def.fog);
    if (s.map.def.fog)
      for (const a of s.agents) {
        if (a.team !== T || a.out || a.down) continue;
        const r = Math.max(1, 1 + a.vision - (s.map.def.night ? 1 : 0));
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -(r - Math.abs(dy)); dx <= r - Math.abs(dy); dx++) {
            const x = a.x + dx;
            const y = a.y + dy;
            if (x >= 0 && y >= 0 && x < w && y < h) v[y * w + x] = true;
          }
      }
    const seen = s.seen[T];
    for (let i = 0; i < v.length; i++) if (v[i]) seen[i] = s.grid[i];
  }
}

function checkResult(s: MatchState): MatchResult | null {
  const goal = s.map.def.goal;
  const base = { score: { ...s.score }, ticks: s.tick };
  const won = (['A', 'B'] as const).filter((T) => s.score[T] >= goal);
  if (won.length === 1) return { winner: won[0]!, reason: 'goal', decidedBy: 'goal', ...base };
  const allOut = (T: Team) => s.agents.filter((a) => a.team === T).every((a) => a.out);
  const outA = allOut('A');
  const outB = allOut('B');
  if (outA !== outB) return { winner: outA ? 'B' : 'A', reason: 'eliminated', decidedBy: 'goal', ...base };
  if (won.length === 2 || s.tick >= s.limit || (outA && outB)) {
    const reason = won.length === 2 ? 'goal' : s.tick >= s.limit ? 'time' : 'eliminated';
    return { ...tiebreak(s), reason, ...base };
  }
  return null;
}

/** At time-out: more delivered, then fewer agents fielded, then the crew that reached its score first. */
function tiebreak(s: MatchState): Pick<MatchResult, 'winner' | 'decidedBy'> {
  if (s.score.A !== s.score.B) return { winner: s.score.A > s.score.B ? 'A' : 'B', decidedBy: 'score' };
  const n = (T: Team) => s.agents.filter((a) => a.team === T).length;
  if (n('A') !== n('B')) return { winner: n('A') < n('B') ? 'A' : 'B', decidedBy: 'fewer_agents' };
  if (s.score.A > 0 && s.scoredAt.A !== s.scoredAt.B) return { winner: s.scoredAt.A < s.scoredAt.B ? 'A' : 'B', decidedBy: 'earlier' };
  return { winner: 'draw', decidedBy: 'draw' };
}

/** Every action the agent could take this tick (always at least wait). */
export function legalActions(s: MatchState, agentId: string): Action[] {
  const a = s.agents.find((x) => x.id === agentId);
  const out: Action[] = [{ type: 'wait' }];
  if (!a || a.out || a.down || a.stun || s.result || s.tick + 1 <= s.holdTicks[a.team]) return out;
  const { w } = s.map;
  for (const dir of DIR_LIST) {
    const [dx, dy] = DIRS[dir];
    const t = s.grid[(a.y + dy) * w + a.x + dx];
    if (t === null || t === 'dirt' || (t !== undefined && passable(t))) out.push({ type: 'move', dir });
  }
  for (const v of s.map.def.verbs) {
    if (v.effect === 'take' || v.effect === 'deliver') continue;
    if (GATED.has(v.effect) && ROLE_EFFECT[a.role] !== v.effect) continue;
    if ((a.cooldown[v.id] ?? 0) > s.tick + 1) continue;
    if (v.effect === 'area_repel') {
      out.push({ type: 'verb', verb: v.id });
      continue;
    }
    for (const dir of DIR_LIST) if (verbFits(s, a, v.effect, dir)) out.push({ type: 'verb', verb: v.id, dir });
  }
  const k = s.map.def.switches.findIndex((sw) => manhattan({ x: sw.at[0], y: sw.at[1] }, a) === 1);
  if (k >= 0 && s.switchReady[k]! <= s.tick + 1) out.push({ type: 'switch' });
  return out;
}

function verbFits(s: MatchState, a: AgentState, effect: EffectClass, dir: Dir): boolean {
  const [dx, dy] = DIRS[dir];
  const x = a.x + dx;
  const y = a.y + dy;
  const { w, h } = s.map;
  if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return false;
  const t = s.grid[y * w + x];
  const free = !s.agents.some((o) => !o.out && !o.down && o.x === x && o.y === y);
  switch (effect) {
    case 'add_solid':
      return s.blocks[a.team] > 0 && free && (t === null || t === 'grass');
    case 'remove_solid':
      return t === 'dirt' || t === 'block' || t === 'crate' || t === 'tree';
    case 'extinguish':
      return t === 'fire';
    case 'ignite':
      return t === 'grass' || t === 'tree' || t === 'crate';
    case 'add_liquid':
    case 'grow':
      return free && t === null;
    case 'push': {
      const bx = x + dx;
      const by = y + dy;
      return t === 'crate' && bx > 0 && by > 0 && bx < w - 1 && by < h - 1 && s.grid[by * w + bx] === null;
    }
    default:
      return false;
  }
}

/**
 * What a crew spends this tick in hundredths of a credit: the sum of its live agents' talk tier
 * ratePer100. The caller accumulates it and charges whole credits with chargeDue.
 */
export function tickCostPer100(s: MatchState, team: Team): number {
  return s.agents.filter((a) => a.team === team && !a.out).reduce((n, a) => n + TALK_TIERS[a.tier].ratePer100, 0);
}

/** Whole credits held up front for a crew: every tick at its rate, rounded up once (ranked is all Standard). */
export function holdFor(crew: readonly Pick<AgentSpec, 'tier'>[], ranked: boolean, ticks = MATCH_TICKS): number {
  return talkHold(crew.map((a) => TALK_TIERS[ranked ? 'standard' : a.tier].ratePer100), ticks);
}

export function idx(s: MatchState, [x, y]: [number, number]): number {
  return y * s.map.w + x;
}

export function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function roleFor(effect: EffectClass): string {
  return (Object.keys(ROLE_EFFECT) as Role[]).find((r) => ROLE_EFFECT[r] === effect) ?? 'role';
}

export { HAZ, SOLID };
