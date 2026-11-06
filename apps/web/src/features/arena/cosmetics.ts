// Equipped cosmetics in the arena (@skirm/shared EQUIP_COSMETICS): the skin's palette on the agent's
// body and head plus its pattern as a ring at the agent's feet, a fading trail over the tiles it just
// walked, and its nameplate style on the name tag. Frames carry the item ids (FrameAgent.cosmetics,
// added by the match server, rendering only). Kept in this one module so the agent renderer itself
// stays untouched: live.ts tints through `tintAgents`, and ArenaCanvas calls `drawCosmetics2D` once
// a frame, after the board. The 3D chase cam draws the same items (chase3d/cosmetics3d.ts).
import {
  equipCosmeticById,
  type AgentCosmetics,
  type NameplateCosmetic,
  type SkinCosmetic,
  type TrailCosmetic,
} from '@skirm/shared';
import type { V2Frame } from '@skirm/engine/v2';
import type { LiveArena } from './live';
import type { ArenaState } from './world';

/** What each agent in a frame wears, by agent id (null: nobody wears anything). */
export function cosmeticsOf(frame: Pick<V2Frame, 'agents'>): Record<string, AgentCosmetics> | null {
  let out: Record<string, AgentCosmetics> | null = null;
  for (const a of frame.agents) if (a.cosmetics && Object.keys(a.cosmetics).length) (out ??= {})[a.id] = { ...a.cosmetics };
  return out;
}

export function skinOf(c: AgentCosmetics | undefined): Readonly<SkinCosmetic> | undefined {
  const it = c?.skin ? equipCosmeticById(c.skin) : undefined;
  return it?.kind === 'skin' ? it : undefined;
}
export function trailOf(c: AgentCosmetics | undefined): Readonly<TrailCosmetic> | undefined {
  const it = c?.trail ? equipCosmeticById(c.trail) : undefined;
  return it?.kind === 'trail' ? it : undefined;
}
export function plateOf(c: AgentCosmetics | undefined): Readonly<NameplateCosmetic> | undefined {
  const it = c?.nameplate ? equipCosmeticById(c.nameplate) : undefined;
  return it?.kind === 'nameplate' ? it : undefined;
}

/** Puts each worn skin's colours on the renderer's agents (`c` body, `bone` head). */
export function tintAgents(agents: { id: string; c?: string; bone?: string }[], worn: Record<string, AgentCosmetics>): void {
  for (const a of agents) {
    const skin = skinOf(worn[a.id]);
    if (skin) {
      a.c = skin.body;
      a.bone = skin.accent;
    }
  }
}

const TRAIL_MS = 1600;
const TRAIL_MAX = 6;
/** Recent tiles per agent for trails: the arena key they belong to, and [x, y, wall ms] each. */
const trails = new Map<string, { key: string; steps: [number, number, number][] }>();

/** Tiles an agent stood on, newest last, within the last TRAIL_MS (exported for tests). */
export function trailSteps(id: string, key: string, x: number, y: number, now: number): [number, number, number][] {
  let t = trails.get(id);
  if (!t || t.key !== key) {
    t = { key, steps: [] };
    trails.set(id, t);
  }
  const last = t.steps[t.steps.length - 1];
  if (!last || last[0] !== x || last[1] !== y) t.steps.push([x, y, now]);
  t.steps = t.steps.filter((s) => now - s[2] < TRAIL_MS).slice(-TRAIL_MAX);
  // The tile the agent is on now always stays.
  if (!t.steps.length) t.steps.push([x, y, now]);
  return t.steps;
}

export interface CosmeticDrawOpts {
  /** Name tags are shown (after the crews deploy). */
  tags?: unknown;
  /** Rival fade per agent id (0–1). */
  agFade?: Record<string, number> | null;
  /** Soft fog light per tile, or null. */
  light?: number[] | null;
  /** Reduced motion: no trails. */
  still?: boolean;
}

/**
 * The one draw call: skin pattern rings, trails and styled nameplates over the isometric board,
 * P(x, y) = (ox + (x − y)·T/2, oy + (x + y)·T/4) minus the slab, as renderArena projects it.
 */
