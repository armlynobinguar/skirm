// apps/realtime entry: env → deps → Nest application context → WebSocket server on REALTIME_PORT.
// SIGTERM/SIGINT stop matchmaking, void live matches (no Elo, credits returned), close sockets,
// then the db pool and redis connections.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { OfficialRepo, closeDb, createDb, createRepos } from '@skirm/db';
import {
  CostMonitor,
  RedisCostStore,
  RedisExternalTurnStore,
  createQueue,
  createRedis,
  createVault,
  enqueueRegistry,
  installCrashReporting,
  loadConfig,
  reportError,
} from '@skirm/server';
import { RealtimeModule } from './app.module';
import { consoleLogger, type RealtimeDeps } from './deps';
import { RedisPubSub } from './pubsub';
import { parseV2TickMs } from './timing';
import { createRealtimeV2Brain } from './v2/brain';

async function bootstrap(): Promise<void> {
  installCrashReporting('realtime');
  const config = loadConfig(process.env);
  const log = consoleLogger;
  for (const w of config.warnings) log.warn(`WARNING: ${w}`);
  const redis = createRedis(config.REDIS_URL);
  // Daily model spend shared with the worker (Redis) → `cost_alert` at 50/80/100% of the budget.
  const costs = new CostMonitor({
    store: new RedisCostStore(redis),
    dailyBudgetUsd: config.COST_ALERT_DAILY_USD,
    onAlert: (a) =>
      (a.level >= 1 ? log.error : log.warn)(
        `cost_alert ${JSON.stringify({ day: a.day, level: a.level, spentUsd: a.spentUsd, budgetUsd: a.budgetUsd })}`,
      ),
  });
  // v2: the configured model (LLM_*) when a model key is set (V2_BRAIN=greedy forces the
  // offline brain), else the greedy brain; its spend goes to the same CostMonitor.
  const v2Brain = createRealtimeV2Brain(process.env, costs, log);
  log.info(`v2 brain: ${v2Brain.kind} (${v2Brain.model})`);
  if (config.llmModels.length > 1) log.info(`v2 models: ${config.llmModels.map((m) => `${m.id} ${m.rateMultiplierBps}bps`).join(', ')}`);
  // Fail at boot on a bad V2_TICK_MS.
  const v2TickMs = parseV2TickMs(process.env.V2_TICK_MS);
  log.info(`v2 tick: ${v2TickMs} ms`);

  const db = createDb(config.DATABASE_URL);
  // Practice matches name the system account as the bot's side.
  await new OfficialRepo(db).ensureSystem();
  const pubsub = new RedisPubSub(createRedis(config.REDIS_URL), createRedis(config.REDIS_URL));
  const registryQueue = createQueue('registry', redis);

  const deps: RealtimeDeps = {
    config,
    report: (err, where) => reportError('realtime', err, { where }),
    repos: createRepos(db),
    vault: createVault(config),
    pubsub,
    registry: { enqueue: (data) => enqueueRegistry(registryQueue, data) },
    v2Brain,
    v2Models: config.llmModels,
    v2Timing: { tickMs: v2TickMs },
    // Bring your own agent: pull turns go through Redis, so any api instance serves them.
    externalTurns: new RedisExternalTurnStore(redis),
    log,
  };

  const app = await NestFactory.createApplicationContext(
    RealtimeModule.forRoot({
      deps,
      port: config.REALTIME_PORT,
      cleanup: async () => {
        await pubsub.close();
        await registryQueue.close().catch(() => undefined);
        await redis.quit().catch(() => redis.disconnect());
        await closeDb(db);
      },
    }),
    { logger: ['error', 'warn'] },
  );
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  await app.init();
}

// One stray rejected promise must not take the whole process (and every live match on it) down:
// log it in the same structured shape as other errors and keep serving.
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error(JSON.stringify({ severity: 'ERROR', msg: 'unhandled rejection', error: err.message, stack: err.stack }));
});

bootstrap().catch((err: unknown) => {
  console.error(`[realtime] failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
