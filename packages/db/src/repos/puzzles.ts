// Puzzle mode (@skirm/engine/v2 PUZZLES): runs queued by the api and played headless by the worker,
// and each player's best solve per puzzle. A run is capped per account per rolling hour (checked
// under a lock on the account row, like the bench). Finishing a solved run updates the player's best
// in the same transaction: a lower score replaces it (the run, ticks, medal and log hash with it), a
// tie keeps the earlier one, and every solve counts.
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, puzzleBests, puzzleRuns, type PuzzleRunStatus } from '../schema';
import { RepoError } from '../types';
import { tx } from './util';

export type PuzzleRunRow = typeof puzzleRuns.$inferSelect;
export type PuzzleBestRow = typeof puzzleBests.$inferSelect;
export type PuzzleCrewEntry = PuzzleRunRow['crew'][number];

/** The cap's window. */
export const PUZZLE_WINDOW_MS = 60 * 60_000;
const ERROR_MAX = 200;

/** A solved run's numbers, as the worker records them. */
export interface PuzzleSolve {
  score: number;
  ticks: number;
  medal: string | null;
  logHash: string;
}

export interface PuzzleBoardRow {
  rank: number;
  account: { id: string; handle: string };
  score: number;
  ticks: number;
  medal: string | null;
  logHash: string;
  brain: string;
  achievedAt: Date;
}

export class PuzzlesRepo {
  constructor(private readonly db: Executor) {}

