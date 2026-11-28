// The visor's danger edges: the screen edge facing a nearby hazard (water, lava, fire, gas, live
// current) or a rival glows, brighter the closer it is: amber for a hazard, red for a rival. Which
// threats are near follows the board; which edge they light follows the view (chase3d/visor's
// bearings), so turning towards a rival moves its glow to the top edge.
import { bearingTo } from '@/features/arena/chase3d/visor';

/** How far out a threat lights an edge, in tiles. */
export const DANGER_RANGE = 4;

const HAZARD_TILES: ReadonlySet<string> = new Set(['water', 'lava', 'fire']);

export interface Threat {
  x: number;
  y: number;
  kind: 'hazard' | 'rival';
}

export interface DangerBoard {
  w: number;
  h: number;
  grid: readonly (string | null)[];
  gas?: readonly number[] | undefined;
  shock?: readonly number[] | undefined;
  agents: readonly { team: string; x: number; y: number; out?: boolean }[];
}

/** Hazard tiles and rivals within `range` tiles (square box, then straight-line) of `at`. */
export function threatsNear(b: DangerBoard, at: { x: number; y: number }, team: string, range = DANGER_RANGE): Threat[] {
  const out: Threat[] = [];
  const near = (x: number, y: number) => Math.hypot(x - at.x, y - at.y) <= range;
  const cx = Math.round(at.x);
  const cy = Math.round(at.y);
  const extra = new Set<number>([...(b.gas ?? []), ...(b.shock ?? [])]);
  for (let y = Math.max(0, cy - range); y <= Math.min(b.h - 1, cy + range); y++)
    for (let x = Math.max(0, cx - range); x <= Math.min(b.w - 1, cx + range); x++) {
      const i = y * b.w + x;
      if ((HAZARD_TILES.has(b.grid[i] ?? '') || extra.has(i)) && near(x, y)) out.push({ x, y, kind: 'hazard' });
    }
  for (const a of b.agents) if (a.team !== team && !a.out && near(a.x, a.y)) out.push({ x: a.x, y: a.y, kind: 'rival' });
  return out;
}

export type Edge = 'top' | 'right' | 'bottom' | 'left';
export const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

export interface EdgeGlow {
  /** 0 (nothing near) to 1 (on top of it). */
  level: number;
  /** The strongest threat on this edge is a rival. */
  rival: boolean;
}

/**
 * Lights the edges from the viewer at `from` facing `yaw`: ahead is the top edge, behind the bottom.
 * A threat on the viewer's own tile lights every edge. A rival counts a little more than a hazard
 * at the same distance, so it wins the colour.
 */
export function dangerEdges(from: { x: number; z: number }, yaw: number, threats: readonly Threat[], range = DANGER_RANGE): Record<Edge, EdgeGlow> {
  const out: Record<Edge, EdgeGlow> = { top: { level: 0, rival: false }, right: { level: 0, rival: false }, bottom: { level: 0, rival: false }, left: { level: 0, rival: false } };
  for (const t of threats) {
    const b = bearingTo(from, { x: t.x, z: t.y }, yaw);
    if (b.dist > range) continue;
    const level = Math.min(1, (1 - b.dist / (range + 0.5)) * (t.kind === 'rival' ? 1.15 : 1));
    const sides: Edge[] = b.dist < 0.5 ? [...EDGES] : [Math.abs(b.rel) <= 45 ? 'top' : Math.abs(b.rel) >= 135 ? 'bottom' : b.rel > 0 ? 'right' : 'left'];
    for (const s of sides)
      if (level > out[s].level) out[s] = { level, rival: t.kind === 'rival' };
  }
  return out;
}
