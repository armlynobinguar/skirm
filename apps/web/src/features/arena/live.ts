// Live v2 matches as the arena draws them: one crew's frame (or a spectator's whole board) on the
// map's own arena, under soft fog, with this tick's talk as bubbles.
import { STUN_TICKS, type Team, type V2Frame } from '@skirm/engine/v2';
import { lookColours, type AgentCosmetics } from '@skirm/shared';
import type { Social } from '@skirm/ui';
import type { AgentSound } from '@/lib/sfx';
import { cosmeticsOf, tintAgents } from './cosmetics';
import type { LiveEmote } from './emotes';
import { gearOf } from './gear';
import { mapById, type Arena, type ArenaState } from './world';

export interface LiveArena {
  A: Arena;
  state: ArenaState;
  /** Fog: tiles this crew sees right now (the 3D cam reads it). Null: no fog. */
  vis?: boolean[] | null;
  /**
   * Soft fog: light per tile, 0–1, the sight edge blurred (the prototype's fogLight target). The
   * arena eases toward it and keeps explored tiles dimly lit. Null: no fog, everything lit.
   */
  light?: number[] | null;
  /** The crew whose view this is (its agents never fade); absent for a spectator. */
  team?: Team;
  /** Match tick, for supply drops still to come. */
  tick?: number;
  /** Speech bubbles over agents for this frame's talk, by agent id. */
  barks?: Record<string, LiveBark> | null;
  /** Hybrid control: the agent its player steers (ringed when the camera follows no one). */
  controlled?: string;
  /** Reactions over agents (arena/emotes.ts), from the feed's emote lines of the last ticks. */
  emotes?: LiveEmote[] | null;
  /** What agents wear (skin, trail, nameplate ids) by agent id; drawn by ./cosmetics. Absent: nobody. */
  cosmetics?: Record<string, AgentCosmetics>;
}

/** A line an agent said this tick, drawn as a bubble over it for 2.6 s. */
export interface LiveBark {
  text: string;
  ch: 'say' | 'team';
  /** Rival agents that overheard it (your team talk), comma separated. */
  heard?: string;
}

const BODY = { A: ['#34e0c8', '#ffb547', '#8fa8ff'], B: ['#ff4655', '#ff8db0', '#ff7a45'] } as const;
const HEAD = { A: '#ece8e1', B: '#f3e1e1' } as const;

/** Body and head colour of a crew's agent in slot order, as the arena draws it. */
export function agentColours(team: Team, slot: number): { body: string; head: string } {
  return { body: BODY[team][slot % 3]!, head: HEAD[team] };
}

/** v2 frame rows (engine observe characters) as the renderer's tiles. */
const V2_TILE: Record<string, string | null> = {
  '#': 'wall',
  ',': 'grass',
  T: 'tree',
  d: 'dirt',
  '~': 'water',
  L: 'lava',
  '^': 'fire',
  '*': 'item',
  E: 'exit',
  c: 'crate',
  B: 'block',
  V: 'valve',
  '=': 'ice',
  '.': null,
};

/**
 * One v2 frame as the arena: the map's own geometry (the v2 maps are the prototype's arenas), the
 * board as this crew has seen it, and its agents plus the rivals in sight. Unseen tiles keep the
 * map's original tile and draw under soft fog (`light`), and this tick's talk rides along as bubbles.
 */
