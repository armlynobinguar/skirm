// skirm.map/v2: a mirrored 2-crew arena (spec/maps/v2/*.json, written by scripts/export-v2-maps.ts).
// Tiles are one character per cell; everything else (verbs, hazards, switches, drops) is listed
// beside the rows. The engine only knows effect classes: a map's themed verbs say which class each
// one is, so one skill works on every map.

import type { ToolKind } from './tools';

export type Team = 'A' | 'B';
export type Dir = 'N' | 'E' | 'S' | 'W';
export type Tile = 'wall' | 'grass' | 'tree' | 'dirt' | 'water' | 'lava' | 'fire' | 'item' | 'exit' | 'crate' | 'block' | 'valve';
export type HazardKind = 'water' | 'fire' | 'lava';
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

export const EFFECT_CLASSES: readonly EffectClass[] = [
  'grow',
  'add_solid',
  'remove_solid',
  'push',
  'add_liquid',
  'ignite',
  'extinguish',
  'area_repel',
  'take',
  'deliver',
];

export interface MapVerb {
  /** Stable id within the map, e.g. "dig_rubble". */
  id: string;
  /** Theme text the agents see, e.g. "Dig rubble". */
  name: string;
  effect: EffectClass;
}

export interface MapSwitch {
  at: [number, number];
  name: string;
  /** What it puts in the rival's lane: water, fire or dirt. */
  kind: 'water' | 'fire' | 'dirt';
  /** Tile indexes (y * w + x) of each crew's lane. Using the switch floods the other crew's lane. */
  lanes: { A: number[]; B: number[] };
}

export interface MapDefV2 {
  schema: 'skirm.map/v2';
  id: string;
  code: string;
  name: string;
  region: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  label: string;
  blurb: string;
  /** Goal item and delivery point names, e.g. "Lamp oil" to the "Cage lift". */
  item: string;
  deliverTo: string;
  /** Items a crew must deliver to win. */
  goal: number;
  rows: string[];
  starts: { A: [number, number][]; B: [number, number][] };
  exit: [number, number];
  verbs: MapVerb[];
  /** Spread every `every` ticks for up to `cap` waves, then recede wave by wave, then grow again. */
  hazards: { kind: HazardKind; every: number; cap: number }[];
  switches: MapSwitch[];
  /** An extra goal item lands at `at` on `tick`, with a tool beside it when `tool` is set (or the drop table has one, tools.ts). */
  drops: { at: [number, number]; tick: number; tool?: ToolKind }[];
  /** Blocks each crew can place with add_solid. */
  blockSupply: number;
  /** Crews see only what their agents see. */
  fog: boolean;
  /** Dropped items can be picked up by either crew. */
  steal: boolean;
  /** Night: vision is one tile shorter. */
  night: boolean;
}

const CHAR: Record<string, Tile | null> = {
  '#': 'wall',
  '.': null,
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
};

export interface ParsedMap {
  def: MapDefV2;
  w: number;
  h: number;
  /** Row-major tiles at the start of a match. */
  grid: (Tile | null)[];
}

export class MapError extends Error {}

/** Reads and checks a v2 map: shape, tiles, starts, exit, mirrored layout, verbs and switches. */
export function parseMapV2(def: MapDefV2): ParsedMap {
  const fail = (msg: string): never => {
    throw new MapError(`${def.id ?? 'map'}: ${msg}`);
  };
  if (def.schema !== 'skirm.map/v2') fail(`schema must be skirm.map/v2, got ${def.schema}`);
  const h = def.rows.length;
  const w = def.rows[0]?.length ?? 0;
  if (h < 5 || w < 5) fail('map too small');
  if (def.rows.some((r) => r.length !== w)) fail('rows differ in length');
  if (w % 2 !== 1) fail('width must be odd (two halves and a centre column)');
  const grid: (Tile | null)[] = [];
  for (const r of def.rows)
    for (const ch of r) {
      if (!(ch in CHAR)) fail(`unknown tile "${ch}"`);
      grid.push(CHAR[ch]!);
    }
  const at = (x: number, y: number) => grid[y * w + x];
  const inside = ([x, y]: [number, number]) => x > 0 && y > 0 && x < w - 1 && y < h - 1;
  for (const T of ['A', 'B'] as const) {
    if (!def.starts[T].length) fail(`crew ${T} has no starts`);
    for (const s of def.starts[T]) if (!inside(s) || at(s[0], s[1]) !== null) fail(`start ${s} of crew ${T} is not open floor`);
  }
  // Mirrored: crew B's starts are crew A's reflected across the centre column.
  def.starts.A.forEach(([x, y], i) => {
    const b = def.starts.B[i];
    if (!b || b[0] !== w - 1 - x || b[1] !== y) fail('starts are not mirrored');
  });
  if (def.exit[0] !== (w - 1) / 2 || at(def.exit[0], def.exit[1]) !== 'exit') fail('the delivery point must be on the centre column');
  if (def.goal < 1) fail('goal must be at least 1');
  const ids = new Set<string>();
  for (const v of def.verbs) {
    if (ids.has(v.id)) fail(`verb ${v.id} twice`);
    ids.add(v.id);
    if (!EFFECT_CLASSES.includes(v.effect)) fail(`verb ${v.id}: unknown effect ${v.effect}`);
  }
  for (const s of def.switches) if (at(s.at[0], s.at[1]) !== 'valve') fail(`switch at ${s.at} is not a valve tile`);
  for (const d of def.drops) if (!inside(d.at)) fail(`drop at ${d.at} is outside the map`);
  return { def, w, h, grid };
}

/** Width of the open middle band on each side of the centre column, by map difficulty (the prototype's SPEC). */
const MIDDLE_BAND: Record<MapDefV2['difficulty'], number> = { 1: 1, 2: 2, 3: 4, 4: 5, 5: 7 };

/**
 * The contested ("middle") items: goal items that start between the two crews' home walls, where
 * neither crew is closer. Supply drops are not among them: they land later.
 */
export function middleTiles(p: ParsedMap): number[] {
  const half = (p.w - 1) / 2;
  const sep = half - (MIDDLE_BAND[p.def.difficulty] ?? 1) - 1;
  const out: number[] = [];
  p.grid.forEach((t, i) => {
    const x = i % p.w;
    if (t === 'item' && x > sep && x < p.w - 1 - sep) out.push(i);
  });
  return out;
}
