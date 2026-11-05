// Tools from supply drops: sandbags, pumps and bridges. A supply drop on a water map can carry one
// tool beside its goal item (SUPPLY_TOOLS, or a drop's own `tool`). Stepping on the drop takes the
// tool when the agent's tool slot is empty: an agent carries at most one tool, apart from its items,
// and keeps it when knocked down (lava removes it with the agent). Using it is one action,
// `{ type: 'use', tool, dir }`, toward an adjacent tile:
//
//   sandbag  on open floor or grass: water never spreads into that tile again (switch floods too).
//            Agents step over it. Permanent.
//   bridge   on a water tile: agents walk onto it and water there never knocks them down. Permanent.
//   pump     on any tile that is not solid: it drains water around it for PUMP_TICKS ticks, a ring
//            wider each tick (radius 1, then 2, then 2), after the hazards spread. Then it is spent.
//
// Ground tools and placed objects are public, like the drops themselves. Everything here is a pure
// function of the match state, so a match with tools replays exactly from its log.
import type { Dir, MapDefV2 } from './map';
import type { AgentState, MatchEvent, MatchState } from './match';

export type ToolKind = 'sandbag' | 'pump' | 'bridge';
export const TOOL_KINDS: readonly ToolKind[] = ['sandbag', 'pump', 'bridge'];

/** Ticks a pump runs, the first one being the tick it is placed. */
export const PUMP_TICKS = 3;
/** Widest ring a pump drains (Manhattan distance from the pump). */
export const PUMP_RADIUS = 2;

/** What each tool is and does, in the words the agents and the HUD use. */
export const TOOL_TEXT: Readonly<Record<ToolKind, { name: string; does: string }>> = {
  sandbag: { name: 'Sandbags', does: 'place on an adjacent open tile: water never spreads into it; agents step over it' },
  pump: { name: 'Pump', does: `place on an adjacent tile: drains water within ${PUMP_RADIUS} tiles over ${PUMP_TICKS} ticks` },
  bridge: { name: 'Bridge', does: 'place on an adjacent water tile: agents can walk on it and water there never knocks them down' },
};

/**
 * The drop table: the tool each supply drop carries, by map and drop order. Only water maps carry
 * tools; the goal item of every drop is unchanged.
 */
export const SUPPLY_TOOLS: Readonly<Record<string, readonly ToolKind[]>> = {
  'copper-hollow': ['sandbag'],
  'monsoon-terraces': ['bridge', 'pump'],
  'sunken-metro': ['pump', 'bridge'],
  'blackout-harbor': ['sandbag', 'pump'],
};

/** The tool drop `k` of a map carries (its own `tool`, else the drop table), or null. */
export function dropTool(def: MapDefV2, k: number): ToolKind | null {
  const d = def.drops[k];
  if (!d) return null;
  return d.tool ?? SUPPLY_TOOLS[def.id]?.[k] ?? null;
}

export interface PlacedTool {
  kind: ToolKind;
  /** The crew that placed it. */
  team: 'A' | 'B';
  /** Pumps: ticks the pump has run so far (it is spent after PUMP_TICKS). */
  ran?: number;
}

/** Tools on the ground and placed objects, by tile index. */
export interface GearState {
  ground: Record<number, ToolKind>;
  placed: Record<number, PlacedTool>;
}

export function newGear(): GearState {
  return { ground: {}, placed: {} };
}

/** The match's gear (older states made before tools existed have none yet). */
export function gearOf(s: MatchState): GearState {
  return (s.gear ??= newGear());
}

const DIRS: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export const isSandbag = (s: MatchState, j: number) => s.gear?.placed[j]?.kind === 'sandbag';
export const isBridge = (s: MatchState, j: number) => s.gear?.placed[j]?.kind === 'bridge';

/** A supply drop lands its tool (only where its item landed). */
export function landTool(s: MatchState, k: number, j: number, ev: MatchEvent[]) {
  const tool = dropTool(s.map.def, k);
  if (!tool) return;
  gearOf(s).ground[j] = tool;
  ev.push({ kind: 'tool_dropped', tool, at: [j % s.map.w, (j / s.map.w) | 0] });
}

/** An agent standing on a tool with an empty tool slot takes it. */
export function pickTool(s: MatchState, a: AgentState, ev: MatchEvent[]) {
  const g = gearOf(s);
  const j = a.y * s.map.w + a.x;
  const tool = g.ground[j];
  if (!tool || a.tool) return;
  delete g.ground[j];
  a.tool = tool;
  ev.push({ kind: 'tool_picked', agent: a.id, tool, at: [a.x, a.y] });
}