export function composeV2Arena(frame: V2Frame, prev?: LiveArena | null): LiveArena | null {
  const m = mapById(frame.mapId);
  if (!m) return null;
  const A = m.A;
  const w = A.w;
  const grid: (string | null)[] = new Array(w * A.h).fill(null);
  const vis: boolean[] = new Array(w * A.h).fill(true);
  let fogged = false;
  frame.rows.forEach((row, y) => {
    for (let x = 0; x < row.length && x < w; x++) {
      const ch = row[x]!;
      if (ch === '?') {
        grid[y * w + x] = A.grid[y * w + x] ?? null;
        vis[y * w + x] = false;
        fogged = true;
      } else grid[y * w + x] = V2_TILE[ch] ?? null;
    }
  });
  const slots = { A: 0, B: 0 };
  const acts = actsOf(frame, prev);
  const social = socialOf(frame, prev, m.A.exit as [number, number]);
  const intents = intentsOf(frame, prev, m.A.exit as [number, number]);
  const agents: ArenaState['agents'] = frame.agents.map((g) => {
    const slot = slots[g.team]++;
    const act = acts.get(g.id);
    const so = social.get(g.id);
    return {
      ...act,
      ...(so ? { social: so.social, ...(so.faceTo ? { faceTo: so.faceTo } : {}) } : {}),
      ...(intents.has(g.id) ? { intent: intents.get(g.id)!.kind } : {}),
      id: g.id,
      name: g.name,
      team: g.team,
      slot,
      x: g.x,
      y: g.y,
      role: g.role,
      out: g.out,
      down: g.down,
      inv: g.items.map(() => 'item'),
      ...(g.tool ? { tool: g.tool } : {}),
      // The owner's look when the frame carries one (outfit body, skin head, dress); else the crew palette.
      ...(g.look
        ? (({ body, head, dress }) => ({ c: body, bone: head, dress }))(lookColours(g.look))
        : { c: BODY[g.team][slot % 3], bone: HEAD[g.team] }),
    };
  });
  // Equipped cosmetics (rendering only): the skin's palette on the body, the rest drawn by ./cosmetics.
  const cosmetics = cosmeticsOf(frame);
  if (cosmetics) tintAgents(agents as { id: string; c?: string; bone?: string }[], cosmetics);
  const team = frame.view === 'watch' ? undefined : frame.view;
  // Hybrid control: the agent this crew's player steers gets the ring (a watcher sees any steered agent).
  const controlled = frame.agents.find((g) => g.controlled && (!team || g.team === team))?.id;
  // Gas and live water ride on the board as overlays (tile indexes this side can see).
  const state: ArenaState = { grid, agents };
  if (frame.gas?.length) state.gas = frame.gas;
  if (frame.shock?.length) state.shock = frame.shock;
  const gear = gearOf(frame);
  if (gear) state.gear = gear;
  return {
    A: { ...A, grid },
    state,
    vis: fogged ? vis : null,
    light: fogged ? softLight(vis, w, A.h) : null,
    team,
    tick: frame.tick,
    barks: barksOf(frame),
    ...(controlled ? { controlled } : {}),
    ...(cosmetics ? { cosmetics } : {}),
  };
}

/** What an agent did this tick, for its pose (rendering only: read from the frame's events). */
export interface AgentAct {
  act?: string;
  cheer?: true;
  stun?: true;
  stunTill?: number;
}

/**
 * Each agent's verb, delivery and stun this tick from the frame's events. A stun lasts STUN_TICKS
 * after the tick it landed, carried over from the previous frame of the same match, and ends early
 * once the agent moves or acts again.
 */
export function actsOf(frame: Pick<V2Frame, 'events' | 'tick' | 'agents' | 'mapId'>, prev?: LiveArena | null): Map<string, AgentAct> {
  const out = new Map<string, AgentAct>();
  const get = (id: string) => {
    let a = out.get(id);
    if (!a) out.set(id, (a = {}));
    return a;
  };
  for (const e of frame.events) {
    if (e.kind === 'verb') get(e.agent).act = e.effect;
    else if (e.kind === 'dug') get(e.agent).act = 'remove_solid';
    else if (e.kind === 'tool_used') get(e.agent).act ??= 'tool';
    else if (e.kind === 'delivered') get(e.agent).cheer = true;
    else if (e.kind === 'stunned' || e.kind === 'shocked') get(e.agent).stunTill = frame.tick + STUN_TICKS;
  }
  // Carry a stun from the last frame (same map, later tick) while the agent stays put and idle.
  const m = mapById(frame.mapId);
  const before = prev && m && prev.tick != null && prev.tick < frame.tick && prev.A.w === m.A.w && prev.A.h === m.A.h ? prev : null;
  const was = new Map((before?.state.agents ?? []).map((a) => [a.id, a]));
  for (const g of frame.agents) {
    const p = was.get(g.id);
    if (p?.stunTill != null && p.stunTill >= frame.tick && p.x === g.x && p.y === g.y && !out.get(g.id)?.act) get(g.id).stunTill ??= p.stunTill;
  }
  for (const [, a] of out) if (a.stunTill != null && a.stunTill >= frame.tick) a.stun = true;
  return out;
}

