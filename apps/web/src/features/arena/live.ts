// Live v2 matches as the arena draws them: one crew's frame (or a spectator's whole board) on the
// map's own arena, under soft fog, with this tick's talk as bubbles.
import type { Team, V2Frame } from '@skirm/engine/v2';
import type { AgentCosmetics } from '@skirm/shared';
import { cosmeticsOf, tintAgents } from './cosmetics';
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
export function composeV2Arena(frame: V2Frame): LiveArena | null {
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
  const agents: ArenaState['agents'] = frame.agents.map((g) => {
    const slot = slots[g.team]++;
    return {
      id: g.id,
      name: g.name,
      team: g.team,
      slot,
      x: g.x,
      y: g.y,
      out: g.out || g.down,
      inv: g.items.map(() => 'item'),
      ...(g.tool ? { tool: g.tool } : {}),
      c: BODY[g.team][slot % 3],
      bone: HEAD[g.team],
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
