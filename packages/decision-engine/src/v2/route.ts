// Route hints for the turn prompt: for each legal move, how many steps the tile it leads to is from
// the nearest item, the delivery point and the nearest unseen tile, over the map as the crew has
// seen it ('?' counts as open, rubble as passable). Counting tiles on a text grid is where a small
// model goes wrong; with the distances in front of it the model still chooses, it just does not
// have to measure.
import type { Action, Observation } from '@skirm/engine/v2';

const STEP: Record<'N' | 'E' | 'S' | 'W', [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPEN = new Set(['.', ',', '*', 'E', 'd', '?']);

export interface Distances {
  item: number | null;
  deliver: number | null;
  unseen: number | null;
}

/** Steps from (x, y) to the nearest item, the delivery point and the nearest unseen tile. */
export function distancesFrom(o: Observation, x0: number, y0: number): Distances {
  const h = o.rows.length;
  const w = o.rows[0]?.length ?? 0;
  const out: Distances = { item: null, deliver: null, unseen: null };
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return out;
  const dist = new Int32Array(w * h).fill(-1);
  const q = [y0 * w + x0];
  dist[q[0]!] = 0;
  for (let i = 0; i < q.length; i++) {
    const j = q[i]!;
    const x = j % w;
    const y = (j / w) | 0;
    const c = o.rows[y]![x]!;
    const d = dist[j]!;
    if (c === '*' && out.item === null) out.item = d;
    if (c === '?' && out.unseen === null) out.unseen = d;
    if (x === o.map.exit[0] && y === o.map.exit[1] && out.deliver === null) out.deliver = d;
    if (out.item !== null && out.deliver !== null && out.unseen !== null) break;
    for (const s of Object.values(STEP)) {
      const nx = x + s[0];
      const ny = y + s[1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (dist[k]! >= 0 || !OPEN.has(o.rows[ny]![nx]!)) continue;
      // Rubble takes 3 hits to clear before it can be walked.
      dist[k] = d + (o.rows[ny]![nx] === 'd' ? 3 : 1);
      q.push(k);
    }
  }
  return out;
}

/** " (item 4, deliver 12)" for a move; "" for anything else. */
export function routeHint(o: Observation, a: Action): string {
  if (a.type !== 'move') return '';
  const [dx, dy] = STEP[a.dir];
  const d = distancesFrom(o, o.me.x + dx, o.me.y + dy);
  const parts = [
    d.item !== null ? `item ${d.item}` : null,
    o.me.carrying || d.item === null ? (d.deliver !== null ? `deliver ${d.deliver}` : null) : null,
    d.item === null && d.unseen !== null ? `unseen ${d.unseen}` : null,
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}