/** One agent's reaction this frame and the tile it turns toward. */
export interface AgentSocial {
  social: Social;
  faceTo?: [number, number];
}

const manhattan = (a: readonly [number, number], b: readonly [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
/** Crewmates this close to a delivery pump their fists. */
const HYPE_RANGE = 4;
/** Rivals this close square up. */
const FACEOFF_RANGE = 2;
/** An item or the exit this close (and getting closer) gets pointed at. */
const POINT_RANGE = 6;
/** Rivals this close to a steal shake their fists. */
const SHAKE_RANGE = 3;
/** Frame row characters an agent flinches from next to it: water, lava, fire. */
const HAZARD_TILES = new Set(['~', 'L', '^']);
const NEIGHBOURS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * How each agent reacts to the others this frame, read off the frame's events (render only):
 * a believed bluff (liar's crew and spectators only), gas coughing and ice slips first; then
 * a speaker turns to the nearest crewmate that heard it and gestures, those who heard it turn to it
 * and nod; crewmates near a delivery pump their fists; rivals side by side square up; a blocked
 * move bumps back; a steal makes the rivals nearby shake their fists; a hazard next to an agent
 * makes it lean away; rivals that overhear team talk cup an ear; an agent getting closer to an
 * item (or, carrying, to the exit) points the way; one of your own agents that stood still thinks.
 * One reaction each, in that order of priority.
 */
export function socialOf(frame: Pick<V2Frame, 'events' | 'agents' | 'rows' | 'view'>, prev: LiveArena | null | undefined, exit: [number, number]): Map<string, AgentSocial> {
  const out = new Map<string, AgentSocial>();
  const at = new Map(frame.agents.map((g) => [g.id, [g.x, g.y] as [number, number]]));
  const up = new Map(frame.agents.filter((g) => !g.out && !g.down).map((g) => [g.id, g]));
  const set = (id: string, social: Social, faceTo?: [number, number]) => {
    if (!up.has(id) || out.has(id)) return;
    out.set(id, { social, ...(faceTo ? { faceTo } : {}) });
  };
  const nearest = (from: [number, number], ids: readonly string[]) => {
    let best: [number, number] | undefined;
    for (const id of ids) {
      const p = at.get(id);
      if (p && (!best || manhattan(from, p) < manhattan(from, best))) best = p;
    }
    return best;
  };
  // A bluff that landed: the liar rubs its hands, the one it fooled scratches its head. Only the
  // liar's crew and spectators see it: the fooled crew's own frame must not tip its player off.
  const team = new Map(frame.agents.map((g) => [g.id, g.team]));
  for (const e of frame.events) {
    if (e.kind !== 'bluff' || !e.believed) continue;
    const liar = team.get(e.agent);
    if (frame.view !== 'watch' && frame.view !== liar) continue;
    set(e.agent, { scheme: true }, at.get(e.victim));
    set(e.victim, { fooled: true }, at.get(e.agent));
  }
  // Gas and ice: coughing, slipping.
  for (const e of frame.events) {
    if (e.kind === 'choked') set(e.agent, { cough: true });
    else if (e.kind === 'slid') set(e.agent, { slip: true }, e.to);
  }
  // Talk: the speaker faces the nearest crewmate that heard it; they face it and nod; rivals that
  // overheard it cup a hand to their ear and turn toward it.
  for (const e of frame.events) {
    if (e.kind !== 'said') continue;
    const from = at.get(e.agent);
    if (!from) continue;
    set(e.agent, { talk: true }, nearest(from, e.heardBy));
    for (const id of e.heardBy) set(id, { listen: true }, from);
    for (const id of e.overheardBy) set(id, { overhear: true }, from);
  }
  // A delivery: crewmates in range pump their fists toward the one who delivered.
  for (const e of frame.events) {
    if (e.kind !== 'delivered') continue;
    const from = at.get(e.agent);
    if (!from) continue;
    for (const g of up.values()) if (g.id !== e.agent && g.team === e.team && manhattan(from, [g.x, g.y]) <= HYPE_RANGE) set(g.id, { hype: true }, from);
  }
  // Blocked: bumps back. A steal: rivals nearby shake their fists at the thief.
  for (const e of frame.events) {
    if (e.kind === 'blocked') set(e.agent, { bump: true });
    if (e.kind === 'picked' && e.stolen) {
      const thief = up.get(e.agent);
      if (!thief) continue;
      for (const g of up.values()) if (g.team !== thief.team && manhattan([thief.x, thief.y], [g.x, g.y]) <= SHAKE_RANGE) set(g.id, { shake: true }, [thief.x, thief.y]);
    }
  }
  // Rivals side by side square up to each other.
  const live = [...up.values()];
  for (const g of live) {
    let rival: [number, number] | undefined;
    for (const r of live) if (r.team !== g.team && manhattan([g.x, g.y], [r.x, r.y]) <= FACEOFF_RANGE && (!rival || manhattan([g.x, g.y], [r.x, r.y]) < manhattan([g.x, g.y], rival))) rival = [r.x, r.y];
    if (rival) set(g.id, { square: true }, rival);
  }
  // A hazard on a tile next to it: leans away from it (harder when a wave just came in).
  const wave = frame.events.some((e) => e.kind === 'hazard' && !e.receding);
  const hazardAt = (x: number, y: number) => HAZARD_TILES.has(frame.rows[y]?.[x] ?? '');
  for (const g of live) {
    for (const [dx, dy] of NEIGHBOURS) {
      if (!hazardAt(g.x + dx, g.y + dy)) continue;
      set(g.id, wave ? { flinch: true, wave: true } : { flinch: true }, [g.x + dx, g.y + dy]);
      break;
    }
  }
  // Getting closer to an item (or, carrying, to the exit): points the way. Standing still: thinks.
  const intents = intentsOf(frame, prev, exit);
  const was = new Map((prev?.state.agents ?? []).map((a) => [a.id, [a.x, a.y] as [number, number]]));
  for (const g of live) {
    if (out.has(g.id)) continue;
    const now: [number, number] = [g.x, g.y];
    const before = was.get(g.id);
    const moved = !!before && manhattan(before, now) === 1;
    if (moved) {
      const it = intents.get(g.id);
      if (it && it.kind !== 'switch' && manhattan(now, it.goal) <= POINT_RANGE) set(g.id, { point: true }, it.goal);
    } else if (before && frame.view !== 'watch' && g.team === frame.view) set(g.id, { think: true });
  }
  return out;
}

/** What an agent is going for right now (its nameplate icon): an item, the exit, or a switch. */
export type IntentKind = 'item' | 'exit' | 'switch';
export interface AgentIntent {
  kind: IntentKind;
  goal: [number, number];
}

/** A switch this close, nearer than any item and getting closer, is what it is heading for. */
const SWITCH_RANGE = 3;

/**
 * What each agent is going for, read only off what this frame shows (render only): carrying an item
 * and a step closer to the exit, the exit; one of its own switches pulled this tick, or a step closer
 * to a visible switch within SWITCH_RANGE that is nearer than every visible item, a switch; a step
 * closer to the nearest visible item, an item. An agent that did not step (or teleported), is down
 * or out, or stepped toward nothing gets no intent: never a guess. Rivals are only in the frame when
 * this crew sees them, and items and switches only count where this crew sees them ('?' hides them).
 */
export function intentsOf(frame: Pick<V2Frame, 'events' | 'agents' | 'rows'>, prev: LiveArena | null | undefined, exit: [number, number]): Map<string, AgentIntent> {
  const out = new Map<string, AgentIntent>();
  const items: [number, number][] = [];
  const switches: [number, number][] = [];
  frame.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '*') items.push([x, y]);
      else if (row[x] === 'V') switches.push([x, y]);
    }
  });
  const pulled = new Set(frame.events.filter((e) => e.kind === 'switch').map((e) => (e as { agent: string }).agent));
  const was = new Map((prev?.state.agents ?? []).map((a) => [a.id, [a.x, a.y] as [number, number]]));
  for (const g of frame.agents) {
    if (g.out || g.down) continue;
    const now: [number, number] = [g.x, g.y];
    const before = was.get(g.id);
    if (pulled.has(g.id)) {
      const sw = nearestTile(now, switches);
      if (sw && manhattan(now, sw) <= 1) {
        out.set(g.id, { kind: 'switch', goal: sw });
        continue;
      }
    }
    if (!before || manhattan(before, now) !== 1) continue;
    const closer = (t: [number, number]) => manhattan(now, t) < manhattan(before, t);
    if (g.items.length && closer(exit)) {
      out.set(g.id, { kind: 'exit', goal: exit });
      continue;
    }
    const item = nearestTile(now, items);
    const sw = nearestTile(now, switches);
    if (sw && closer(sw) && manhattan(now, sw) <= SWITCH_RANGE && (!item || manhattan(now, sw) < manhattan(now, item))) {
      out.set(g.id, { kind: 'switch', goal: sw });
      continue;
    }
    if (item && closer(item)) out.set(g.id, { kind: 'item', goal: item });
  }
  return out;
}

