// Daily challenge attempts: a player's crew against the greedy bot on the UTC day's challenge,
// headless on the worker. Attempts that played (or are about to) are capped per account per day,
// checked under a lock on the account row so concurrent requests cannot both pass. The board is
// each account's best finished attempt of a day.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, dailyAttempts, type DailyAttemptStatus, type DailyCrewRecord } from '../schema';
import { RepoError } from '../types';
import { tx } from './util';

export type DailyAttemptRow = typeof dailyAttempts.$inferSelect;

/** Statuses that use up one of the day's attempts (a failed or unpaid attempt gives it back). */
export const DAILY_COUNTED: readonly DailyAttemptStatus[] = ['queued', 'running', 'done'];
const ERROR_MAX = 200;

export interface CreateDailyAttemptInput {
  accountId: string;
  date: string;
  seed: string;
  mapId: string;
  difficulty: string;
  twist: string;
  crew: DailyCrewRecord[];
  /** Attempts allowed per account per day. */
  limit: number;
  now?: Date;
}

/** One account's best attempt of a day, as the board shows it. */
export interface DailyBoardRow {
  attemptId: string;
  accountId: string;
  handle: string;
  points: number;
  outcome: string;
  ticks: number;
  logHash: string;
  crew: DailyCrewRecord[];
  finishedAt: Date;
}

export class DailyRepo {
  constructor(private readonly db: Executor) {}

  /** Queues an attempt; RepoError `daily_limit` (with `limit`, `used`) past the day's cap. */
  async create(input: CreateDailyAttemptInput): Promise<DailyAttemptRow> {
    const now = input.now ?? new Date();
    return tx(this.db, async (t) => {
      const [acc] = await t.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.accountId)).for('update');
      if (!acc) throw new RepoError('not_found', 'account not found');
      const used = await this.usedOn(input.accountId, input.date, t);
      if (used >= input.limit)
        throw new RepoError('daily_limit', `at most ${input.limit} daily attempts a day`, { limit: input.limit, used });
      const [row] = await t
        .insert(dailyAttempts)
        .values({
          id: newId('dly'),
          accountId: input.accountId,
          date: input.date,
          seed: input.seed,
          mapId: input.mapId,
          difficulty: input.difficulty,
          twist: input.twist,
          crew: input.crew,
          createdAt: now,
        })
        .returning();
      return row!;
    });
  }

  /** Attempts of the day that count towards the cap. */
  async usedOn(accountId: string, date: string, db: Executor = this.db): Promise<number> {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(dailyAttempts)
      .where(
        and(
          eq(dailyAttempts.accountId, accountId),
          eq(dailyAttempts.date, date),
          inArray(dailyAttempts.status, [...DAILY_COUNTED]),
        ),
      );
    return Number(r?.n ?? 0);
  }

  /** queued → running for the worker that gets it. */
  async claim(id: string): Promise<DailyAttemptRow | undefined> {
    const [row] = await this.db
      .update(dailyAttempts)
      .set({ status: 'running' })
      .where(and(eq(dailyAttempts.id, id), eq(dailyAttempts.status, 'queued')))
      .returning();
    return row;
  }

  async finish(
    id: string,
    input: {
      status: Exclude<DailyAttemptStatus, 'queued' | 'running'>;
      brain?: string | null;
      credits?: number;
      points?: number | null;
      outcome?: string | null;
      ticks?: number | null;
      logHash?: string | null;
      result?: unknown;
      error?: string | null;
    },
  ): Promise<DailyAttemptRow> {
    const [row] = await this.db
      .update(dailyAttempts)
      .set({
        status: input.status,
        brain: input.brain ?? null,
        credits: input.credits ?? 0,
        points: input.points ?? null,
        outcome: input.outcome ?? null,
        ticks: input.ticks ?? null,
        logHash: input.logHash ?? null,
        result: input.result ?? null,
        error: input.error ? input.error.slice(0, ERROR_MAX) : null,
        finishedAt: new Date(),
      })
      .where(eq(dailyAttempts.id, id))
      .returning();
    if (!row) throw new RepoError('not_found', `daily attempt ${id} not found`);
    return row;
  }

  async get(id: string): Promise<DailyAttemptRow | undefined> {
    const [row] = await this.db.select().from(dailyAttempts).where(eq(dailyAttempts.id, id));
    return row;
  }

  /** The account's attempts of a day, newest first. */
  async listOn(accountId: string, date: string): Promise<DailyAttemptRow[]> {
    return this.db
      .select()
      .from(dailyAttempts)
      .where(and(eq(dailyAttempts.accountId, accountId), eq(dailyAttempts.date, date)))
      .orderBy(desc(dailyAttempts.createdAt), desc(dailyAttempts.id));
  }

  /**
   * Every account's best finished attempt of the day, in board order (@skirm/engine compareDaily:
   * points, then fewer ticks, then finished first, then id). The caller cuts the top N and finds
   * a rank in it.
   */
  async board(date: string): Promise<DailyBoardRow[]> {
    const rows = await this.db
      .selectDistinctOn([dailyAttempts.accountId], {
        attemptId: dailyAttempts.id,
        accountId: dailyAttempts.accountId,
        handle: accounts.handle,
        points: dailyAttempts.points,
        outcome: dailyAttempts.outcome,
        ticks: dailyAttempts.ticks,
        logHash: dailyAttempts.logHash,
        crew: dailyAttempts.crew,
        finishedAt: dailyAttempts.finishedAt,
      })
      .from(dailyAttempts)
      .innerJoin(accounts, eq(accounts.id, dailyAttempts.accountId))
      // A deleted account leaves the board.
      .where(and(eq(dailyAttempts.date, date), eq(dailyAttempts.status, 'done'), isNull(accounts.deletedAt)))
      .orderBy(
        dailyAttempts.accountId,
        desc(dailyAttempts.points),
        asc(dailyAttempts.ticks),
        asc(dailyAttempts.finishedAt),
        asc(dailyAttempts.id),
      );
    const board = rows.map((r) => ({
      ...r,
      points: r.points ?? 0,
      outcome: r.outcome ?? 'loss',
      ticks: r.ticks ?? 0,
      logHash: r.logHash ?? '',
      finishedAt: new Date(r.finishedAt ?? 0),
    }));
    return board.sort(
      (a, b) =>
        b.points - a.points ||
        a.ticks - b.ticks ||
        a.finishedAt.getTime() - b.finishedAt.getTime() ||
        (a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0),
    );
  }
}
