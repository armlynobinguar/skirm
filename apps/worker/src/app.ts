// Wiring: real adapters from the environment, and the BullMQ consumers over the testable core.
import { createDb, createRepos, closeDb, type Db } from '@skirm/db';
import { createV2Brain } from '@skirm/decision-engine/v2';
import {
  CostMonitor,
  QUEUE_BENCHMARKS,
  QUEUE_RANKED,
  QUEUE_REGISTRY,
  QUEUE_SEASONS,
  QUEUE_TOURNAMENTS,
  RedisCostStore,
  createNearAdapters,
  createQueue,
  createRedis,
  createVault,
  createWorker,
  enqueueBenchmark,
  enqueueRegistry,
  scheduleRankedDecay,
  scheduleSeasonTick,
  scheduleTournamentTick,
  type ServerConfig,
} from '@skirm/server';
import { processBenchmark } from './benchmark-processor';
import {
  errorCode,
  jsonLogger,
  systemClock,
  type BenchmarkQueue,
  type Logger,
  type RegistryQueue,
  type WorkerDeps,
} from './deps';
import { decayConfigFrom, processRankedDecay, type DecayConfig } from './ranked-processor';
import { processRegistry } from './registry-processor';
import { processSeasonTick } from './season-processor';
import { seedOfficialSkills } from './seed';
import { processTournamentTick } from './tournament-processor';

type Redis = ReturnType<typeof createRedis>;

export function bullRegistryQueue(
  queue: ReturnType<typeof createQueue<'registry'>>,
): RegistryQueue {
  return { enqueue: (data) => enqueueRegistry(queue, data) };
}

export function bullBenchmarkQueue(
  queue: ReturnType<typeof createQueue<'benchmarks'>>,
): BenchmarkQueue {
  return { enqueue: (data) => enqueueBenchmark(queue, data) };
}

/** Daily model spend across instances (Redis) → `cost_alert` at 50/80/100% of the budget. */
export function costMonitor(redis: Redis, dailyBudgetUsd: number, logger: Logger): CostMonitor {
  return new CostMonitor({
    store: new RedisCostStore(redis),
    dailyBudgetUsd,
    onAlert: (a) => {
      const fields = { day: a.day, level: a.level, spentUsd: a.spentUsd, budgetUsd: a.budgetUsd };
      if (a.level >= 1) logger.error('cost_alert', fields);
      else logger.warn('cost_alert', fields);
    },
  });
}

/** Starts the `registry`, `benchmarks`, `seasons`, `ranked` and `tournaments` consumers over `deps`. */
export function startConsumers(
  deps: WorkerDeps,
  connection: Redis,
  opts: {
    registryConcurrency?: number;
    benchmarksConcurrency?: number;
    /** The Elo decay's days and amount (RANKED_DECAY_DAYS / RANKED_DECAY_AMOUNT). */
    decay?: DecayConfig;
  } = {},
) {
  const registry = createWorker(
    QUEUE_REGISTRY,
    (job) =>
      processRegistry(deps, job.data, {
        attemptsMade: job.attemptsMade,
        attempts: job.opts.attempts ?? 1,
      }),
    connection,
    { ...(opts.registryConcurrency ? { concurrency: opts.registryConcurrency } : {}) },
  );
  const benchmarks = createWorker(
    QUEUE_BENCHMARKS,
    (job) =>
      processBenchmark(deps, job.data, {
        attemptsMade: job.attemptsMade,
        attempts: job.opts.attempts ?? 1,
      }),
    connection,
    { ...(opts.benchmarksConcurrency ? { concurrency: opts.benchmarksConcurrency } : {}) },
  );
  const seasons = createWorker(QUEUE_SEASONS, () => processSeasonTick(deps), connection);
  const tournaments = createWorker(QUEUE_TOURNAMENTS, () => processTournamentTick(deps), connection);
  const ranked = createWorker(QUEUE_RANKED, () => processRankedDecay(deps, opts.decay), connection);
  for (const [name, w] of [
    ['registry', registry],
    ['benchmarks', benchmarks],
    ['seasons', seasons],
    ['tournaments', tournaments],
    ['ranked', ranked],
  ] as const) {
    w.on('failed', (job, err) =>
      deps.logger.warn('job failed', { queue: name, jobId: job?.id, code: errorCode(err) }),
    );
    w.on('error', (err) =>
      deps.logger.error('consumer error', { queue: name, code: errorCode(err) }),
    );
  }
  return { registry, benchmarks, seasons, ranked, tournaments };
}

export interface WorkerApp {
  deps: WorkerDeps;
  /** Stops taking jobs, waits up to `graceMs` for active ones, then closes every connection. */
  close(graceMs?: number): Promise<void>;
}

