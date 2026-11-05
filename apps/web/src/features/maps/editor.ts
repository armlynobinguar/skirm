// The map editor's model, pure so it is easy to test: brushes that paint a skirm.map/v2 draft (with
// the mirror helper painting the other half too), the board-level helpers (resize to a preset,
// mirror a whole half) and the undo/redo history. The screen (./MapEditorScreen) only wires input
// to these functions; validation is the engine's validateCommunityMap, run live on every change.
import { blankCommunityMap, mirrorMap, type HazardKind, type MapDefV2 } from '@skirm/engine/v2';

export type TileBrush = 'floor' | 'wall' | 'grass' | 'tree' | 'dirt' | 'crate' | 'block' | 'water' | 'fire' | 'lava' | 'item';
export type Brush = TileBrush | 'exit' | 'start' | 'switch' | 'lane' | 'drop';

/** The palette, in order: map character, label and what it does. */
export const BRUSHES: readonly { id: Brush; ch?: string; label: string; hint: string }[] = [
  { id: 'floor', ch: '.', label: 'Floor', hint: 'Open ground (also erases)' },
  { id: 'wall', ch: '#', label: 'Wall', hint: 'Solid for good' },
  { id: 'dirt', ch: 'd', label: 'Rubble', hint: 'Solid until dug (remove_solid)' },
  { id: 'crate', ch: 'c', label: 'Crate', hint: 'Solid until pushed or cleared' },
  { id: 'block', ch: 'B', label: 'Block', hint: 'A placed block' },
  { id: 'tree', ch: 'T', label: 'Tree', hint: 'Solid; burns' },
  { id: 'grass', ch: ',', label: 'Grass', hint: 'Open; fire spreads through it' },
  { id: 'water', ch: '~', label: 'Water source', hint: 'Spreads as a water hazard' },
  { id: 'fire', ch: '^', label: 'Fire source', hint: 'Spreads as a fire hazard' },
  { id: 'lava', ch: 'L', label: 'Lava source', hint: 'Spreads; removes agents' },
  { id: 'item', ch: '*', label: 'Goal item', hint: 'What crews deliver' },
  { id: 'exit', ch: 'E', label: 'Delivery point', hint: 'One, on the centre column' },
  { id: 'start', label: 'Spawn', hint: "Crew A's starts (left); crew B mirrors" },
  { id: 'switch', ch: 'V', label: 'Switch', hint: 'A valve on the centre column' },
  { id: 'lane', label: 'Switch lane', hint: 'Tiles the selected switch floods' },
  { id: 'drop', label: 'Supply drop', hint: 'An extra item lands on the centre column' },
];

const CH: Record<TileBrush, string> = { floor: '.', wall: '#', grass: ',', tree: 'T', dirt: 'd', crate: 'c', block: 'B', water: '~', fire: '^', lava: 'L', item: '*' };
const HAZ_CH: Record<HazardKind, string> = { water: '~', fire: '^', lava: 'L' };
/** A new hazard's spread interval and wave cap. */
export const HAZARD_DEFAULT = { every: 4, cap: 6 } as const;
const DROP_TICK = 40;
const MAX_STARTS = 3;
const MAX_SWITCHES = 3;
const MAX_DROPS = 3;

const widthOf = (d: MapDefV2) => d.rows[0]?.length ?? 0;
const midOf = (d: MapDefV2) => (widthOf(d) - 1) / 2;
const charAt = (d: MapDefV2, x: number, y: number) => d.rows[y]?.[x];
const same = (a: [number, number], x: number, y: number) => a[0] === x && a[1] === y;

function setChar(rows: string[], x: number, y: number, c: string): string[] {
  const r = rows[y];
  if (r === undefined || x < 0 || x >= r.length) return rows;
  const out = rows.slice();
  out[y] = r.slice(0, x) + c + r.slice(x + 1);
  return out;
}

/** Hazards follow their source tiles: a new source adds its hazard, a removed last source drops it. */
export function syncHazards(d: MapDefV2): MapDefV2 {
  const present = (Object.keys(HAZ_CH) as HazardKind[]).filter((k) => d.rows.some((r) => r.includes(HAZ_CH[k])));
  const kept = d.hazards.filter((h) => present.includes(h.kind));
  const added = present.filter((k) => !kept.some((h) => h.kind === k)).map((kind) => ({ kind, ...HAZARD_DEFAULT }));
  if (!added.length && kept.length === d.hazards.length) return d;
  return { ...d, hazards: [...kept, ...added] };
}

/** Counts the goal items on the board. */
export const itemCount = (d: MapDefV2) => d.rows.join('').split('').filter((c) => c === '*').length;

