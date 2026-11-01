// Clock and timer seam. Production uses wall time; tests inject shorter v2 timings (and may inject
// their own scheduler) so a whole match runs in well under a second.
import { TICK_MS } from '@skirm/engine/v2';

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, Math.max(0, ms));
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function sleep(s: Scheduler, ms: number): Promise<void> {
  return new Promise((resolve) => {
    s.setTimeout(resolve, Math.max(0, ms));
  });
}

/** Elo-range widening while a player searches. */
export interface QueueTiming {
  /** How often queue_status goes out and pairing is retried. */
  statusEveryMs: number;
  /** Elo range at the start of a search (± around the player's rating). */
  baseRange: number;
  /** Added every `widenEveryMs`. */
  widenBy: number;
  widenEveryMs: number;
  /** Widest range; after this any opponent of the same lane is acceptable. */
  maxRange: number;
}

export const DEFAULT_QUEUE_TIMING: QueueTiming = {
  statusEveryMs: 1000,
  baseRange: 100,
  widenBy: 50,
  widenEveryMs: 5000,
  maxRange: 1000,
};

export function eloRange(t: QueueTiming, searchingMs: number): number {
  const steps = Math.floor(Math.max(0, searchingMs) / t.widenEveryMs);
  return Math.min(t.maxRange, t.baseRange + steps * t.widenBy);
}

/** Shortest v2 tick V2_TICK_MS may ask for (the smoke and e2e run fast matches). */
export const V2_TICK_MS_MIN = 50;

/** V2_TICK_MS: whole milliseconds, at least V2_TICK_MS_MIN; unset or blank means the engine's TICK_MS (2 s). */
export function parseV2TickMs(value: string | undefined): number {
  const raw = value?.trim();
  if (!raw) return TICK_MS;
  const ms = Number(raw);
  if (!Number.isInteger(ms)) throw new Error(`V2_TICK_MS must be a whole number of milliseconds, got ${JSON.stringify(raw).slice(0, 40)}`);
  return Math.max(V2_TICK_MS_MIN, ms);
}
