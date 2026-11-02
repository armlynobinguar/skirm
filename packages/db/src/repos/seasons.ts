// v2 seasons: 14-day windows created lazily, standings from ranked v2 results (win 25, draw 12,
// loss 5), and the locked top 10 with its prizes. The pool is the NEAR funded into the season plus
// 30% of every market fee in its window (labelled `local` until the seasons contract records it).
import { and, asc, desc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import {
  SEASON,
  seasonFeeShare,
  seasonPayouts,
  seasonPoints,
  splitSale,
  type SeasonOutcome,
} from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import { prizePayouts, sales, seasonStandings, seasons, v2Matches } from '../schema';
import { RepoError, type RegistryState } from '../types';
import { rowsOf, tx, type Clock } from './util';
import type { V2MatchRow } from './v2-matches';

export type SeasonRow = typeof seasons.$inferSelect;
export type PrizePayoutRow = typeof prizePayouts.$inferSelect;

export interface SeasonStanding {
  /** 1-based place: points, then wins, then fewer matches, then who got there first. */
  rank: number;
  accountId: string;
  handle: string;
  elo: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
}

export interface LockedSeason {
  season: SeasonRow;
  payouts: PrizePayoutRow[];
  pool: bigint;
  /** What no place took (empty places, rounding dust): carried to the next season. */
  carry: bigint;
}

const DAY_MS = 86_400_000;
/**
 * How long after its end a season can be locked. A ranked finish picks its season by its own clock
 * inside its transaction; locking only once this has passed means no finish can still be adding
 * points to a season whose payouts are being written (nor deadlock with the lock on the FK checks).
 */
export const SEASON_LOCK_GRACE_MS = 60_000;
/** Attempts at opening the current season before settling for the newest one (only a race retries). */
const OPEN_ATTEMPTS = 5;

type StandingSqlRow = {
  rank: number | string;
  account_id: string;
  handle: string;
  elo: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
};

const standingOf = (r: StandingSqlRow): SeasonStanding => ({
  rank: Number(r.rank),
  accountId: r.account_id,
  handle: r.handle,
  elo: Number(r.elo),
  points: Number(r.points),
  wins: Number(r.wins),
  losses: Number(r.losses),
  draws: Number(r.draws),
  matches: Number(r.matches),
});

/** Every standing of a season with its place. */
const rankedCte = (seasonId: string) => sql`
  with ranked as (
    select s.account_id, a.handle, a.elo, s.points, s.wins, s.losses, s.draws, s.matches,
      row_number() over (
        order by s.points desc, s.wins desc, s.matches asc, s.updated_at asc, s.account_id asc
      ) as rank
    from season_standings s join accounts a on a.id = s.account_id
    where s.season_id = ${seasonId}
  )`;

export class SeasonsRepo {
  constructor(
    private readonly db: Executor,
    private readonly clock: Clock = () => Date.now(),
  ) {}

  /** The season `now` falls in, if one is open; unlike ensureCurrent it never opens one (for reads). */
  async current(now: number = this.clock()): Promise<SeasonRow | undefined> {
    const at = new Date(now);
    const [row] = await this.db
      .select()
      .from(seasons)
      .where(and(lte(seasons.startsAt, at), gt(seasons.endsAt, at)))
      .orderBy(desc(seasons.number))
      .limit(1);
    return row;
  }

  /**
   * The season `now` falls in, opening it when there is none: number max+1, from
   * max(previous end, now) for 14 days, so an idle gap never creates seasons that already ended.
   * Race-safe: the insert is ON CONFLICT (number) DO NOTHING and the season is selected again, so a
   * concurrent opener (e.g. two ranked finishes at the boundary) never fails the caller's transaction.
   */
  async ensureCurrent(now: number = this.clock(), t: Executor = this.db): Promise<SeasonRow> {
    const at = new Date(now);
    let last: SeasonRow | undefined;
    for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt++) {
      const [current] = await t
        .select()
        .from(seasons)
        .where(and(lte(seasons.startsAt, at), gt(seasons.endsAt, at)))
        .orderBy(desc(seasons.number))
        .limit(1);
      if (current) return current;
      [last] = await t.select().from(seasons).orderBy(desc(seasons.number)).limit(1);
      // Only a season opened ahead of time (starting after now) can be newer than now.
      if (last && last.startsAt > at) return last;
      const startsAt = last && last.endsAt > at ? last.endsAt : at;
      await t
        .insert(seasons)
        .values({
          id: newId('ssn'),
          number: (last?.number ?? 0) + 1,
          startsAt,
          endsAt: new Date(startsAt.getTime() + SEASON.days * DAY_MS),
        })
        .onConflictDoNothing({ target: seasons.number });
    }
    [last] = await t.select().from(seasons).orderBy(desc(seasons.number)).limit(1);
    return last!;
  }

  /**
   * A ranked result counts towards the current season: stamps the match's season and adds both
   * players' points. Called by V2MatchesRepo.finish in the transaction that closes the match, once
   * (finish returns a closed match untouched). Void and casual matches are ignored.
   */
  async recordRanked(
    t: Executor,
    match: Pick<
      V2MatchRow,
      'id' | 'ranked' | 'status' | 'winner' | 'teamAAccountId' | 'teamBAccountId'
    >,
    now: number = this.clock(),
  ): Promise<SeasonRow | undefined> {
    const winner = match.winner;
    if (
      !match.ranked ||
      match.status !== 'ended' ||
      (winner !== 'A' && winner !== 'B' && winner !== 'draw')
    )
      return undefined;
    const season = await this.ensureCurrent(now, t);
    await t.update(v2Matches).set({ seasonId: season.id }).where(eq(v2Matches.id, match.id));
    for (const [accountId, team] of [
      [match.teamAAccountId, 'A'],
      [match.teamBAccountId, 'B'],
    ] as const) {
      const outcome: SeasonOutcome = winner === 'draw' ? 'draw' : winner === team ? 'win' : 'loss';
      await t
        .insert(seasonStandings)
        .values({
          seasonId: season.id,
          accountId,
          points: seasonPoints(outcome),
          wins: outcome === 'win' ? 1 : 0,
          losses: outcome === 'loss' ? 1 : 0,
          draws: outcome === 'draw' ? 1 : 0,
          matches: 1,
          updatedAt: new Date(now),
        })
        .onConflictDoUpdate({
          target: [seasonStandings.seasonId, seasonStandings.accountId],
          set: {
            points: sql`${seasonStandings.points} + excluded.points`,
            wins: sql`${seasonStandings.wins} + excluded.wins`,
            losses: sql`${seasonStandings.losses} + excluded.losses`,
            draws: sql`${seasonStandings.draws} + excluded.draws`,
            matches: sql`${seasonStandings.matches} + 1`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    return season;
  }

  async get(id: string, t: Executor = this.db): Promise<SeasonRow | undefined> {
    const [row] = await t.select().from(seasons).where(eq(seasons.id, id));
    return row;
  }

  /** Seasons, newest first. */
  async list(limit = 20): Promise<SeasonRow[]> {
    return this.db.select().from(seasons).orderBy(desc(seasons.number)).limit(limit);
  }

  /** Open seasons that ended at least SEASON_LOCK_GRACE_MS ago: the season job locks them. */
  async dueToLock(now: number = this.clock()): Promise<SeasonRow[]> {
    return this.db
      .select()
      .from(seasons)
      .where(
        and(eq(seasons.status, 'open'), lte(seasons.endsAt, new Date(now - SEASON_LOCK_GRACE_MS))),
      )
      .orderBy(asc(seasons.number));
  }

  /** A page of a season's standings, best first, and how many players have one. */
  async standings(
    seasonId: string,
    opts: { limit?: number; offset?: number } = {},
    t: Executor = this.db,
  ): Promise<{ rows: SeasonStanding[]; total: number }> {
    const limit = Math.max(0, Math.min(opts.limit ?? 50, 200));
    const offset = Math.max(0, opts.offset ?? 0);
    const res = await t.execute(sql`${rankedCte(seasonId)}
      select * from ranked order by rank limit ${limit} offset ${offset}`);
    const [count] = await t
      .select({ n: sql<number>`count(*)::int` })
      .from(seasonStandings)
      .where(eq(seasonStandings.seasonId, seasonId));
    return { rows: rowsOf<StandingSqlRow>(res).map(standingOf), total: Number(count?.n ?? 0) };
  }

  /** One player's standing with its place, or undefined before their first ranked result. */
  async rowFor(seasonId: string, accountId: string): Promise<SeasonStanding | undefined> {
    const res = await this.db.execute(sql`${rankedCte(seasonId)}
      select * from ranked where account_id = ${accountId}`);
    const [row] = rowsOf<StandingSqlRow>(res);
    return row ? standingOf(row) : undefined;
  }

  /** funded + 30% of each market fee taken in the season's window (floored per sale, as the market sends it). */
  async pool(seasonId: string, t: Executor = this.db): Promise<bigint> {
    const season = await this.get(seasonId, t);
    if (!season) throw new RepoError('not_found', `season ${seasonId} not found`);
    const rows = await t
      .select({ priceYocto: sales.priceYocto })
      .from(sales)
      .where(and(gte(sales.createdAt, season.startsAt), lt(sales.createdAt, season.endsAt)));
    let pool = BigInt(season.fundedYocto);
    for (const r of rows)
      pool += seasonFeeShare(splitSale(BigInt(r.priceYocto), { primary: true }).fee);
    return pool;
  }

  /**
   * Ends a season: the top 10 and their prizes (seasonPayouts) are written as `local` payouts and
   * the season is locked, SEASON_LOCK_GRACE_MS after its end at the earliest. Idempotent: a locked
   * or paid season returns its payouts as written.
   */
  async lock(seasonId: string, now: number = this.clock()): Promise<LockedSeason> {
    return tx(this.db, async (t) => {
      const [season] = await t.select().from(seasons).where(eq(seasons.id, seasonId)).for('update');
      if (!season) throw new RepoError('not_found', `season ${seasonId} not found`);
      const pool = await this.pool(seasonId, t);
      if (season.status !== 'open') {
        const payouts = await this.payouts(seasonId, t);
        return {
          season,
          payouts,
          pool,
          carry: pool - payouts.reduce((s, p) => s + BigInt(p.amountYocto), 0n),
        };
      }
      if (now < season.endsAt.getTime() + SEASON_LOCK_GRACE_MS)
        throw new RepoError('season_open', `season ${season.number} has not ended`);
      const { rows: top } = await this.standings(seasonId, { limit: SEASON.splitBps.length }, t);
      const { payouts, carry } = seasonPayouts(pool, top);
      const written = payouts.length
        ? await t
            .insert(prizePayouts)
            .values(
              payouts.map((p) => ({
                seasonId,
                rank: p.rank,
                accountId: p.accountId,
                bps: p.bps,
                amountYocto: p.amountYocto.toString(),
              })),
            )
            .returning()
        : [];
      const [locked] = await t
        .update(seasons)
        .set({ status: 'locked' })
        .where(eq(seasons.id, seasonId))
        .returning();
      return { season: locked!, payouts: written.sort((a, b) => a.rank - b.rank), pool, carry };
    });
  }

  /** What the seasons contract said about a locked season; recorded standings make prizes claimable. */
  async setOnchain(seasonId: string, status: RegistryState, txHash?: string | null): Promise<void> {
    await tx(this.db, async (t) => {
      await t
        .update(seasons)
        .set({ onchainStatus: status, ...(txHash !== undefined ? { tx: txHash } : {}) })
        .where(eq(seasons.id, seasonId));
      if (status === 'recorded')
        await t
          .update(prizePayouts)
          .set({ status: 'claimable', ...(txHash !== undefined ? { tx: txHash } : {}) })
          .where(and(eq(prizePayouts.seasonId, seasonId), eq(prizePayouts.status, 'local')));
    });
  }

  /** Closes a locked season; claimable prizes are paid. Local prizes stay local (nothing went onchain). */
  async markPaid(seasonId: string, txHash?: string | null): Promise<void> {
    await tx(this.db, async (t) => {
      await t
        .update(seasons)
        .set({ status: 'paid', ...(txHash !== undefined ? { tx: txHash } : {}) })
        .where(and(eq(seasons.id, seasonId), eq(seasons.status, 'locked')));
      await t
        .update(prizePayouts)
        .set({ status: 'paid' })
        .where(and(eq(prizePayouts.seasonId, seasonId), eq(prizePayouts.status, 'claimable')));
    });
  }

  async payouts(seasonId: string, t: Executor = this.db): Promise<PrizePayoutRow[]> {
    return t
      .select()
      .from(prizePayouts)
      .where(eq(prizePayouts.seasonId, seasonId))
      .orderBy(asc(prizePayouts.rank));
  }

  /** Every prize the account won, yoctoNEAR (earn-back). */
  async prizesFor(accountId: string): Promise<bigint> {
    const rows = await this.db
      .select({ amountYocto: prizePayouts.amountYocto })
      .from(prizePayouts)
      .where(eq(prizePayouts.accountId, accountId));
    return rows.reduce((s, r) => s + BigInt(r.amountYocto), 0n);
  }
}
