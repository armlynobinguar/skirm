// Exchange proof for skill versions: the hidden benchmark queue, ranked v2 records per skill
// version (written when a ranked match closes), counter stats, and buyers' trials. Offline (greedy
// brain) benchmarks and trials are `needs_model` with no score: the greedy brain never reads skills.
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import {
  accounts,
  matchSkillStats,
  skillBenchmarks,
  skillTrials,
  type ProofJobStatus,
} from '../schema';
import { RepoError } from '../types';
import { rowsOf, tx } from './util';
import type { V2MatchRow } from './v2-matches';

export type SkillBenchmarkRow = typeof skillBenchmarks.$inferSelect;
export type SkillTrialRow = typeof skillTrials.$inferSelect;

/** Trials per buyer per skill version (needs_model trials are not counted: they played nothing). */
export const TRIAL_LIMIT = 3;
/** Longest error message kept on a failed benchmark. */
const ERROR_MAX = 500;

export interface SkillVersionKey {
  skillId: string;
  version: number;
}

export interface BenchmarkResultInput {
  /** Brain kind that played; `greedy` stores no score. */
  brain: string;
  seeds?: unknown;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  deliveries: number;
  leaks: number;
  manipulations: number;
  score: number | null;
  results?: unknown;
}

export interface RecordTally {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface RankedRecord extends RecordTally {
  perMap: (RecordTally & { mapId: string })[];
}

/** An opponent skill version and how this version fared against crews carrying it. */
export interface CounterRow extends RecordTally {
  skillId: string;
  version: number;
}

export interface MarketRate {
  rankedMatches: number;
  rankedWins: number;
  /** wins / matches; null with no ranked match. */
  rankedWinRate: number | null;
  /** null when not benchmarked, offline (needs_model) or not finished. */
  benchmarkScore: number | null;
  benchmarkStatus: ProofJobStatus | null;
}

export const versionKey = (skillId: string, version: number) => `${skillId}:${version}`;

type SkillRef = { id: string; version: number };

function skillsOf(crew: readonly { skills?: SkillRef[] }[] | undefined): SkillRef[] {
  const seen = new Map<string, SkillRef>();
  for (const a of crew ?? [])
    for (const s of a.skills ?? [])
      seen.set(versionKey(s.id, s.version), { id: s.id, version: s.version });
  return [...seen.values()];
}

const tally = (r: {
  matches: unknown;
  wins: unknown;
  losses: unknown;
  draws: unknown;
}): RecordTally => ({
  matches: Number(r.matches),
  wins: Number(r.wins),
  losses: Number(r.losses),
  draws: Number(r.draws),
});

export class ProofRepo {
  constructor(private readonly db: Executor) {}

  // ---------- Benchmarks ----------

  /** Queues a version's benchmark once; later calls return the existing row whatever its state. */
  async enqueueBenchmark(skillId: string, version: number): Promise<SkillBenchmarkRow> {
    await this.db.insert(skillBenchmarks).values({ skillId, version }).onConflictDoNothing();
    return (await this.benchmark(skillId, version))!;
  }

  /** queued → running for the worker that gets it; undefined when someone else has it or it is done. */
  async claimBenchmark(skillId: string, version: number): Promise<SkillBenchmarkRow | undefined> {
    const [row] = await this.db
      .update(skillBenchmarks)
      .set({ status: 'running' })
      .where(and(this.byVersion(skillId, version), eq(skillBenchmarks.status, 'queued')))
      .returning();
    return row;
  }

  /** Stores a finished gauntlet. A greedy brain never stores a score (it ignores skills). */
  async finishBenchmark(
    skillId: string,
    version: number,
    input: BenchmarkResultInput,
  ): Promise<SkillBenchmarkRow> {
    return this.close(skillId, version, {
      status: 'done',
      brain: input.brain,
      seeds: input.seeds ?? null,
      matches: input.matches,
      wins: input.wins,
      losses: input.losses,
      draws: input.draws,
      deliveries: input.deliveries,
      leaks: input.leaks,
      manipulations: input.manipulations,
      score: input.brain === 'greedy' ? null : input.score,
      results: input.results ?? null,
      error: null,
    });
  }

  /** Offline: no matches are played and no score is stored. */
  async markNeedsModel(
    skillId: string,
    version: number,
    brain = 'greedy',
  ): Promise<SkillBenchmarkRow> {
    return this.close(skillId, version, {
      status: 'needs_model',
      brain,
      matches: 0,
      score: null,
      error: null,
    });
  }

  async failBenchmark(skillId: string, version: number, error: string): Promise<SkillBenchmarkRow> {
    return this.close(skillId, version, { status: 'failed', error: error.slice(0, ERROR_MAX) });
  }

  async benchmark(skillId: string, version: number): Promise<SkillBenchmarkRow | undefined> {
    const [row] = await this.db
      .select()
      .from(skillBenchmarks)
      .where(this.byVersion(skillId, version));
    return row;
  }