/** Why `tool` cannot go toward `dir`, or null when it can. */
export function toolRefusal(s: MatchState, a: AgentState, tool: ToolKind, dir: Dir | undefined): string | null {
  if (a.tool !== tool) return a.tool ? `you carry ${TOOL_TEXT[a.tool].name.toLowerCase()}, not ${TOOL_TEXT[tool].name.toLowerCase()}` : 'you carry no tool';
  if (!dir) return `${TOOL_TEXT[tool].name} needs a direction`;
  const { w, h } = s.map;
  const x = a.x + DIRS[dir][0];
  const y = a.y + DIRS[dir][1];
  if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return 'that tile is the map edge';
  const j = y * w + x;
  if (gearOf(s).placed[j]) return 'something is already placed there';
  const t = s.grid[j];
  switch (tool) {
    case 'sandbag':
      return t === null || t === 'grass' ? null : 'sandbags go on open floor or grass';
    case 'bridge':
      return t === 'water' ? null : 'a bridge goes on a water tile';
    case 'pump':
      return t === null || t === 'grass' || t === 'water' || t === 'item' || t === 'exit' ? null : 'a pump cannot go on a solid tile';
  }
}

/** Uses the agent's tool toward `dir`. Returns why not, or null. */
export function useTool(s: MatchState, a: AgentState, tool: ToolKind, dir: Dir | undefined, ev: MatchEvent[]): string | null {
  const why = toolRefusal(s, a, tool, dir);
  if (why) return why;
  const x = a.x + DIRS[dir!][0];
  const y = a.y + DIRS[dir!][1];
  const j = y * s.map.w + x;
  gearOf(s).placed[j] = tool === 'pump' ? { kind: tool, team: a.team, ran: 0 } : { kind: tool, team: a.team };
  a.tool = undefined;
  ev.push({ kind: 'tool_used', agent: a.id, tool, at: [x, y] });
  return null;
}

/** Every pump drains its ring for this tick, after the hazards spread; spent pumps go. */
export function runPumps(s: MatchState, ev: MatchEvent[]) {
  const g = s.gear;
  if (!g) return;
  const { w, h } = s.map;
  // Tile order, so the result never depends on insertion order.
  for (const key of Object.keys(g.placed).map(Number).sort((p, q) => p - q)) {
    const p = g.placed[key]!;
    if (p.kind !== 'pump') continue;
    p.ran = (p.ran ?? 0) + 1;
    const r = Math.min(p.ran, PUMP_RADIUS);
    const px = key % w;
    const py = (key / w) | 0;
    let drained = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -(r - Math.abs(dy)); dx <= r - Math.abs(dy); dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const j = y * w + x;
        if (s.grid[j] === 'water') {
          s.grid[j] = null;
          drained++;
        }
      }
    const done = p.ran >= PUMP_TICKS;
    if (done) delete g.placed[key];
    ev.push({ kind: 'pumped', at: [px, py], drained, done });
  }
}

/** Tools on the ground and placed objects as [x, y] lists (frames and observations). */
export function gearView(s: MatchState): { ground: { at: [number, number]; kind: ToolKind }[]; placed: { at: [number, number]; kind: ToolKind; ticksLeft?: number }[] } {
  const g = s.gear;
  const { w } = s.map;
  const at = (j: number): [number, number] => [j % w, (j / w) | 0];
  const keys = (r: Record<number, unknown>) => Object.keys(r).map(Number).sort((p, q) => p - q);
  if (!g) return { ground: [], placed: [] };
  return {
    ground: keys(g.ground).map((j) => ({ at: at(j), kind: g.ground[j]! })),
    placed: keys(g.placed).map((j) => {
      const p = g.placed[j]!;
      return p.kind === 'pump' ? { at: at(j), kind: p.kind, ticksLeft: PUMP_TICKS - (p.ran ?? 0) } : { at: at(j), kind: p.kind };
    }),
  };
}

/** The legal tool actions for an agent (none without a tool). */
export function toolActions(s: MatchState, a: AgentState): { type: 'use'; tool: ToolKind; dir: Dir }[] {
  const tool = a.tool;
  if (!tool) return [];
  return (['N', 'E', 'S', 'W'] as const).filter((dir) => toolRefusal(s, a, tool, dir) === null).map((dir) => ({ type: 'use', tool, dir }));
}
