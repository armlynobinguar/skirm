// A deterministic offline brain for dev, tests and benchmarks without model keys: walk (and dig) to
// the nearest item the crew has seen, explore when it has seen none, deliver when full or when the
// crew has enough, and use a switch now and then when next to one. It never speaks except a callout when it delivers.
import { CALLOUTS, type Action, type Observation } from '@skirm/engine/v2';

const STEP: Record<'N' | 'E' | 'S' | 'W', [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export function greedyAct(o: Observation): Action {
  const sw = o.legal.find((a) => a.type === 'switch');
  if (sw && o.tick % 7 === 0) return sw;
  const need = o.map.goal - o.score.mine;
  const full = o.me.carrying >= o.me.capacity || (o.me.carrying > 0 && o.me.carrying >= need);
  const deliver = (c: string, x: number, y: number) => x === o.map.exit[0] && y === o.map.exit[1];
  // Deliver when full; else the nearest seen item; else explore the nearest unseen tile; else deliver.
  const dir =
    (full ? firstStep(o, deliver) : null) ??
    firstStep(o, (c) => c === '*') ??
    firstStep(o, (c) => c === '?') ??
    (o.me.carrying ? firstStep(o, deliver) : null);
  const move = dir ? o.legal.find((a) => a.type === 'move' && a.dir === dir) : undefined;
  if (!move) return { type: 'wait' };
  // Two agents stepping onto one tile both stay put, so a pair heading for the same tile would stall
  // forever: when another agent is next to the tile, yield on about half the ticks (by id and tick).
  const nx = o.me.x + STEP[dir!][0];
  const ny = o.me.y + STEP[dir!][1];
  const crowded = [...o.teammates, ...o.rivals].some((x) => !x.down && Math.abs(x.x - nx) + Math.abs(x.y - ny) === 1);
  return crowded && hash(`${o.me.id}:${o.tick}`) % 2 === 1 ? { type: 'wait' } : move;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Breadth-first over the seen map ('?' counts as open): the first step toward the nearest goal tile. */
function firstStep(o: Observation, goal: (c: string, x: number, y: number) => boolean): 'N' | 'E' | 'S' | 'W' | null {
  const h = o.rows.length;
  const w = o.rows[0]?.length ?? 0;
  const open = (c: string) => c === '.' || c === ',' || c === '*' || c === 'E' || c === 'd' || c === '?';
  const first = new Map<number, 'N' | 'E' | 'S' | 'W'>();
  const start = o.me.y * w + o.me.x;
  const q = [start];
  const seen = new Set(q);
  for (let i = 0; i < q.length; i++) {
    const j = q[i]!;
    const x = j % w;
    const y = (j / w) | 0;
    if (j !== start && goal(o.rows[y]![x]!, x, y)) return first.get(j)!;
    for (const d of ['N', 'E', 'S', 'W'] as const) {
      const nx = x + STEP[d][0];
      const ny = y + STEP[d][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (seen.has(k) || !open(o.rows[ny]![nx]!)) continue;
      seen.add(k);
      first.set(k, j === start ? d : first.get(j)!);
      q.push(k);
    }
  }
  return null;
}

export function greedySay(o: Observation, act: Action): string | null {
  return act.type === 'move' && o.me.carrying && o.me.x === o.map.exit[0] ? CALLOUTS[4]! : null;
}