function nearestTile(from: [number, number], tiles: readonly [number, number][]): [number, number] | undefined {
  let best: [number, number] | undefined;
  for (const t of tiles) if (!best || manhattan(from, t) < manhattan(from, best)) best = t;
  return best;
}

/**
 * Hard sight as soft light (the prototype's fogLight target): a 5-tap binomial blur across and
 * down, brightened by 1.35 and smoothstepped, so the sight edge fades over about two tiles.
 */
export function softLight(vis: readonly boolean[], w: number, h: number): number[] {
  const K = [1, 4, 6, 4, 1];
  const tmp = new Array<number>(w * h).fill(0);
  const out = new Array<number>(w * h).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += K[k + 2]! * (vis[y * w + Math.min(w - 1, Math.max(0, x + k))] ? 1 : 0);
      tmp[y * w + x] = s / 16;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += K[k + 2]! * tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]!;
      const t = Math.min(1, (s / 16) * 1.35);
      out[y * w + x] = t * t * (3 - 2 * t);
    }
  return out;
}

/** This frame's talk as bubbles: the last line each agent said (rival team talk only when overheard). */
function barksOf(frame: V2Frame): Record<string, LiveBark> | null {
  if (!frame.comms.length) return null;
  const out: Record<string, LiveBark> = {};
  for (const c of frame.comms) {
    const heard = c.overheardBy?.length ? c.overheardBy.join(', ') : undefined;
    out[c.from] = { text: c.text, ch: c.channel, ...(heard ? { heard } : {}) };
  }
  return out;
}