/**
 * Paints one tile with `brush`. With `mirror`, the tile across the centre column gets the same
 * (spawns and switch lanes always mirror: the format requires it). `lane` paints the lanes of switch
 * `switchIndex`. Tiles on the border and brushes that only go on the centre column elsewhere do nothing.
 */
export function paint(d: MapDefV2, brush: Brush, x: number, y: number, opts: { mirror: boolean; switchIndex?: number }): MapDefV2 {
  const w = widthOf(d);
  const h = d.rows.length;
  const mid = midOf(d);
  if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return d;
  const mx = w - 1 - x;
  const leftX = x < mid ? x : mx;

  if (brush === 'exit') {
    if (x !== mid) return d;
    let rows = d.rows;
    rows.forEach((r, yy) => {
      const ex = r.indexOf('E');
      if (ex >= 0) rows = setChar(rows, ex, yy, '.');
    });
    rows = setChar(rows, x, y, 'E');
    return syncHazards({ ...d, rows, exit: [x, y] });
  }

  if (brush === 'start') {
    if (x === mid) return d;
    const has = d.starts.A.findIndex((s) => same(s, leftX, y));
    let A = d.starts.A;
    if (has >= 0) A = A.filter((_, i) => i !== has);
    else if (A.length < MAX_STARTS) A = [...A, [leftX, y]];
    else return d;
    return { ...d, starts: { A, B: A.map(([sx, sy]) => [w - 1 - sx, sy] as [number, number]) } };
  }

  if (brush === 'switch') {
    if (x !== mid) return d;
    const has = d.switches.findIndex((s) => same(s.at, x, y));
    if (has >= 0) return { ...d, rows: setChar(d.rows, x, y, '.'), switches: d.switches.filter((_, i) => i !== has) };
    if (d.switches.length >= MAX_SWITCHES) return d;
    return { ...d, rows: setChar(d.rows, x, y, 'V'), switches: [...d.switches, { at: [x, y], name: 'Open the gate', kind: 'water', lanes: { A: [], B: [] } }] };
  }

  if (brush === 'lane') {
    const k = opts.switchIndex ?? 0;
    const sw = d.switches[k];
    if (!sw || x === mid) return d;
    const a = y * w + leftX;
    const b = y * w + (w - 1 - leftX);
    const on = sw.lanes.A.includes(a);
    const lanes = on ? { A: sw.lanes.A.filter((j) => j !== a), B: sw.lanes.B.filter((j) => j !== b) } : { A: [...sw.lanes.A, a], B: [...sw.lanes.B, b] };
    return { ...d, switches: d.switches.map((s, i) => (i === k ? { ...s, lanes } : s)) };
  }

  if (brush === 'drop') {
    if (x !== mid) return d;
    const has = d.drops.findIndex((p) => same(p.at, x, y));
    if (has >= 0) return { ...d, drops: d.drops.filter((_, i) => i !== has) };
    if (d.drops.length >= MAX_DROPS) return d;
    return { ...d, drops: [...d.drops, { at: [x, y], tick: DROP_TICK + 30 * d.drops.length }] };
  }

  // A plain tile. Painting over a switch takes it away; over the delivery point, validation asks for a new one.
  const c = CH[brush];
  let next = d;
  for (const px of opts.mirror && x !== mid ? [x, mx] : [x]) {
    const old = charAt(next, px, y);
    if (old === c) continue;
    const switches = old === 'V' ? next.switches.filter((s) => !same(s.at, px, y)) : next.switches;
    next = { ...next, rows: setChar(next.rows, px, y, c), switches };
  }
  return syncHazards(next);
}

/** A new board of `w` × `h`, keeping the draft's names and rules. */
export function resize(d: MapDefV2, w: number, h: number): MapDefV2 {
  const blank = blankCommunityMap(w, h);
  return {
    ...d,
    rows: blank.rows,
    starts: blank.starts,
    exit: blank.exit,
    switches: [],
    drops: [],
    hazards: [],
    goal: Math.min(d.goal, itemCount(blank)),
  };
}

/** Copies one half onto the other (and mirrors spawns and lanes). */
export function mirrorHalf(d: MapDefV2, from: 'left' | 'right'): MapDefV2 {
  const m = mirrorMap(d, from);
  // Switches and drops sit on the centre column, which mirroring keeps; a valve copied by the rows
  // is the same tile. Hazards follow the tiles.
  return syncHazards(m);
}

export interface History {
  past: MapDefV2[];
  present: MapDefV2;
  future: MapDefV2[];
}

/** Steps kept for undo. */
export const HISTORY_MAX = 100;

export const historyOf = (present: MapDefV2): History => ({ past: [], present, future: [] });

/** Records a change (nothing when it changed nothing); a new change clears redo. */
export function commit(h: History, next: MapDefV2): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_MAX), present: next, future: [] };
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}
