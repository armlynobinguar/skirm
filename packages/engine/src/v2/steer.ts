// Hybrid control: a player steers one agent of their own crew by hand while the brain runs the rest.
// The player's input is either one action for the next tick (a step, a wait, the role's verb) or a
// standing order the server walks each tick until it is done (take the nearest item, deliver, go to
// a tile). steerAction turns the input into a legal action on the agent's own observation, so a
// steered agent sees exactly what its brain would (the crew's fog) and can never do anything its
// brain could not. Casual and practice only: realtime refuses it in ranked.
import type { Dir } from './map';
import type { Action } from './match';
import type { Observation } from './observe';

/** What the player sends for the agent they steer. */
export type SteerInput =
  /** One step this tick. */
  | { kind: 'move'; dir: Dir }
  /** Stand still this tick. */
  | { kind: 'wait' }
  /** The role's verb this tick, toward `dir` when given (else the first that fits), or a switch next to it. */
  | { kind: 'use'; dir?: Dir }
  /** Standing: walk to the nearest seen item until the agent is full or none is left in reach. */
  | { kind: 'take' }
  /** Standing: walk to the delivery point until the agent carries nothing. */
  | { kind: 'deliver' }
  /** Standing: walk to a tile (the overview's click-to-move); next to it when the tile is solid. */
  | { kind: 'goto'; to: [number, number] }
  /** Drops a standing order; the agent waits until the next input. */
  | { kind: 'stop' };

export type SteerKind = SteerInput['kind'];
export const STEER_KINDS: readonly SteerKind[] = ['move', 'wait', 'use', 'take', 'deliver', 'goto', 'stop'];
const DIR_LIST: readonly Dir[] = ['N', 'E', 'S', 'W'];
const STEP: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
/** Tiles a steered agent walks over ('?' unseen counts as open; rubble is dug through). */
const WALKABLE = new Set(['.', ',', '*', 'E', 'd', '?']);

/** A standing order (kept across ticks until done) rather than one tick's action. */
export const isStandingSteer = (i: SteerInput): i is Extract<SteerInput, { kind: 'take' | 'deliver' | 'goto' }> =>
  i.kind === 'take' || i.kind === 'deliver' || i.kind === 'goto';

/** Checks a steer input as a client sent it; the reason it is not one otherwise. Never throws. */
export function parseSteerInput(v: unknown): SteerInput | string {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'input must be an object';
  const o = v as Record<string, unknown>;
  const kind = o.kind;
  const only = (keys: string[]) => Object.keys(o).every((k) => k === 'kind' || keys.includes(k));
  const isDir = (d: unknown): d is Dir => typeof d === 'string' && (DIR_LIST as readonly string[]).includes(d);
  switch (kind) {
    case 'move':
      if (!only(['dir']) || !isDir(o.dir)) return 'move takes {dir: N, E, S or W}';
      return { kind, dir: o.dir };
    case 'use':
      if (!only(['dir'])) return 'use takes {dir?}';
      if (o.dir === undefined || o.dir === null) return { kind };
      if (!isDir(o.dir)) return 'use.dir must be N, E, S or W';
      return { kind, dir: o.dir };
    case 'goto': {
      const to = o.to;
      const tile = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 64;
      if (!only(['to']) || !Array.isArray(to) || to.length !== 2 || !tile(to[0]) || !tile(to[1])) return 'goto takes {to: [x, y]}';
      return { kind, to: [to[0] as number, to[1] as number] };
    }
    case 'wait':
    case 'take':
    case 'deliver':
    case 'stop':
      if (!only([])) return `${kind} takes no fields`;
      return { kind };
    default:
      return `input.kind must be one of ${STEER_KINDS.join(', ')}`;
  }
}

/**
 * The action a steer input makes this tick on the agent's observation, and whether the input is
 * used up (`done`: a one-tick input always is; a standing order once it has nothing left to do).
 * Anything that is not legal right now is a wait.
 */
export function steerAction(o: Observation, input: SteerInput): { action: Action; done: boolean } {
  const wait: Action = { type: 'wait' };
  const legalMove = (dir: Dir | null) => (dir ? o.legal.find((a) => a.type === 'move' && a.dir === dir) : undefined);
  switch (input.kind) {
    case 'move':
      return { action: legalMove(input.dir) ?? wait, done: true };
    case 'wait':
    case 'stop':
      return { action: wait, done: true };
    case 'use': {
      const verbs = o.legal.filter((a): a is Extract<Action, { type: 'verb' }> => a.type === 'verb');
      const verb = input.dir ? verbs.find((a) => a.dir === input.dir) ?? verbs.find((a) => !a.dir) : verbs[0];
      return { action: verb ?? o.legal.find((a) => a.type === 'switch') ?? wait, done: true };
    }
    case 'take': {
      if (o.me.carrying >= o.me.capacity) return { action: wait, done: true };
      const dir = firstStep(o, (c) => c === '*');
      return dir ? { action: legalMove(dir) ?? wait, done: false } : { action: wait, done: true };
    }
    case 'deliver': {
      if (!o.me.carrying) return { action: wait, done: true };
      const [ex, ey] = o.map.exit;
      const dir = firstStep(o, (_c, x, y) => x === ex && y === ey);
      return dir ? { action: legalMove(dir) ?? wait, done: false } : { action: wait, done: true };
    }
    case 'goto': {
      const [tx, ty] = input.to;
      if (o.me.x === tx && o.me.y === ty) return { action: wait, done: true };
      const open = WALKABLE.has(o.rows[ty]?.[tx] ?? '#');
      // A solid tile: next to it is as close as the agent gets.
      if (!open && Math.abs(o.me.x - tx) + Math.abs(o.me.y - ty) === 1) return { action: wait, done: true };
      const dir = firstStep(o, (_c, x, y) => (open ? x === tx && y === ty : Math.abs(x - tx) + Math.abs(y - ty) === 1));
      return dir ? { action: legalMove(dir) ?? wait, done: false } : { action: wait, done: true };
    }
  }
}

/** Breadth-first over the seen map: the first step toward the nearest tile `goal` holds for, or null. */
function firstStep(o: Observation, goal: (c: string, x: number, y: number) => boolean): Dir | null {
  const h = o.rows.length;
  const w = o.rows[0]?.length ?? 0;
  const start = o.me.y * w + o.me.x;
  const first = new Map<number, Dir>();
  const seen = new Set([start]);
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    const j = q[i]!;
    const x = j % w;
    const y = (j / w) | 0;
    if (j !== start && goal(o.rows[y]![x]!, x, y)) return first.get(j)!;
    for (const d of DIR_LIST) {
      const nx = x + STEP[d][0];
      const ny = y + STEP[d][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = ny * w + nx;
      if (seen.has(k) || !WALKABLE.has(o.rows[ny]![nx]!)) continue;
      seen.add(k);
      first.set(k, j === start ? d : first.get(j)!);
      q.push(k);
    }
  }
  return null;
}
