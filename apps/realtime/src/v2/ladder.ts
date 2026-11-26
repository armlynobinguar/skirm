// Private MMR (Zama, PrivateLadder on Sepolia): the realtime server's side. Two jobs, both off the
// match's hot path:
//   after a ranked match  → when both players linked an EVM address (PUT /zama/evm-link) and joined
//                           the ladder from their wallet, report the result (the contract moves both
//                           encrypted ratings under FHE), reveal each player's new tier with the KMS
//                           proof and cache it on the account (accounts.ladder_tier). A sealed match
//                           waits for its settlement first: the contract reads the winner from it.
//                           The addresses are the ones linked as the players queued, so relinking a
//                           wallet mid-match changes nothing. A failed step is retried.
//   pairing (optional)    → ZAMA_LADDER_MATCHMAKING=1: before two linked, registered ranked searches
//                           pair, ask isCloseMatch and decrypt the one-bit answer as the operator. "Far"
//                           sends both back to searching and keeps that pair apart for a while; no
//                           answer within the timeout (or any error) pairs them anyway, as today.
// The off-chain Elo flow is untouched: this runs beside it, and only when the operator is set.
import type { Repos } from '@skirm/db';
import type { LadderOperator } from '@skirm/server';
import type { Logger } from '../deps';

/** Defaults for the pairing check. */
export const LADDER_CHECK_TIMEOUT_MS = 20_000;
export const LADDER_VETO_MS = 60_000;

export interface LadderSyncOptions {
  /** Ask isCloseMatch before pairing two linked ranked searches (ZAMA_LADDER_MATCHMAKING). */
  matchmaking: boolean;
  /** How long the pairing check may take before the pair goes ahead without it. */
  checkTimeoutMs: number;
  /** How long a pair found "far" is kept apart (afterwards it may pair on Elo alone). */
  vetoMs: number;
  /** Waits before each retry of a failed report (default LADDER_RETRY_MS). */
  retryMs?: readonly number[];
  /** Unix ms (the scheduler's clock). */
  now: () => number;
  /** Timers (the scheduler's), so tests drive the timeout. */
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

/** Waits before each retry of a failed report. */
export const LADDER_RETRY_MS: readonly number[] = [5_000, 30_000];

/** A ranked player and the EVM address linked as they queued. */
export interface LadderEntrant {
  accountId: string;
  address: string | undefined;
}

/** The pairing check's answer: close, far, or no answer in time (pair anyway). */
export type CloseVerdict = 'close' | 'far' | 'unknown';

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class PrivateLadderSync {
  /** Pairs found far apart: pair key → until (unix ms). */
  private readonly vetoes = new Map<string, number>();
  /** Wakes the retries that are waiting (stop). */
  private readonly waiting = new Set<() => void>();
  private stopped = false;

  constructor(
    private readonly operator: LadderOperator,
    private readonly repos: Pick<Repos, 'accounts'>,
    private readonly log: Logger,
    private readonly opts: LadderSyncOptions,
  ) {}

  get matchmaking(): boolean {
    return this.opts.matchmaking;
  }

  /** Whether two searches (by account key) were found far apart recently. */
  vetoed(a: string, b: string): boolean {
    const k = pairKey(a, b);
    const until = this.vetoes.get(k);
    if (until === undefined) return false;
    if (until > this.opts.now()) return true;
    this.vetoes.delete(k);
    return false;
  }

  /**
   * The on-chain pairing check for two linked addresses: 'close' or 'far' from isCloseMatch, 'unknown'
   * when either is not on the ladder, the chain fails or the answer misses the timeout. 'far' vetoes
   * the pair (by account key) for `vetoMs`.
   */
  async check(keys: [string, string], addresses: [string, string]): Promise<CloseVerdict> {
    const [a, b] = addresses;
    const work = (async (): Promise<CloseVerdict> => {
      const [pa, pb] = await Promise.all([this.operator.player(a), this.operator.player(b)]);
      if (!pa.registered || !pb.registered) return 'unknown';
      return (await this.operator.isClose(a, b)) ? 'close' : 'far';
    })();
    let timer: unknown;
    const timeout = new Promise<CloseVerdict>((resolve) => {
      timer = this.opts.setTimeout(() => resolve('unknown'), this.opts.checkTimeoutMs);
    });
    let verdict: CloseVerdict;
    try {
      verdict = await Promise.race([work, timeout]);
    } catch (err) {
      this.log.warn(`private ladder: close-match check failed, pairing on Elo alone: ${(err as Error).message}`);
      verdict = 'unknown';
    } finally {
      this.opts.clearTimeout(timer);
    }
    work.catch(() => undefined);
    if (verdict === 'far') this.vetoes.set(pairKey(keys[0], keys[1]), this.opts.now() + this.opts.vetoMs);
    return verdict;
  }

  /** No more retries (shutdown): a report under way finishes, a waiting one gives up. */
  stop(): void {
    this.stopped = true;
    for (const wake of [...this.waiting]) wake();
  }

  /**
   * Reports a stored ranked match (`winner` null: a draw) between the addresses the players had linked
   * as they queued, and caches both players' revealed tiers. Skipped unless both joined the ladder. A
   * failed step is retried (an already reported match only updates its tiers); never throws (logged).
   */
  async afterMatch(matchId: string, players: Record<'A' | 'B', LadderEntrant>, winner: 'A' | 'B' | null, settled?: Promise<void>): Promise<void> {
    const { log } = this;
    const a = players.A.address;
    const b = players.B.address;
    if (!a || !b || a === b) return;
    await settled?.catch(() => undefined);
    const waits = this.opts.retryMs ?? LADDER_RETRY_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.update(matchId, players, a, b, winner);
        return;
      } catch (err) {
        const last = attempt >= waits.length || this.stopped;
        log.warn(`v2 match ${matchId}: private ladder not updated${last ? '' : ', retrying'}: ${(err as Error).message}`);
        if (last) return;
        await this.sleep(waits[attempt]!);
        if (this.stopped) return;
      }
    }
  }

  private async update(matchId: string, players: Record<'A' | 'B', LadderEntrant>, a: string, b: string, winner: 'A' | 'B' | null): Promise<void> {
    const { log, operator } = this;
    const [pa, pb] = await Promise.all([operator.player(a), operator.player(b)]);
    if (!pa.registered || !pb.registered) return;
    // Anyone may report a settled sealed match, so it can be reported already: the tiers still need caching.
    if (!(await operator.reported(matchId))) {
      const txHash = await operator.report(matchId, a, b, winner);
      log.info(`v2 match ${matchId}: private ladder reported (${winner ?? 'draw'}) in ${txHash}`);
    }
    // One player's failed reveal does not hold up the other's.
    let failed: unknown;
    for (const p of [players.A, players.B]) {
      try {
        await this.cacheTier(p.accountId, p.address!);
      } catch (err) {
        failed = err;
      }
    }
    if (failed) throw failed;
  }

  /** Reveals the address's pending tier, if any, and caches it on the account while it is still linked to it. */
  private async cacheTier(accountId: string, address: string): Promise<void> {
    const p = await this.operator.player(address);
    const tier = p.tierPending ? await this.operator.revealTier(address) : p.tier;
    const row = await this.repos.accounts.get(accountId);
    if (row?.evmAddress === address) await this.repos.accounts.setLadderTier(accountId, tier);
  }

  private sleep(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.waiting.delete(done);
        this.opts.clearTimeout(timer);
        resolve();
      };
      const timer = this.opts.setTimeout(done, ms);
      this.waiting.add(done);
    });
  }
}
