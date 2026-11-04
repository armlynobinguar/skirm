// Writers' skill test bench: one headless match per run against the greedy bot, on a map and
// difficulty the writer picks. A run plays a version's own prompt or an edited draft sealed on the
// row (never plain text). Runs are capped per account per rolling hour, checked under a lock on the
// account row so concurrent requests cannot both pass.
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, skillBenchRuns, type BenchRunStatus } from '../schema';
import { RepoError, type SealedSkill } from '../types';
import { tx } from './util';

export type SkillBenchRunRow = typeof skillBenchRuns.$inferSelect;

/** The cap's window. */
export const BENCH_WINDOW_MS = 60 * 60_000;
/** Longest error code kept on a failed run. */
const ERROR_MAX = 200;

export interface CreateBenchRunInput {
  accountId: string;
  skillId: string;
  version: number;
  mapId: string;
  difficulty: string;
  /** The edited draft, sealed by the vault; absent: the version's own prompt plays. */
  sealed?: SealedSkill;
  /** Runs allowed per account in BENCH_WINDOW_MS. */
  limit: number;
  now?: Date;
}

export class BenchRepo {
  constructor(private readonly db: Executor) {}

  /** Queues a run; RepoError `bench_limit` (with `limit`, `used`, `retryAt`) over the cap. */
  async create(input: CreateBenchRunInput): Promise<SkillBenchRunRow> {
    const now = input.now ?? new Date();
    const since = new Date(now.getTime() - BENCH_WINDOW_MS);
    return tx(this.db, async (t) => {
      const [acc] = await t
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, input.accountId))
        .for('update');
      if (!acc) throw new RepoError('not_found', 'account not found');
      const recent = await t
        .select({ createdAt: skillBenchRuns.createdAt })
        .from(skillBenchRuns)
        .where(
          and(eq(skillBenchRuns.accountId, input.accountId), gte(skillBenchRuns.createdAt, since)),
        )
        .orderBy(skillBenchRuns.createdAt);
      if (recent.length >= input.limit) {
        const oldest = recent[recent.length - input.limit]!.createdAt;
        throw new RepoError('bench_limit', `at most ${input.limit} bench runs an hour`, {
          limit: input.limit,
          used: recent.length,
          retryAt: new Date(new Date(oldest).getTime() + BENCH_WINDOW_MS).toISOString(),
        });
      }
      const s = input.sealed;
      const [row] = await t
        .insert(skillBenchRuns)
        .values({
          id: newId('bnr'),
          accountId: input.accountId,
          skillId: input.skillId,
          version: input.version,
          mapId: input.mapId,
          difficulty: input.difficulty,
          createdAt: now,
          ...(s
            ? {
                promptSha256: s.promptSha256,
                ciphertext: s.ciphertext,
                iv: s.iv,
                authTag: s.authTag,
                wrappedKey: s.wrappedKey,
                keyId: s.keyId,
              }
            : {}),
        })
        .returning();
      return row!;
    });
  }

  /** Runs the account started in the window ending at `now`. */
  async usedInWindow(accountId: string, now = new Date()): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(skillBenchRuns)
      .where(
        and(
          eq(skillBenchRuns.accountId, accountId),
          gte(skillBenchRuns.createdAt, new Date(now.getTime() - BENCH_WINDOW_MS)),
        ),
      );
    return Number(r?.n ?? 0);
  }

  /** queued → running for the worker that gets it. */
  async claim(id: string): Promise<SkillBenchRunRow | undefined> {
    const [row] = await this.db
      .update(skillBenchRuns)
      .set({ status: 'running' })
      .where(and(eq(skillBenchRuns.id, id), eq(skillBenchRuns.status, 'queued')))
      .returning();
    return row;
  }

  async finish(
    id: string,
    input: {
      status: Exclude<BenchRunStatus, 'queued' | 'running'>;
      brain?: string | null;
      credits?: number;
      result?: unknown;
      error?: string | null;
    },
  ): Promise<SkillBenchRunRow> {
    const [row] = await this.db
      .update(skillBenchRuns)
      .set({
        status: input.status,
        brain: input.brain ?? null,
        credits: input.credits ?? 0,
        result: input.result ?? null,
        error: input.error ? input.error.slice(0, ERROR_MAX) : null,
        finishedAt: new Date(),
      })
      .where(eq(skillBenchRuns.id, id))
      .returning();
    if (!row) throw new RepoError('not_found', `bench run ${id} not found`);
    return row;
  }

  async get(id: string): Promise<SkillBenchRunRow | undefined> {
    const [row] = await this.db.select().from(skillBenchRuns).where(eq(skillBenchRuns.id, id));
    return row;
  }

  /** The edited draft sealed on a run, or undefined when the version's own prompt played. */
  sealedOf(row: SkillBenchRunRow): SealedSkill | undefined {
    if (!row.ciphertext || !row.iv || !row.authTag || !row.wrappedKey || !row.keyId || !row.promptSha256)
      return undefined;
    return {
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
      wrappedKey: row.wrappedKey,
      keyId: row.keyId,
      promptSha256: row.promptSha256,
    };
  }

  /** The account's runs (of one skill, or all), newest first. */
  async list(accountId: string, skillId?: string, limit = 50): Promise<SkillBenchRunRow[]> {
    return this.db
      .select()
      .from(skillBenchRuns)
      .where(
        and(
          eq(skillBenchRuns.accountId, accountId),
          ...(skillId !== undefined ? [eq(skillBenchRuns.skillId, skillId)] : []),
        ),
      )
      .orderBy(desc(skillBenchRuns.createdAt), desc(skillBenchRuns.id))
      .limit(limit);
  }
}
