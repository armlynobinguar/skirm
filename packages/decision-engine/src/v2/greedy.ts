// A deterministic offline brain for dev, tests and benchmarks without model keys: walk (and dig) to
// the nearest item the crew has seen, explore when it has seen none, deliver when full or when the
// crew has enough, and use a switch now and then when next to one. It routes around tiles next to
// lava (the next wave takes them, and lava removes an agent) when it can. With nothing to do it never
// idles on the delivery point or next to another agent, where it would block a corridor someone needs. It never speaks except a callout when it delivers.
// Its plan, reason and inner voice are read off what it does (greedyPlan, greedyThought), for the mind panel.
import { CALLOUTS, type Action, type Observation } from '@skirm/engine/v2';
import { distancesFrom } from './route';

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
  // Nothing to fetch or deliver: step out of the way rather than block someone who has.
  const move = dir ? o.legal.find((a) => a.type === 'move' && a.dir === dir) : standAside(o);
  if (!move) return { type: 'wait' };
  if (!dir) return move;
  // Two agents stepping onto one tile both stay put, so a pair heading for the same tile would stall
  // forever: when another agent is next to the tile, yield on about half the ticks (by id and tick).
  const nx = o.me.x + STEP[dir!][0];
  const ny = o.me.y + STEP[dir!][1];
  const crowded = [...o.teammates, ...o.rivals].some((x) => !x.down && Math.abs(x.x - nx) + Math.abs(x.y - ny) === 1);
  // A high bit of the hash: its lowest bit only follows the parity of the characters, so two ids
  // like "a-2" and "b-1" would always yield together and never get past each other.
  return crowded && ((hash(`${o.me.id}:${o.tick}`) >>> 16) & 1) === 1 ? { type: 'wait' } : move;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * An idle agent on the delivery point or next to another agent moves: off the delivery point, away
 * from lava, and to a tile next to nobody when it can. Elsewhere it stays put (undefined).
 */
function standAside(o: Observation): Action | undefined {
  const isExit = (x: number, y: number) => x === o.map.exit[0] && y === o.map.exit[1];
  const others = [...o.teammates, ...o.rivals].filter((a) => !a.down);
  const nextToSomeone = (x: number, y: number) => others.some((a) => Math.abs(a.x - x) + Math.abs(a.y - y) === 1);
  if (!isExit(o.me.x, o.me.y) && !nextToSomeone(o.me.x, o.me.y)) return undefined;
  const moves = o.legal
    .filter((a): a is Extract<Action, { type: 'move' }> => a.type === 'move')
    .map((a) => ({ a, x: o.me.x + STEP[a.dir][0], y: o.me.y + STEP[a.dir][1] }))
    .filter((m) => !isExit(m.x, m.y) && o.rows[m.y]?.[m.x] !== 'd' && !nearLava(o, m.x, m.y));
  return (moves.find((m) => !nextToSomeone(m.x, m.y)) ?? moves[0])?.a;
}

/** Is a tile lava or next to it (where the next lava wave can reach)? */
function nearLava(o: Observation, x: number, y: number): boolean {
  for (const [dx, dy] of [[0, 0], ...Object.values(STEP)] as [number, number][]) if (o.rows[y + dy]?.[x + dx] === 'L') return true;
  return false;
}

/** The first step toward the nearest goal tile: around lava when possible, else the plain route. */
function firstStep(o: Observation, goal: (c: string, x: number, y: number) => boolean): 'N' | 'E' | 'S' | 'W' | null {
  return search(o, goal, true) ?? search(o, goal, false);
}

/** Breadth-first over the seen map ('?' counts as open), optionally keeping off tiles next to lava. */
function search(o: Observation, goal: (c: string, x: number, y: number) => boolean, safe: boolean): 'N' | 'E' | 'S' | 'W' | null {
  const h = o.rows.length;
  const w = o.rows[0]?.length ?? 0;
  const walkable = (c: string) => c === '.' || c === ',' || c === '*' || c === 'E' || c === 'd' || c === '?';
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
      const c = o.rows[ny]![nx]!;
      // The safe route keeps off tiles next to lava, except the goal tile itself (the last step).
      if (seen.has(k) || !walkable(c) || (safe && nearLava(o, nx, ny) && !goal(c, nx, ny))) continue;
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

/** "lamp oil" → "lamp oils" (plain plural for the bot's lines). */
const plural = (item: string, n: number) => (n === 1 ? item : item.endsWith('s') ? item : `${item}s`);

/**
 * The bot's crew plan, read off what greedy will do (it plans nothing itself): what is left to
 * deliver and its one rule. Deterministic, so a practice match still replays the same.
 */
export function greedyPlan(o: Observation): { text: string; why: string } {
  const item = o.map.item.toLowerCase();
  const need = Math.max(0, o.map.goal - o.score.mine);
  const d = distancesFrom(o, o.me.x, o.me.y);
  const text = need
    ? `Everyone takes the nearest ${item} the crew has seen and delivers when full or when it wins. ${need} ${plural(item, need)} to go.`
    : `Hold the ${o.map.deliverTo.toLowerCase()} clear; the match is ours.`;
  const why =
    d.item !== null
      ? `The nearest known ${item} is ${d.item} steps out; the rival has ${o.score.rival} of ${o.map.goal}.`
      : `No ${item} in sight yet, so the crew spreads out to look; the rival has ${o.score.rival} of ${o.map.goal}.`;
  return { text, why };
}

/** One first-person line for what the bot is about to do (its inner voice), at most 80 characters. */
export function greedyThought(o: Observation, act: Action): string {
  const item = o.map.item.toLowerCase();
  const need = o.map.goal - o.score.mine;
  const d = distancesFrom(o, o.me.x, o.me.y);
  let t: string;
  if (act.type === 'switch') t = 'Switch is ready. Flooding their lane.';
  else if (o.me.carrying && (o.me.carrying >= o.me.capacity || o.me.carrying >= need)) t = `${o.me.carrying} in hand. ${d.deliver ?? '?'} steps to the ${o.map.deliverTo.toLowerCase()}.`;
  else if (act.type === 'wait') t = o.legal.length > 1 ? 'Someone is in my way. I will let them pass.' : 'Holding here.';
  else if (d.item !== null) t = `${d.item} steps to the nearest ${item}. Going.`;
  else t = `No ${item} in sight. Looking around.`;
  return [...t].slice(0, 80).join('');
}