  /** Queues a run; RepoError `puzzle_limit` (with `limit`, `used`, `retryAt`) over the cap. */
  async create(input: { accountId: string; puzzleId: string; crew: PuzzleCrewEntry[]; limit: number; now?: Date }): Promise<PuzzleRunRow> {
    const now = input.now ?? new Date();
    const since = new Date(now.getTime() - PUZZLE_WINDOW_MS);
    return tx(this.db, async (t) => {
      const [acc] = await t.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.accountId)).for('update');
      if (!acc) throw new RepoError('not_found', 'account not found');
      const recent = await t
        .select({ createdAt: puzzleRuns.createdAt })
        .from(puzzleRuns)
        .where(and(eq(puzzleRuns.accountId, input.accountId), gte(puzzleRuns.createdAt, since)))
        .orderBy(puzzleRuns.createdAt);
      if (recent.length >= input.limit) {
        const oldest = recent[recent.length - input.limit]!.createdAt;
        throw new RepoError('puzzle_limit', `at most ${input.limit} puzzle runs an hour`, {
          limit: input.limit,
          used: recent.length,
          retryAt: new Date(new Date(oldest).getTime() + PUZZLE_WINDOW_MS).toISOString(),
        });
      }
      const [row] = await t
        .insert(puzzleRuns)
        .values({ id: newId('pzr'), accountId: input.accountId, puzzleId: input.puzzleId, crew: input.crew, createdAt: now })
        .returning();
      return row!;
    });
  }

  /** Runs the account started in the window ending at `now`. */
  async usedInWindow(accountId: string, now = new Date()): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(puzzleRuns)
      .where(and(eq(puzzleRuns.accountId, accountId), gte(puzzleRuns.createdAt, new Date(now.getTime() - PUZZLE_WINDOW_MS))));
    return Number(r?.n ?? 0);
  }

  /** queued → running for the worker that gets it. */
  async claim(id: string): Promise<PuzzleRunRow | undefined> {
    const [row] = await this.db
      .update(puzzleRuns)
      .set({ status: 'running' })
      .where(and(eq(puzzleRuns.id, id), eq(puzzleRuns.status, 'queued')))
      .returning();
    return row;
  }

  /**
   * Ends a run. With `solve` (a solved run that finished `done`), the account's best for the puzzle
   * is updated in the same transaction, and an object `result` gets `best` (did this run set it).
   * Returns the run and whether it set a new best.
   */
  async finish(
    id: string,
    input: {
      status: Exclude<PuzzleRunStatus, 'queued' | 'running'>;
      brain?: string | null;
      credits?: number;
      result?: unknown;
      error?: string | null;
      solve?: PuzzleSolve;
    },
  ): Promise<{ run: PuzzleRunRow; best: boolean }> {
    return tx(this.db, async (t) => {
      const [cur] = await t.select().from(puzzleRuns).where(eq(puzzleRuns.id, id)).for('update');
      if (!cur) throw new RepoError('not_found', `puzzle run ${id} not found`);
      const now = new Date();
      const s = input.status === 'done' ? input.solve : undefined;
      let best = false;
      if (s) {
        const values = { score: s.score, ticks: s.ticks, medal: s.medal, runId: cur.id, logHash: s.logHash, brain: input.brain ?? 'greedy', achievedAt: now };
        const key = and(eq(puzzleBests.accountId, cur.accountId), eq(puzzleBests.puzzleId, cur.puzzleId));
        const [prev] = await t.select().from(puzzleBests).where(key).for('update');
        if (!prev) await t.insert(puzzleBests).values({ accountId: cur.accountId, puzzleId: cur.puzzleId, ...values });
        else await t.update(puzzleBests).set({ ...(s.score < prev.score ? values : {}), solves: prev.solves + 1 }).where(key);
        best = !prev || s.score < prev.score;
      }
      // An object result says whether the run set the best.
      const r = input.result;
      const result = s && r && typeof r === 'object' && !Array.isArray(r) ? { ...r, best } : (r ?? null);
      const [run] = await t
        .update(puzzleRuns)
        .set({
          status: input.status,
          brain: input.brain ?? null,
          credits: input.credits ?? 0,
          result,
          error: input.error ? input.error.slice(0, ERROR_MAX) : null,
          finishedAt: now,
        })
        .where(eq(puzzleRuns.id, id))
        .returning();
      return { run: run!, best };
    });
  }

  async get(id: string): Promise<PuzzleRunRow | undefined> {
    const [row] = await this.db.select().from(puzzleRuns).where(eq(puzzleRuns.id, id));
    return row;
  }

  /** The account's runs (of one puzzle, or all), newest first. */
  async list(accountId: string, puzzleId?: string, limit = 20): Promise<PuzzleRunRow[]> {
    return this.db
      .select()
      .from(puzzleRuns)
      .where(and(eq(puzzleRuns.accountId, accountId), ...(puzzleId !== undefined ? [eq(puzzleRuns.puzzleId, puzzleId)] : [])))
      .orderBy(desc(puzzleRuns.createdAt), desc(puzzleRuns.id))
      .limit(limit);
  }

  /** The account's best per puzzle. */
  async bests(accountId: string): Promise<PuzzleBestRow[]> {
    return this.db.select().from(puzzleBests).where(eq(puzzleBests.accountId, accountId));
  }

  /** A puzzle's board: best scores, lowest first (earlier breaks a tie; ties share a rank). */
  async leaderboard(puzzleId: string, limit = 50): Promise<PuzzleBoardRow[]> {
    const rows = await this.db
      .select({
        accountId: puzzleBests.accountId,
        handle: accounts.handle,
        score: puzzleBests.score,
        ticks: puzzleBests.ticks,
        medal: puzzleBests.medal,
        logHash: puzzleBests.logHash,
        brain: puzzleBests.brain,
        achievedAt: puzzleBests.achievedAt,
        rank: sql<number>`rank() over (order by ${puzzleBests.score} asc)`,
      })
      .from(puzzleBests)
      .innerJoin(accounts, eq(accounts.id, puzzleBests.accountId))
      .where(and(eq(puzzleBests.puzzleId, puzzleId), sql`${accounts.deletedAt} is null`))
      .orderBy(asc(puzzleBests.score), asc(puzzleBests.achievedAt), asc(puzzleBests.accountId))
      .limit(limit);
    return rows.map((r) => ({
      rank: Number(r.rank),
      account: { id: r.accountId, handle: r.handle },
      score: r.score,
      ticks: r.ticks,
      medal: r.medal,
      logHash: r.logHash,
      brain: r.brain,
      achievedAt: r.achievedAt,
    }));
  }
}
