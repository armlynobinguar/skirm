// Sealed supply drops (Zama, SkirmMatch on Sepolia): a sealed match plays with its drop tiles hidden
// on chain. Each drop value is revealed on chain once it is due (revealDrop + finalizeDrop, sent by
// the players' clients); this reads the revealed values and places each drop just before its tick.
//
// The chain is polled without blocking the tick loop, from a few ticks before a drop is due. A drop
// whose value is not in yet waits (the engine lands it on the first tick after it is placed); after
// DROP_GRACE_TICKS it falls back to the value derived from the public seed, so a match never stalls
// on a reveal nobody sent. Every placement goes into the hash-chained log (LogTick.drops).
import { placeSealedDrop, seedDropValue, type LogDrop, type MatchState } from '@skirm/engine/v2';
import type { Logger } from '../deps';

/** Where a sealed match's randomness comes from (the hub wires SkirmMatch through the chain reader). */
export interface ChainRandomSource {
  /** The verified match seed (decimal uint64). */
  seed: string;
  /** Drop `slot`'s revealed value, or null while it is still sealed. */
  dropValue(slot: number): Promise<number | null>;
}

/** Start reading the chain this many ticks before a drop's tick. */
export const DROP_LOOKAHEAD_TICKS = 5;
/** Ticks past its map tick a drop waits for its chain value before the seed stands in. */
export const DROP_GRACE_TICKS = 20;
/** Least time between two chain reads. */
export const DROP_POLL_MS = 3_000;

export class ChainDrops {
  private readonly values = new Map<number, number>();
  private reading = false;
  private lastRead = -Infinity;

  constructor(
    readonly source: ChainRandomSource,
    private readonly now: () => number,
    private readonly log: Logger,
    private readonly label: string,
  ) {}

  /**
   * Places the sealed drops due on tick `next` (their map tick has come) whose value is in, or whose
   * grace ran out (seed fallback). Starts a chain read when a drop is near. Returns what it placed.
   */
  place(s: MatchState, next: number): LogDrop[] {
    const out: LogDrop[] = [];
    const sealed = (s.drops ?? []).flatMap((d, k) => (d.sealed ? [{ k, tick: d.tick }] : []));
    for (const { k, tick } of sealed) {
      if (tick > next) continue;
      let value = this.values.get(k);
      let fromSeed = false;
      if (value === undefined && next >= tick + DROP_GRACE_TICKS) {
        value = seedDropValue(this.source.seed, k);
        fromSeed = true;
        this.log.warn(`${this.label}: supply drop ${k} was not revealed on chain in time; the seed places it`);
      }
      if (value === undefined) continue;
      const d = placeSealedDrop(s, k, value);
      out.push({ slot: k, value, at: d.at, ...(fromSeed ? { fromSeed: true as const } : {}) });
    }
    // The chain reveals drops in slot order: read the first one still sealed once it is near.
    const first = (s.drops ?? []).findIndex((d) => d.sealed);
    if (first >= 0 && !this.values.has(first) && s.drops![first]!.tick <= next + DROP_LOOKAHEAD_TICKS) this.read(first);
    return out;
  }

  private read(slot: number): void {
    const now = this.now();
    if (this.reading || now - this.lastRead < DROP_POLL_MS) return;
    this.reading = true;
    this.lastRead = now;
    this.source
      .dropValue(slot)
      .then((v) => {
        if (v !== null) this.values.set(slot, v);
      })
      .catch((err: unknown) => this.log.warn(`${this.label}: could not read supply drop ${slot}: ${(err as Error).message}`))
      .finally(() => {
        this.reading = false;
      });
  }
}
