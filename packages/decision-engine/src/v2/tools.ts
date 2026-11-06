// Tools from supply drops (engine tools.ts) as the brains read them: the text a model gets about the
// tool in hand and the gear on the map, and when the offline greedy brain uses its tool. Greedy
// bridges or pumps when that opens or clearly shortens its route (a flooded corridor), and sandbags
// a tile water is about to cross on its way to the delivery point.
import { PUMP_RADIUS, TOOL_TEXT, type Action, type Observation, type ToolKind } from '@skirm/engine/v2';

type Dir = 'N' | 'E' | 'S' | 'W';
const STEP: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const WALK = new Set(['.', ',', '*', 'E', 'd', '?']);
/** Sandbags go where water is about to cross toward the delivery point: within this many steps of it. */
export const SANDBAG_EXIT_RANGE = 8;
/** A bridge or pump is worth a tick when it saves at least this many steps (or opens a route). */
export const TOOL_SAVES = 3;

/** Tile indexes (y * w + x) of placed bridges. */
export function bridgeTiles(o: Observation): Set<number> {
  const w = o.rows[0]?.length ?? 0;
  return new Set((o.gear?.placed ?? []).filter((p) => p.kind === 'bridge').map((p) => p.at[1] * w + p.at[0]));
}

/** Tile indexes of tools on the ground. */
export function groundTools(o: Observation): Map<number, ToolKind> {
  const w = o.rows[0]?.length ?? 0;
  return new Map((o.gear?.ground ?? []).map((g) => [g.at[1] * w + g.at[0], g.kind]));
}

/** Can an agent walk onto (x, y) as the crew sees it: open tiles, rubble, unseen and bridged water. */
export function walkableAt(o: Observation, x: number, y: number, bridges: Set<number>, extra?: Set<number>): boolean {
  const c = o.rows[y]?.[x];
  if (c === undefined) return false;
  if (WALK.has(c)) return true;
  const j = y * (o.rows[0]?.length ?? 0) + x;
  return c === '~' && (bridges.has(j) || !!extra?.has(j));
}

/** Steps from the agent to the nearest goal tile (rubble 3), with `extra` water tiles made walkable; null when none. */
export function routeLength(o: Observation, goal: (c: string, x: number, y: number) => boolean, extra?: Set<number>): number | null {
  const h = o.rows.length;
  const w = o.rows[0]?.length ?? 0;
  const bridges = bridgeTiles(o);
  const dist = new Map<number, number>();
  const start = o.me.y * w + o.me.x;
  dist.set(start, 0);
  // Small Dijkstra over weights 1 and 3: a bucket queue.
  const buckets: number[][] = [[start]];
  for (let d = 0; d < buckets.length; d++)
    for (const j of buckets[d] ?? []) {
      if (dist.get(j) !== d) continue;
      const x = j % w;
      const y = (j / w) | 0;
      if (j !== start && goal(o.rows[y]![x]!, x, y)) return d;
      for (const [dx, dy] of Object.values(STEP)) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !walkableAt(o, nx, ny, bridges, extra)) continue;
        const k = ny * w + nx;
        const nd = d + (o.rows[ny]![nx] === 'd' ? 3 : 1);
        if ((dist.get(k) ?? Infinity) <= nd) continue;
        dist.set(k, nd);
        (buckets[nd] ??= []).push(k);
      }
    }
  return null;
}

/** Water tiles the crew has seen within the pump's reach of (x, y). */
function pumpReach(o: Observation, x0: number, y0: number): Set<number> {
  const w = o.rows[0]?.length ?? 0;
  const out = new Set<number>();
  for (let dy = -PUMP_RADIUS; dy <= PUMP_RADIUS; dy++)
    for (let dx = -(PUMP_RADIUS - Math.abs(dy)); dx <= PUMP_RADIUS - Math.abs(dy); dx++)
      if (o.rows[y0 + dy]?.[x0 + dx] === '~') out.add((y0 + dy) * w + x0 + dx);
  return out;
}

/**
 * The tool greedy uses this tick, or null to keep it. `goal` is where it is heading (the nearest
 * item, or the delivery point when it carries enough).
 */
export function greedyTool(o: Observation, goal: (c: string, x: number, y: number) => boolean): Action | null {
  // An Engineer lays its own bridges the same way (engine roles.ts), tool in hand or not.
  if (!o.me.tool && !(o.me.role === 'Engineer' && o.me.kit)) return null;
  const uses = o.legal.filter((a): a is Extract<Action, { type: 'use' }> => a.type === 'use');
  if (!uses.length) return null;
  const w = o.rows[0]?.length ?? 0;
  const [ex, ey] = o.map.exit;
  const helps = (extra: Set<number>) => {
    const before = routeLength(o, goal);
    const after = routeLength(o, goal, extra);
    return after !== null && (before === null || after + TOOL_SAVES <= before);
  };
  for (const u of uses) {
    const x = o.me.x + STEP[u.dir][0];
    const y = o.me.y + STEP[u.dir][1];
    if (u.tool === 'bridge' && helps(new Set([y * w + x]))) return u;
    if (u.tool === 'pump') {
      const drained = pumpReach(o, x, y);
      if (drained.size >= 2 && helps(drained)) return u;
    }
    if (u.tool === 'sandbag') {
      const toExit = Math.abs(x - ex) + Math.abs(y - ey);
      if (toExit > SANDBAG_EXIT_RANGE) continue;
      // Water next to the tile, on the far side from the delivery point: the gap it would cross.
      const front = Object.values(STEP).some(([dx, dy]) => o.rows[y + dy]?.[x + dx] === '~' && Math.abs(x + dx - ex) + Math.abs(y + dy - ey) > toExit);
      if (front) return u;
    }
  }
  return null;
}

/** The lines a model reads about tools: the one in hand and the gear on the map. Empty when none. */
export function toolLines(o: Observation): string[] {
  const lines: string[] = [];
  if (o.me.tool) lines.push(`Your tool: ${TOOL_TEXT[o.me.tool].name} (${TOOL_TEXT[o.me.tool].does}). Use it with "use ${o.me.tool} <dir>".`);
  const ground = o.gear?.ground ?? [];
  if (ground.length) lines.push(`Tools on the ground (step on one with no tool in hand to take it): ${ground.map((g) => `${g.kind} at ${g.at[0]},${g.at[1]}`).join('; ')}.`);
  const placed = o.gear?.placed ?? [];
  if (placed.length)
    lines.push(
      `Placed: ${placed.map((p) => (p.kind === 'pump' ? `pump at ${p.at[0]},${p.at[1]} (${p.ticksLeft} ${p.ticksLeft === 1 ? 'tick' : 'ticks'} left)` : `${p.kind} at ${p.at[0]},${p.at[1]}`)).join('; ')}. Bridges are walkable water; water never crosses sandbags.`,
    );
  return lines;
}

/** One inner-voice line for a tool use. */
export function toolThought(tool: ToolKind): string {
  if (tool === 'bridge') return 'Water in the way. Laying the bridge across.';
  if (tool === 'pump') return 'Setting the pump down to drain this water.';
  return 'Sandbagging the gap before the water gets through.';
}