  private byVersion(skillId: string, version: number) {
    return and(eq(skillBenchmarks.skillId, skillId), eq(skillBenchmarks.version, version));
  }

  private async close(
    skillId: string,
    version: number,
    set: Partial<typeof skillBenchmarks.$inferInsert>,
  ): Promise<SkillBenchmarkRow> {
    const [row] = await this.db
      .update(skillBenchmarks)
      .set({ ...set, finishedAt: new Date() })
      .where(this.byVersion(skillId, version))
      .returning();
    if (!row) throw new RepoError('not_found', `no benchmark for ${versionKey(skillId, version)}`);
    return row;
  }

  // ---------- Ranked records ----------

  /**
   * One row per (skill version a crew carried, team) of a ranked match that ended with a result,
   * with the other player's Elo before it and the other crew's skills. Called by
   * V2MatchesRepo.finish in its transaction; idempotent per match.
   */
  async recordMatchStats(
    t: Executor,
    match: Pick<
      V2MatchRow,
      'id' | 'mapId' | 'ranked' | 'status' | 'winner' | 'crews' | 'eloDeltas'
    >,
  ): Promise<number> {
    const winner = match.winner;
    if (!match.ranked || match.status !== 'ended' || !match.crews) return 0;
    if (winner !== 'A' && winner !== 'B' && winner !== 'draw') return 0;
    const values: (typeof matchSkillStats.$inferInsert)[] = [];
    for (const team of ['A', 'B'] as const) {
      const other = team === 'A' ? 'B' : 'A';
      const opponentSkills = skillsOf(match.crews[other]);
      const opponentElo = match.eloDeltas?.find((d) => d.team === other)?.before ?? null;
      for (const s of skillsOf(match.crews[team]))
        values.push({
          matchId: match.id,
          skillId: s.id,
          version: s.version,
          mapId: match.mapId,
          team,
          ranked: true,
          outcome: winner === 'draw' ? 'draw' : winner === team ? 'win' : 'loss',
          opponentElo,
          opponentSkills,
        });
    }
    if (!values.length) return 0;
    const inserted = await t
      .insert(matchSkillStats)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: matchSkillStats.id });
    return inserted.length;
  }

  /** A version's ranked v2 record, overall and per map (most played first). */
  async rankedRecord(skillId: string, version: number): Promise<RankedRecord> {
    const rows = await this.db
      .select({
        mapId: matchSkillStats.mapId,
        matches: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${matchSkillStats.outcome} = 'win')::int`,
        losses: sql<number>`count(*) filter (where ${matchSkillStats.outcome} = 'loss')::int`,
        draws: sql<number>`count(*) filter (where ${matchSkillStats.outcome} = 'draw')::int`,
      })
      .from(matchSkillStats)
      .where(
        and(
          eq(matchSkillStats.skillId, skillId),
          eq(matchSkillStats.version, version),
          eq(matchSkillStats.ranked, true),
        ),
      )
      .groupBy(matchSkillStats.mapId);
    const perMap = rows
      .map((r) => ({ mapId: r.mapId, ...tally(r) }))
      .sort((a, b) => b.matches - a.matches || a.mapId.localeCompare(b.mapId));
    const total: RecordTally = { matches: 0, wins: 0, losses: 0, draws: 0 };
    for (const m of perMap) {
      total.matches += m.matches;
      total.wins += m.wins;
      total.losses += m.losses;
      total.draws += m.draws;
    }
    return { ...total, perMap };
  }

  /** The opponent skill versions this version lost to most (top `limit`), with its record against each. */
  async counters(skillId: string, version: number, limit = 10): Promise<CounterRow[]> {
    const res = await this.db.execute(sql`
      select o.value->>'id' as skill_id, (o.value->>'version')::int as version,
        count(*)::int as matches,
        count(*) filter (where s.outcome = 'win')::int as wins,
        count(*) filter (where s.outcome = 'loss')::int as losses,
        count(*) filter (where s.outcome = 'draw')::int as draws
      from ${matchSkillStats} s cross join lateral jsonb_array_elements(s.opponent_skills) o
      where s.skill_id = ${skillId} and s.version = ${version} and s.ranked
      group by 1, 2
      order by losses desc, matches desc, 1, 2
      limit ${limit}`);
    return rowsOf<{
      skill_id: string;
      version: number;
      matches: number;
      wins: number;
      losses: number;
      draws: number;
    }>(res).map((r) => ({ skillId: r.skill_id, version: Number(r.version), ...tally(r) }));
  }

  /**
   * Market card numbers for many versions in ONE grouped query: ranked matches, wins and win rate,
   * and the benchmark score (null when there is none). Keyed by `versionKey`. A version asked for
   * twice (listed by two sellers) is counted once.
   */
  async marketRates(versions: readonly SkillVersionKey[]): Promise<Map<string, MarketRate>> {
    const out = new Map<string, MarketRate>();
    const unique = [
      ...new Map(versions.map((v) => [versionKey(v.skillId, v.version), v])).values(),
    ];
    if (!unique.length) return out;
    const list = sql.join(
      unique.map((v) => sql`(${v.skillId}::text, ${v.version}::int)`),
      sql`, `,
    );
    const res = await this.db.execute(sql`
      with v(skill_id, version) as (values ${list})
      select v.skill_id, v.version,
        count(s.id)::int as matches,
        count(s.id) filter (where s.outcome = 'win')::int as wins,
        b.score, b.status
      from v
      left join ${matchSkillStats} s on s.skill_id = v.skill_id and s.version = v.version and s.ranked
      left join ${skillBenchmarks} b on b.skill_id = v.skill_id and b.version = v.version
      group by v.skill_id, v.version, b.score, b.status`);
    for (const r of rowsOf<{
      skill_id: string;
      version: number;
      matches: number;
      wins: number;
      score: number | string | null;
      status: ProofJobStatus | null;
    }>(res)) {
      const matches = Number(r.matches);
      const wins = Number(r.wins);
      out.set(versionKey(r.skill_id, Number(r.version)), {
        rankedMatches: matches,
        rankedWins: wins,
        rankedWinRate: matches > 0 ? wins / matches : null,
        benchmarkScore: r.status === 'done' && r.score !== null ? Number(r.score) : null,
        benchmarkStatus: r.status ?? null,
      });
    }
    return out;
  }

  // ---------- Trials ----------

  /**
   * Queues a buyer's trial of a version with one of their agents. At most TRIAL_LIMIT per buyer per
   * version, checked under a lock on the buyer's account row so concurrent requests cannot both pass.
   * Trials that ended `needs_model` (offline, nothing played) do not count.
   */
  async createTrial(input: {
    accountId: string;
    skillId: string;
    version: number;
    agentId: string;
  }): Promise<SkillTrialRow> {
    return tx(this.db, async (t) => {
      const [buyer] = await t
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, input.accountId))
        .for('update');
      if (!buyer) throw new RepoError('not_found', 'account not found');
      const [count] = await t
        .select({ n: sql<number>`count(*)::int` })
        .from(skillTrials)
        .where(
          and(
            eq(skillTrials.accountId, input.accountId),
            eq(skillTrials.skillId, input.skillId),
            eq(skillTrials.version, input.version),
            ne(skillTrials.status, 'needs_model'),
          ),
        );
      const used = Number(count?.n ?? 0);
      if (used >= TRIAL_LIMIT)
        throw new RepoError('trial_limit', `at most ${TRIAL_LIMIT} trials per skill version`, {
          limit: TRIAL_LIMIT,
          used,
        });
      const [row] = await t
        .insert(skillTrials)
        .values({ id: newId('trl'), ...input })
        .returning();
      return row!;
    });
  }

  /** queued → running for the worker that gets it. */
  async claimTrial(id: string): Promise<SkillTrialRow | undefined> {
    const [row] = await this.db
      .update(skillTrials)
      .set({ status: 'running' })
      .where(and(eq(skillTrials.id, id), eq(skillTrials.status, 'queued')))
      .returning();
    return row;
  }

  async finishTrial(
    id: string,
    input: {
      status: Extract<ProofJobStatus, 'done' | 'needs_model' | 'failed'>;
      results?: unknown;
    },
  ): Promise<SkillTrialRow> {
    const [row] = await this.db
      .update(skillTrials)
      .set({ status: input.status, results: input.results ?? null, finishedAt: new Date() })
      .where(eq(skillTrials.id, id))
      .returning();
    if (!row) throw new RepoError('not_found', `trial ${id} not found`);
    return row;
  }

  async trial(id: string): Promise<SkillTrialRow | undefined> {
    const [row] = await this.db.select().from(skillTrials).where(eq(skillTrials.id, id));
    return row;
  }

  /** A buyer's trials of a skill (one version, or all), newest first. */
  async trials(accountId: string, skillId: string, version?: number): Promise<SkillTrialRow[]> {
    return this.db
      .select()
      .from(skillTrials)
      .where(
        and(
          eq(skillTrials.accountId, accountId),
          eq(skillTrials.skillId, skillId),
          ...(version !== undefined ? [eq(skillTrials.version, version)] : []),
        ),
      )
      .orderBy(desc(skillTrials.createdAt), desc(skillTrials.id));
  }

  /** Trials that count against the cap (not needs_model). */
  async trialsUsed(accountId: string, skillId: string, version: number): Promise<number> {
    const rows = await this.trials(accountId, skillId, version);
    return rows.filter((r) => r.status !== 'needs_model').length;
  }
}
