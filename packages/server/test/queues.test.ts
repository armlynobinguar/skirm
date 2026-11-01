// Unit tests for queue names, job ids and the /ws unions, plus an opt-in Redis round trip:
//   docker run -d --rm -p 56379:6379 redis:7-alpine
//   TEST_REDIS_URL=redis://localhost:56379 npx vitest run test/queues.test.ts
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  SEASON_TICK_EVERY_MS,
  SEASON_TICK_JOB_ID,
  benchmarkJobId,
  createQueue,
  createRedis,
  createWorker,
  enqueueBenchmark,
  enqueueRegistry,
  registryJobId,
  scheduleSeasonTick,
  type BenchmarkJobData,
  type RegistryJobData,
  type V2ClientMessage,
  type V2ServerMessage,
  type WsClientMessage,
  type WsServerMessage,
} from '../src/index';

describe('names (contract)', () => {
  it('queues: registry, benchmarks and seasons only', () => {
    expect(QUEUE_NAMES).toEqual({
      registry: 'registry',
      benchmarks: 'benchmarks',
      seasons: 'seasons',
    });
    expect(Object.keys(DEFAULT_JOB_OPTIONS).sort()).toEqual(['benchmarks', 'registry', 'seasons']);
  });

  it('benchmark, registry and season jobs', () => {
    const mint: BenchmarkJobData = { kind: 'mint', skillId: 'skl_1', version: 2 };
    expect(benchmarkJobId(mint)).toBe('benchmark-skl_1-v2');
    expect(benchmarkJobId({ kind: 'trial', trialId: 'trl_9' })).toBe('trial-trl_9');
    // The season a v2 result counted towards rides along; the job id stays one per match.
    const v2: RegistryJobData = { kind: 'v2_match', id: 'mat_1', seasonId: 'ssn_1' };
    expect(registryJobId(v2)).toBe('registry-v2_match-mat_1');
    expect(SEASON_TICK_JOB_ID).toBe('season-tick');
    expect(SEASON_TICK_EVERY_MS).toBe(600_000);
    for (const name of Object.values(QUEUE_NAMES))
      expect(DEFAULT_JOB_OPTIONS[name].attempts).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_JOB_OPTIONS.registry.attempts).toBe(10);
  });
});

describe('/ws unions', () => {
  it('a client signs in, then speaks v2 only; the server adds queue_status and error', () => {
    expectTypeOf<WsClientMessage['type']>().toEqualTypeOf<'auth' | V2ClientMessage['type']>();
    expectTypeOf<WsServerMessage['type']>().toEqualTypeOf<
      'queue_status' | 'error' | V2ServerMessage['type']
    >();
  });
});

const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!redisUrl)('Redis round trip', () => {
  const closers: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const c of closers.reverse()) await c().catch(() => undefined);
  });

  it('registry jobs go through BullMQ once per id', async () => {
    const conn = createRedis(redisUrl!);
    closers.push(() => conn.quit());
    const registry = createQueue('registry', conn);
    closers.push(() => registry.close());
    await registry.obliterate({ force: true });

    const seen: string[] = [];
    const done = new Promise<void>((resolve) => {
      const w = createWorker(
        'registry',
        async (job) => {
          seen.push(`${job.name}:${job.data.kind}:${job.data.id}`);
          resolve();
        },
        createRedis(redisUrl!),
      );
      closers.push(() => w.close());
    });
    const data: RegistryJobData = { kind: 'v2_match', id: 'mat_9', seasonId: null };
    await enqueueRegistry(registry, data);
    await enqueueRegistry(registry, data); // same job id: deduplicated
    await done;
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toEqual(['record_match:v2_match:mat_9']);
    const job = await registry.getJob(registryJobId(data));
    expect(job?.opts.attempts).toBe(10);
  });

  it('benchmark jobs are deduplicated per version or trial; the season tick is scheduled once', async () => {
    const conn = createRedis(redisUrl!);
    closers.push(() => conn.quit());
    const benchmarks = createQueue('benchmarks', conn);
    const seasons = createQueue('seasons', conn);
    closers.push(
      () => benchmarks.close(),
      () => seasons.close(),
    );
    await benchmarks.obliterate({ force: true });
    await seasons.obliterate({ force: true });

    await enqueueBenchmark(benchmarks, { kind: 'mint', skillId: 'skl_1', version: 1 });
    await enqueueBenchmark(benchmarks, { kind: 'mint', skillId: 'skl_1', version: 1 });
    await enqueueBenchmark(benchmarks, { kind: 'trial', trialId: 'trl_1' });
    expect(await benchmarks.getJobCountByTypes('waiting')).toBe(2);
    const mint = await benchmarks.getJob(
      benchmarkJobId({ kind: 'mint', skillId: 'skl_1', version: 1 }),
    );
    expect(mint?.name).toBe('benchmark');

    await scheduleSeasonTick(seasons);
    await scheduleSeasonTick(seasons);
    const schedulers = await seasons.getJobSchedulers();
    expect(schedulers.map((s) => s.key)).toEqual([SEASON_TICK_JOB_ID]);
  });
});