/** Builds the worker from config and env and starts consuming. Checks Postgres and Redis first. */
export async function startWorkerApp(
  config: ServerConfig,
  env: Record<string, string | undefined>,
  logger: Logger = jsonLogger,
): Promise<WorkerApp> {
  const db: Db = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  const consumerConn = createRedis(config.REDIS_URL);
  const registryQueue = createQueue(QUEUE_REGISTRY, redis);
  const benchmarkQueue = createQueue(QUEUE_BENCHMARKS, redis);
  const seasonQueue = createQueue(QUEUE_SEASONS, redis);
  const rankedQueue = createQueue(QUEUE_RANKED, redis);
  const tournamentQueue = createQueue(QUEUE_TOURNAMENTS, redis);
  const closeAll = async () => {
    await Promise.all(
      [registryQueue, benchmarkQueue, seasonQueue, rankedQueue, tournamentQueue].map((q) => q.close().catch(() => undefined)),
    );
    await Promise.all([
      redis.quit().catch(() => redis.disconnect()),
      consumerConn.quit().catch(() => consumerConn.disconnect()),
    ]);
    await closeDb(db).catch(() => undefined);
  };
  let decay: DecayConfig;
  try {
    decay = decayConfigFrom(env);
    await db.execute('select 1');
    await redis.ping();
  } catch (err) {
    await closeAll();
    throw err;
  }

  const near = createNearAdapters(config);
  const costs = costMonitor(redis, config.COST_ALERT_DAILY_USD, logger);
  const recordCost = (costUsd: number) =>
    void costs
      .record(costUsd)
      .catch((err: unknown) => logger.warn('cost total update failed', { code: errorCode(err) }));
  // Benchmarks and trials: the configured model when a model key is set (unless V2_BRAIN=greedy), else
  // greedy (they need a model).
  const brain = createV2Brain(env, { onUsage: (c) => recordCost(c.costUsd), warn: (m) => logger.warn(m) });

  const vault = createVault(config);
  const deps: WorkerDeps = {
    repos: createRepos(db),
    vault,
    registryQueue: bullRegistryQueue(registryQueue),
    registry: near.registry,
    brain,
    seasons: near.seasons,
    benchmarkQueue: bullBenchmarkQueue(benchmarkQueue),
    ...(env.BENCH_SECRET?.trim() ? { benchSecret: env.BENCH_SECRET.trim() } : {}),
    clock: systemClock,
    logger,
  };
  const consumers = startConsumers(deps, consumerConn, { decay });
  const workers = [consumers.registry, consumers.benchmarks, consumers.seasons, consumers.ranked, consumers.tournaments];
  await Promise.all(workers.map((w) => w.waitUntilReady()));
  // One schedule however many workers start it (an upsert keyed by SEASON_TICK_JOB_ID).
  await scheduleSeasonTick(seasonQueue);
  await scheduleRankedDecay(rankedQueue);
  await scheduleTournamentTick(tournamentQueue);
  if (brain.kind === 'greedy')
    logger.warn(
      'benchmarks and trials need a model key (LLM_API_KEY): they end needs_model',
    );
  logger.info('worker ready', {
    v2Brain: brain.kind,
    v2Model: brain.model,
    registry: near.registry.kind,
    seasons: near.seasons.kind,
    eloDecay: decay,
  });

  // Official starter skills for the market (idempotent, advisory-locked across workers). In the
  // background so a slow seed never delays the consumers; `close` waits for it. SEED_OFFICIAL_SKILLS=0
  // turns it off.
  const seeding =
    env.SEED_OFFICIAL_SKILLS?.trim() === '0'
      ? Promise.resolve()
      : seedOfficialSkills(deps, {
          db,
          sealer: vault,
          minter: near.minter,
          ...(config.NEAR_OPS_ACCOUNT ? { creatorNear: config.NEAR_OPS_ACCOUNT } : {}),
        }).then(
          () => undefined,
          (err: unknown) => logger.error('official seed failed', { code: errorCode(err) }),
        );

  return {
    deps,
    async close(graceMs = 30_000) {
      await seeding;
      const graceful = Promise.all(workers.map((w) => w.close()));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        graceful.then(() => false),
        new Promise<boolean>((r) => (timer = setTimeout(() => r(true), graceMs))),
      ]);
      clearTimeout(timer);
      if (timedOut) {
        // Unfinished jobs stall and BullMQ hands them to the next worker that starts.
        logger.warn('shutdown grace elapsed; forcing close');
        await Promise.all(workers.map((w) => w.close(true)));
      }
      await closeAll();
    },
  };
}
