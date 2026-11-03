// The ten maps as played: every item and the delivery point reachable from every start, contested
// items as far from one crew as from the other (so each is a race), flow like hand-built Copper
// Hollow (few dead ends, no single-file way out), and no hazard next to a start in its first wave
// (a crew is never boxed in at spawn).
import { describe, expect, it } from 'vitest';
import { MAPS_V2, middleTiles, parseMapV2, type ParsedMap, type Tile } from '../src/v2';

const STEPS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Steps from (x, y) to every tile, rubble costing 3 (it is dug through); -1 where unreachable. */
function distances(p: ParsedMap, [x0, y0]: [number, number]): number[] {
  const { w, h, grid } = p;
  const walk = (t: Tile | null) => t === null || t === 'grass' || t === 'item' || t === 'exit' || t === 'dirt';
  const d = new Array<number>(w * h).fill(-1);
  const q = [y0 * w + x0];
  d[q[0]!] = 0;
  for (let i = 0; i < q.length; i++) {
    const j = q[i]!;
    for (const [dx, dy] of STEPS) {
      const x = (j % w) + dx;
      const y = ((j / w) | 0) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const k = y * w + x;
      if (d[k]! >= 0 || !walk(grid[k]!)) continue;
      d[k] = d[j]! + (grid[k] === 'dirt' ? 3 : 1);
      q.push(k);
    }
  }
  return d;
}

describe('v2 maps', () => {
  for (const def of MAPS_V2) {
    const p = parseMapV2(def);
    const items = p.grid.flatMap((t, i) => (t === 'item' ? [i] : []));
    const exit = def.exit[1] * p.w + def.exit[0];

    it(`${def.code} ${def.name}: every item and the delivery point are reachable from every start`, () => {
      for (const T of ['A', 'B'] as const)
        for (const s of def.starts[T]) {
          const d = distances(p, s);
          expect(items.filter((i) => d[i]! < 0), `${T} ${s}`).toEqual([]);
          expect(d[exit], `${T} ${s}`).toBeGreaterThan(0);
        }
      expect(items.length + def.drops.length).toBeGreaterThanOrEqual(def.goal);
    });

    it(`${def.code} ${def.name}: every contested item is as far from one crew as from the other`, () => {
      const dA = distances(p, def.starts.A[0]!);
      const dB = distances(p, def.starts.B[0]!);
      const middle = middleTiles(p);
      expect(middle.length).toBeGreaterThan(0);
      for (const m of middle) expect(dA[m], `${m % p.w},${(m / p.w) | 0}`).toBe(dB[m]);
    });

    it(`${def.code} ${def.name}: flows like hand-built Copper Hollow (few dead ends, no single-file way out)`, () => {
      const { w, h, grid } = p;
      const walk = (i: number) => {
        const t = grid[i];
        return t === null || t === 'grass' || t === 'item' || t === 'exit' || t === 'dirt';
      };
      const nb = (i: number) =>
        STEPS.map(([dx, dy]) => [(i % w) + dx, ((i / w) | 0) + dy] as const)
          .filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < h)
          .map(([x, y]) => y * w + x);
      const cells = grid.flatMap((_, i) => (walk(i) ? [i] : []));
      const deadEnds = cells.filter((i) => nb(i).filter(walk).length === 1).length;
      expect((deadEnds / cells.length) * 100, 'dead ends per 100 open tiles').toBeLessThanOrEqual(2);
      // Tiles every route from the start to the delivery point must cross. The tutorial has one
      // route by design (difficulty 1); every other map has none.
      const start = def.starts.A[0]![1] * w + def.starts.A[0]![0];
      const reach = (blocked: number) => {
        const seen = new Set([start]);
        const q = [start];
        while (q.length) for (const k of nb(q.pop()!)) if (walk(k) && k !== blocked && !seen.has(k)) (seen.add(k), q.push(k));
        return seen;
      };
      const chokes = [...reach(-1)].filter((i) => i !== start && i !== exit && !reach(i).has(exit));
      if (def.difficulty > 1) expect(chokes, 'chokepoints').toEqual([]);
    });

    it(`${def.code} ${def.name}: no hazard reaches next to a start in its first wave`, () => {
      const starts = [...def.starts.A, ...def.starts.B];
      for (const hz of def.hazards) {
        const firstWave = new Set<number>();
        p.grid.forEach((t, i) => {
          if (t !== hz.kind) return;
          for (const [dx, dy] of STEPS) firstWave.add(i + dy * p.w + dx);
        });
        for (const [x, y] of starts)
          for (const [dx, dy] of STEPS) expect(firstWave.has((y + dy) * p.w + x + dx), `${hz.kind} next to ${x},${y}`).toBe(false);
      }
    });
  }
});