/**
 * The live screen's cinematic cues for the arena: when the hazards are revealed and the crews
 * deploy during the intro, and when the screen shakes. The arena canvas reads it every frame.
 */
export interface LiveFx {
  /** The intro cutscene is playing: hazards and agents stay hidden until their cue. */
  intro: boolean;
  /** Wall ms the hazard tiles start rising in (1.5 s), null: not yet (or no intro). */
  revealAt: number | null;
  /** Wall ms the agents start dropping in (1.4 s). */
  deployAt: number | null;
  /** Wall ms of the last shake (it decays over 0.7 s). */
  shakeAt: number | null;
}

const NO_FX: LiveFx = { intro: false, revealAt: null, deployAt: null, shakeAt: null };
let fx: LiveFx = NO_FX;

export function liveFx(): LiveFx {
  return fx;
}

export function setLiveFx(patch: Partial<LiveFx> | null): void {
  fx = patch ? { ...fx, ...patch } : NO_FX;
}

/**
 * How long an agent takes to walk one tile: most of the time between two frames (a live tick is 2 s),
 * so it walks the whole way at a steady pace instead of hopping in 400 ms and standing until the next
 * frame. `gapMs` is the time between the last two frames (null before the second one).
 */
export function walkMs(gapMs: number | null | undefined): number {
  if (gapMs == null || !Number.isFinite(gapMs) || gapMs <= 0) return 400;
  return Math.max(300, Math.min(1800, gapMs * 0.9));
}