export function drawCosmetics2D(
  c: CanvasRenderingContext2D,
  arena: LiveArena,
  prev: ArenaState | null,
  alpha: number,
  T: number,
  ox: number,
  oy: number,
  opts: CosmeticDrawOpts = {},
): void {
  const worn = arena.cosmetics;
  if (!worn) return;
  const slab = T * 0.13;
  const w = arena.A.w;
  const P = (x: number, y: number): [number, number] => [ox + ((x - y) * T) / 2, oy + ((x + y) * T) / 4 - slab];
  const key = `${arena.A.w}x${arena.A.h}`;
  const now = Date.now();
  // The tween renderArena uses (cubic ease-out), so rings and plates move with the agent.
  const a01 = Math.min(1, Math.max(0, alpha));
  const k = 1 - Math.pow(1 - a01, 3);
  c.save();
  arena.state.agents.forEach((a, i) => {
    const cos = worn[a.id];
    if (!cos) return;
    const out = (a as { out?: boolean }).out;
    const fade = opts.agFade?.[a.id] ?? 1;
    const lit = opts.light ? Math.max(0.35, opts.light[a.y * w + a.x] ?? 1) : 1;
    if (fade < 0.02) return;
    const pa = prev?.agents[i] ?? a;
    const far = Math.abs(pa.x - a.x) + Math.abs(pa.y - a.y) > 1;
    const ix = far ? a.x : pa.x + (a.x - pa.x) * k;
    const iy = far ? a.y : pa.y + (a.y - pa.y) * k;
    const [sx, sy] = P(ix, iy);
    const moving = !far && (pa.x !== a.x || pa.y !== a.y);
    const hop = moving ? Math.sin(Math.PI * a01) * T * 0.14 : 0;

    const trail = trailOf(cos);
    if (trail && !opts.still && !out) {
      const steps = trailSteps(a.id, key, a.x, a.y, now);
      steps.slice(0, -1).forEach(([tx, ty, at], j) => {
        const age = 1 - (now - at) / TRAIL_MS;
        if (age <= 0) return;
        const [px, py] = P(tx, ty);
        c.globalAlpha = age * 0.75 * fade * lit;
        c.fillStyle = trail.color;
        c.strokeStyle = trail.color;
        if (trail.style === 'sparks') {
          for (let s = 0; s < 3; s++) {
            const ang = (j + s * 2.1 + at / 300) % (Math.PI * 2);
            c.fillRect(px + Math.cos(ang) * T * 0.14, py - T * 0.05 + Math.sin(ang) * T * 0.06, T * 0.035, T * 0.035);
          }
        } else if (trail.style === 'ribbon') {
          const [nx, ny] = j + 1 < steps.length - 1 ? P(steps[j + 1]![0], steps[j + 1]![1]) : [sx, sy];
          c.lineWidth = Math.max(1.5, T * 0.07 * age);
          c.beginPath();
          c.moveTo(px, py);
          c.lineTo(nx, ny);
          c.stroke();
        } else {
          c.beginPath();
          c.ellipse(px, py, T * 0.1 * age + T * 0.04, T * 0.05 * age + T * 0.02, 0, 0, Math.PI * 2);
          c.fill();
        }
      });
    }

    const skin = skinOf(cos);
    if (skin && skin.pattern !== 'solid' && !out) {
      c.globalAlpha = 0.85 * fade * lit;
      c.strokeStyle = skin.accent;
      c.lineWidth = Math.max(1.2, T / 30);
      c.setLineDash(skin.pattern === 'stripes' ? [T * 0.08, T * 0.05] : skin.pattern === 'dots' ? [T * 0.02, T * 0.06] : []);
      c.beginPath();
      c.ellipse(sx, sy, T * 0.26, T * 0.13, 0, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }

    const plate = plateOf(cos);
    if (plate && opts.tags && !out) {
      // Over the tag renderArena drew: the same box (font, width, place), in the nameplate's colours.
      const fs = Math.max(10, T * 0.2);
      c.font = `600 ${fs}px Barlow, sans-serif`;
      const name = (a as { name?: string }).name ?? '';
      const tw = c.measureText(name).width + fs * 0.8;
      const ty = sy - hop - T * 1.05;
      c.globalAlpha = fade;
      c.fillStyle = plate.bg;
      c.fillRect(sx - tw / 2, ty - fs, tw, fs * 1.35);
      c.strokeStyle = plate.border;
      c.lineWidth = Math.max(1, T / 40);
      c.strokeRect(sx - tw / 2 + 0.5, ty - fs + 0.5, tw - 1, fs * 1.35 - 1);
      c.fillStyle = plate.fg;
      c.textAlign = 'center';
      c.fillText(name, sx, ty);
    }
  });
  c.restore();
}
