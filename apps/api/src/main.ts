// api entry: env config, Postgres (migrated), vault, NEAR adapters (Noop without NEAR_OPS_*), the
// BullMQ `benchmarks` queue and the daily spend reader for /ops/stats, then HTTP on API_PORT.
import 'reflect-metadata';
import { closeDb, createDb, createRepos, migrate } from '@skirm/db';
import { rankedDecayFromEnv } from '@skirm/shared';
import {
  ConfigError,
  RedisExternalTurnStore,
  CostMonitor,
  QUEUE_BENCHMARKS,
  RedisCostStore,
  createNearAdapters,
  createQueue,
  createRedis,
  createVault,
  installCrashReporting,
  loadConfig,
} from '@skirm/server';
import { createApp } from './app.module';
import type { ApiDeps } from './deps';
import { BullBenchmarkQueue, RedisDailyCosts } from './infra';
import { RpcNearKeyChecker } from './near-link';
import { RedisRateLimitStore } from './rate-limit';
import { RedisReplayFrames, createApiCaster } from './replays';

async function main(): Promise<void> {
  installCrashReporting('api');
  const config = loadConfig();
  for (const w of config.warnings) console.warn(`[api] WARNING: ${w}`);

  const db = createDb(config.DATABASE_URL);
  await migrate(db);
  const repos = createRepos(db, { ledger: {} });
  const near = createNearAdapters(config);

  const queueRedis = createRedis(config.REDIS_URL);
  // The spend reader answers null when Redis is down, so its client must not queue commands forever.
  const readRedis = createRedis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
  for (const r of [queueRedis, readRedis])
    r.on('error', (err: Error) => console.error(`[api] redis: ${err.message}`));
  const benchmarkQueue = new BullBenchmarkQueue(createQueue(QUEUE_BENCHMARKS, queueRedis));
  const casterCosts = new CostMonitor({
    store: new RedisCostStore(queueRedis),
    dailyBudgetUsd: config.COST_ALERT_DAILY_USD,
    onAlert: (a) =>
      (a.level >= 1 ? console.error : console.warn)(
        `[api] cost_alert ${JSON.stringify({ day: a.day, level: a.level, spentUsd: a.spentUsd, budgetUsd: a.budgetUsd })}`,
      ),
  });

  const deps: ApiDeps = {
    config: {
      ...config,
      V2_BRAIN: process.env.V2_BRAIN,
      rankedDecay: rankedDecayFromEnv(process.env),
      ...(Number(process.env.BENCH_RUNS_PER_HOUR) > 0
        ? { BENCH_RUNS_PER_HOUR: Math.floor(Number(process.env.BENCH_RUNS_PER_HOUR)) }
        : {}),
      ...(Number(process.env.DAILY_ATTEMPTS) > 0
        ? { DAILY_ATTEMPTS: Math.floor(Number(process.env.DAILY_ATTEMPTS)) }
        : {}),
    },
    repos,
    vault: createVault(config),
    near: {
      minter: near.minter,
      deposits: near.deposits,
      rentals: near.rentals,
      ownership: near.ownership,
      badges: near.badges,
      keys: new RpcNearKeyChecker(near.rpc),
    },
    benchmarkQueue,
    costs: new RedisDailyCosts(readRedis),
    // Bring your own agent: pull turns realtime publishes, shared through Redis.
    externalTurns: new RedisExternalTurnStore(queueRedis),
    // Shared replays read realtime's stored frames; the caster's spend joins the daily cost total.
    replayFrames: new RedisReplayFrames(readRedis),
    caster: createApiCaster({ ...config, V2_BRAIN: process.env.V2_BRAIN }, (usd) => {
      void casterCosts.record(usd).catch(() => undefined);
    }),
    rateLimit: {
      store: new RedisRateLimitStore(readRedis),
      limits: {
        ...(process.env.RATE_LIMIT_STRICT ? { strict: Number(process.env.RATE_LIMIT_STRICT) } : {}),
        ...(process.env.RATE_LIMIT_GENERAL ? { general: Number(process.env.RATE_LIMIT_GENERAL) } : {}),
      },
    },
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };

  const app = await createApp(deps, { logger: ['log', 'error', 'warn'] });
  await app.listen(config.API_PORT, '0.0.0.0');
  console.log(
    `[api] listening on :${config.API_PORT} (auth ${config.AUTH_MODE}, near ${near.minter.kind})`,
  );

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[api] ${signal}: shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
      await benchmarkQueue.close();
      await Promise.all(
        [queueRedis, readRedis].map((r) => r.quit().catch(() => r.disconnect())),
      );
      await closeDb(db);
    } catch (err) {
      console.error(`[api] shutdown error: ${err instanceof Error ? err.name : 'Error'}`);
      process.exitCode = 1;
    }
    clearTimeout(force);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) console.error(`[api] ${err.message}`);
  else console.error(`[api] failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
