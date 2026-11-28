// Confidential spectator predictions (Zama, MatchPredictions on Sepolia): the life of one match's
// market, driven by the match's own clock. The hub calls tick() on every watch-view frame of a PvP
// match and end() once it is over; every chain step runs in the background, one after another per
// match, so the tick loop never waits on Sepolia.
//   first frame          → openMarket (closesAt: the close tick's time plus slack, a backstop only)
//   tick >= close tick   → close, then revealTotals with the KMS proof (the odds go public)
//   end                  → close + reveal if the match ended before the close tick, wait for the
//                          sealed match's settlement, then resolve (a void match resolves as a draw,
//                          which refunds everyone; a sealed match's winner is read from SkirmMatch)
// A step that fails is logged and the market's later steps are skipped: nobody is stuck, since
// anyone can close after closesAt and void a market nobody resolved (voidStale) a day later.
import { PREDICTION_CLOSE_TICK, waitForChain } from '@skirm/shared';
import type { PredictionOperator } from '@skirm/server';
import type { Logger } from '../deps';

/** Seconds past the close tick's expected time the contract's closesAt allows (tx latency). */
export const MARKET_CLOSE_SLACK_S = 120;

interface MarketRun {
  chain: Promise<void>;
  closing: boolean;
  ended: boolean;
  /** A step failed: skip the rest. */
  broken: boolean;
}

export interface MatchMarketsOptions {
  /** The engine tick length, to turn the close tick into closesAt. */
  tickMs: number;
  /** Unix ms (the scheduler's clock). */
  now: () => number;
  closeTick?: number;
}

export class MatchMarkets {
  private readonly runs = new Map<string, MarketRun>();
  private readonly closeTick: number;

  constructor(
    private readonly operator: PredictionOperator,
    private readonly log: Logger,
    private readonly opts: MatchMarketsOptions,
  ) {
    this.closeTick = opts.closeTick ?? PREDICTION_CLOSE_TICK;
  }

  /** A frame of `matchId` at `tick`: opens its market on the first one, closes it at the close tick. */
  tick(matchId: string, tick: number): void {
    let run = this.runs.get(matchId);
    if (!run) {
      run = { chain: Promise.resolve(), closing: false, ended: false, broken: false };
      this.runs.set(matchId, run);
      const left = Math.max(0, this.closeTick - tick);
      const closesAt = Math.floor(this.opts.now() / 1000) + Math.ceil((left * this.opts.tickMs) / 1000) + MARKET_CLOSE_SLACK_S;
      this.step(matchId, run, 'opened', () => this.operator.open(matchId, closesAt));
    }
    if (tick >= this.closeTick) this.closeAndReveal(matchId, run);
  }

  /**
   * The match is over: `winner` null for a draw or a void match. `settled` is the sealed match's
   * on-chain settlement, awaited first (the contract reads the winner from it). Resolves once the
   * market's steps are done (tests and shutdown; the hub does not wait on it).
   */
  end(matchId: string, winner: 'A' | 'B' | null, settled?: Promise<unknown>): Promise<void> {
    const run = this.runs.get(matchId);
    if (!run || run.ended) return run?.chain ?? Promise.resolve();
    run.ended = true;
    this.closeAndReveal(matchId, run);
    if (settled) run.chain = run.chain.then(() => settled.then(() => undefined, () => undefined));
    this.step(matchId, run, `resolved (${winner ?? 'draw'})`, async () => {
      const m = await this.operator.read(matchId);
      if (m.status !== 'revealed') return null;
      return this.operator.resolve(matchId, winner);
    });
    const done = run.chain.finally(() => this.runs.delete(matchId));
    return done;
  }

  /** Every market's pending steps (shutdown). */
  async idle(): Promise<void> {
    await Promise.all([...this.runs.values()].map((r) => r.chain));
  }

  private closeAndReveal(matchId: string, run: MarketRun): void {
    if (run.closing) return;
    run.closing = true;
    this.step(matchId, run, 'closed', () => this.operator.close(matchId));
    this.step(matchId, run, 'totals revealed', async () => {
      // An empty market is void at close: nothing to reveal. Right after the close, a lagging RPC
      // node can still say Open, so wait until it shows the close (Closed, or Void when empty).
      const m = await waitForChain(() => this.operator.read(matchId), (x) => x.status !== 'open', { what: 'the prediction market to close' });
      if (m.status !== 'closed') return null;
      const r = await this.operator.revealTotals(matchId);
      this.log.info(`v2 match ${matchId}: prediction pool A ${r.totalA} / B ${r.totalB} (${m.predictors} sealed predictions)`);
      return r.txHash;
    });
  }

  /** Appends one chain step; `fn` returns the tx hash, or null when there was nothing to send. */
  private step(matchId: string, run: MarketRun, what: string, fn: () => Promise<string | null>): void {
    run.chain = run.chain.then(async () => {
      if (run.broken) return;
      try {
        const hash = await fn();
        if (hash) this.log.info(`v2 match ${matchId}: prediction market ${what} in ${hash}`);
      } catch (err) {
        run.broken = true;
        this.log.warn(`v2 match ${matchId}: prediction market not ${what}: ${(err as Error).message}`);
      }
    });
  }
}
