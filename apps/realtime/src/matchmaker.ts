// v2 matchmaking: one queue per lane (ranked or casual), Elo range widening with search time. Two
// searches pair when their ratings are within both players' current ranges. The earlier search plays
// side A.
import { eloRange, type QueueTiming, type Scheduler } from './timing';

/** A search queues in one lane; only searches of the same lane pair. */
export type Lane = 'ranked' | 'casual';

export interface QueueEntry<T> {
  /** One search per account. */
  key: string;
  lane: Lane;
  /** Optional finer queue within a lane (v2 casual: map and difficulty); equal pools pair, or as `hooks.pools` says. */
  pool?: string;
  /** The player's Elo. */
  rating: number;
  enqueuedAt: number;
  payload: T;
}

export interface MatchmakerHooks<T> {
  status(entry: QueueEntry<T>, searchingMs: number, range: number): void;
  pair(a: QueueEntry<T>, b: QueueEntry<T>): void;
  /** Whether two pools may pair; default: only equal pools. */
  pools?(a: string | undefined, b: string | undefined): boolean;
}

const samePool = (a?: string, b?: string) => a === b;

export class Matchmaker<T> {
  private readonly entries = new Map<string, QueueEntry<T>>();
  private timer: unknown;
  private running = false;

  constructor(
    private readonly timing: QueueTiming,
    private readonly scheduler: Scheduler,
    private readonly hooks: MatchmakerHooks<T>,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): QueueEntry<T> | undefined {
    return this.entries.get(key);
  }

  rangeOf(e: QueueEntry<T>, now = this.scheduler.now()): number {
    return eloRange(this.timing, now - e.enqueuedAt);
  }

  /** Adds a search, sends its first status and tries to pair it at once. */
  add(entry: Omit<QueueEntry<T>, 'enqueuedAt'>): QueueEntry<T> {
    if (this.entries.has(entry.key)) throw new Error(`already queued: ${entry.key}`);
    const e: QueueEntry<T> = { ...entry, enqueuedAt: this.scheduler.now() };
    this.entries.set(e.key, e);
    this.hooks.status(e, 0, this.rangeOf(e, e.enqueuedAt));
    this.pairAll();
    return e;
  }

  remove(key: string): QueueEntry<T> | undefined {
    const e = this.entries.get(key);
    if (e) this.entries.delete(key);
    return e;
  }

  /** One matchmaking pass: pair what fits, then tell every remaining search where it stands. */
  pass(): void {
    this.pairAll();
    const now = this.scheduler.now();
    for (const e of this.entries.values())
      this.hooks.status(e, now - e.enqueuedAt, this.rangeOf(e, now));
  }

  private pairAll(): void {
    const now = this.scheduler.now();
    const order = [...this.entries.values()].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    const taken = new Set<string>();
    for (const e of order) {
      if (taken.has(e.key)) continue;
      const re = this.rangeOf(e, now);
      let best: QueueEntry<T> | undefined;
      let bestGap = Infinity;
      for (const c of order) {
        if (c === e || taken.has(c.key) || c.lane !== e.lane || !(this.hooks.pools ?? samePool)(c.pool, e.pool)) continue;
        const gap = Math.abs(c.rating - e.rating);
        if (gap > Math.min(re, this.rangeOf(c, now))) continue;
        if (gap < bestGap) {
          best = c;
          bestGap = gap;
        }
      }
      if (!best) continue;
      taken.add(e.key);
      taken.add(best.key);
      this.entries.delete(e.key);
      this.entries.delete(best.key);
      const [a, b] = e.enqueuedAt <= best.enqueuedAt ? [e, best] : [best, e];
      this.hooks.pair(a, b);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      try {
        this.pass();
      } finally {
        this.timer = this.scheduler.setTimeout(loop, this.timing.statusEveryMs);
      }
    };
    this.timer = this.scheduler.setTimeout(loop, this.timing.statusEveryMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }

  clear(): QueueEntry<T>[] {
    const all = [...this.entries.values()];
    this.entries.clear();
    return all;
  }
}