/** The body's bob while walking: two footfalls a tile, a few hundredths of a tile high (0 to 1). */
export function walkBob(alpha: number): number {
  return Math.abs(Math.sin(2 * Math.PI * Math.min(1, Math.max(0, alpha))));
}

/** A sound to play for a live frame, `delay` ms after it arrives. */
export interface FrameSound {
  delay: number;
  sound: AgentSound;
}

/** Each crew slot gets its own voice; the B crew a little lower. */
export function voicePitch(team: Team, slot: number): number {
  return ([1, 1.2, 0.85][slot % 3] ?? 1) * (team === 'B' ? 0.88 : 1);
}

/** Footfalls are played for at most this many walking agents a frame (a crowd would clatter). */
const STEP_VOICES = 2;

/**
 * What a new live frame sounds like: a babble of syllables for each agent that spoke (one per
 * word, up to 7), two soft footfalls for walking agents over the step (`walk`: the step's length
 * in ms), a cough in gas, a whoosh on ice, and a sting for a bluff that landed. Pure, for the tests.
 */
export function frameSounds(arena: LiveArena, prev: ArenaState | null, walk: number): FrameSound[] {
  const out: FrameSound[] = [];
  const was = new Map((prev?.agents ?? []).map((a) => [a.id, a]));
  let steps = 0;
  for (const a of arena.state.agents) {
    if (a.out) continue;
    const pitch = voicePitch(a.team, a.slot);
    const so = a.social;
    if (so?.talk) {
      const text = arena.barks?.[a.id]?.text ?? '';
      const words = text.split(/\s+/).filter(Boolean).length;
      out.push({ delay: 0, sound: { kind: 'voice', syllables: Math.max(2, Math.min(7, words)), pitch, seed: (arena.tick ?? 0) * 7 + a.slot } });
    }
    if (so?.cough) out.push({ delay: 0, sound: { kind: 'cough' } });
    if (so?.slip) out.push({ delay: 0, sound: { kind: 'slide' } });
    if (so?.scheme) out.push({ delay: 80, sound: { kind: 'scheme' } });
    if (so?.fooled) out.push({ delay: 120, sound: { kind: 'fooled' } });
    const p = was.get(a.id);
    if (p && steps < STEP_VOICES && Math.abs(p.x - a.x) + Math.abs(p.y - a.y) === 1) {
      steps++;
      out.push({ delay: Math.round(walk * 0.3), sound: { kind: 'step', pitch } });
      out.push({ delay: Math.round(walk * 0.8), sound: { kind: 'step', pitch: pitch * 0.94 } });
    }
  }
  return out;
}
