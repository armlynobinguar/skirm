// Supply drops placed from randomness rather than the map file (Zama matches: SkirmMatch on Sepolia).
// The map still says how many drops there are, when each lands and which tool comes with it; the
// tile comes from a random value. Values map to tiles deterministically: an index into the map's
// candidate drop tiles (open floor on the centre column, so both crews stand the same distance from
// any of them), modulo their number.
//
// Two inputs, both optional on createMatch:
//   - `dropSchedule`: every drop's tile (and tick) known up front, e.g. a replay of a finished match;
//   - `sealedDrops`: the tiles stay unknown until placeSealedDrop places them one by one (the live
//     match, as each value is revealed on chain). A sealed drop does not land before it is placed;
//     placed late, it lands on the next tick.
import { sha256Hex } from '../sha256';
import type { MapDefV2, ParsedMap } from './map';
import type { MatchState } from './match';

/** One supply drop as a match plays it. */
export interface DropSlot {
  at: [number, number];
  tick: number;
  tool?: MapDefV2['drops'][number]['tool'];
  /** The tile is not known yet (sealedDrops): the drop cannot land until placeSealedDrop. */
  sealed?: true;
  /** The random value its tile came from (dropSchedule / placeSealedDrop with a value). */
  value?: number;
}

/** A drop's placement given up front: a tile, or a random value mapped to one (sealedDropTile). */
export type DropPlacement = { at: [number, number]; tick?: number } | { value: number; tick?: number };

/** Largest value a drop slot draws (FHE.randEuint16). */
export const DROP_VALUE_MAX = 0xffff;

/**
 * Where a random drop may land, in a fixed order (top to bottom): open floor on the centre column,
 * inside the walls, not a start, the delivery point, an item, ice or a gas vent. Mirrored maps make
 * every one of them equally far from both crews' halves.
 */
export function dropCandidates(map: ParsedMap): [number, number][] {
  const { w, h, grid, def } = map;
  const mid = (w - 1) / 2;
  const taken = new Set<string>([...def.starts.A, ...def.starts.B, ...(def.gas ?? []).map((g) => g.at)].map(([x, y]) => `${x},${y}`));
  const out: [number, number][] = [];
  for (let y = 1; y < h - 1; y++) if (grid[y * w + mid] === null && !taken.has(`${mid},${y}`)) out.push([mid, y]);
  return out;
}

/** The tile a random drop value lands on: candidates[value mod their number]. */
export function sealedDropTile(map: ParsedMap, value: number): [number, number] {
  if (!Number.isInteger(value) || value < 0) throw new Error(`a drop value must be a non-negative integer, got ${value}`);
  const c = dropCandidates(map);
  if (!c.length) throw new Error(`${map.def.id}: no open centre tile for a supply drop`);
  return c[value % c.length]!;
}

/**
 * A drop value derived from the match seed (sha256 of "seed:drop:k", the first 16 bits). Public as
 * soon as the seed is, so it only stands in when a sealed value never arrives.
 */
export function seedDropValue(seed: string, k: number): number {
  return parseInt(sha256Hex(`${seed}:drop:${k}`).slice(0, 4), 16);
}

/** The drops a match plays: the map's, with `schedule` and `sealed` applied. Checks every tile. */
export function matchDrops(map: ParsedMap, schedule?: readonly DropPlacement[], sealed?: boolean): DropSlot[] {
  const drops = map.def.drops;
  if (schedule && schedule.length !== drops.length) throw new Error(`${map.def.id} has ${drops.length} supply drops, the schedule ${schedule.length}`);
  return drops.map((d, k) => {
    const p = schedule?.[k];
    const base: DropSlot = { at: [d.at[0], d.at[1]], tick: p?.tick ?? d.tick, ...(d.tool ? { tool: d.tool } : {}) };
    if (p && 'value' in p) return { ...base, at: sealedDropTile(map, p.value), value: p.value };
    if (p) {
      if (!dropCandidates(map).some(([x, y]) => x === p.at[0] && y === p.at[1])) throw new Error(`a supply drop cannot land at ${p.at}`);
      return { ...base, at: [p.at[0], p.at[1]] };
    }
    return sealed ? { ...base, sealed: true } : base;
  });
}

/** The drops of a match: its own (dropSchedule / sealedDrops) or the map's. */
export function dropsOf(s: Pick<MatchState, 'drops' | 'map'>): readonly DropSlot[] {
  return s.drops ?? s.map.def.drops;
}

/**
 * Places sealed drop `k` from its revealed random value: the tile is sealedDropTile(value), and the
 * drop lands on its map tick, or on the next tick when that has passed. Returns the slot; refuses a
 * drop that is not sealed (already placed, or the match has no sealed drops).
 */
export function placeSealedDrop(s: MatchState, k: number, value: number): DropSlot {
  const d = s.drops?.[k];
  if (!d?.sealed) throw new Error(`supply drop ${k} is not sealed`);
  const placed: DropSlot = { at: sealedDropTile(s.map, value), tick: Math.max(d.tick, s.tick + 1), value, ...(d.tool ? { tool: d.tool } : {}) };
  s.drops![k] = placed;
  return placed;
}

/** The sealed drops due by `tick` (their map tick has come) and still unplaced, by slot. */
export function sealedDropsDue(s: Pick<MatchState, 'drops'>, tick: number): number[] {
  return (s.drops ?? []).flatMap((d, k) => (d.sealed && d.tick <= tick ? [k] : []));
}
