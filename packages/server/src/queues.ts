// Queue names, job payloads and the /ws message unions (docs/backend-contract.md: Queues,
// WebSocket), plus helpers to build BullMQ queues/workers and Redis clients. The v2_* messages are
// in ./v2; the Redis names for watching a live v2 match from another instance are in ./v2-channels.
//
// Bundling note for apps (tsup, format esm): bullmq (via node-abort-controller), ioredis and pg are
// CommonJS and call require('events') etc. Bundled into ESM they crash at startup with "Dynamic
// require of ... is not supported". Marking only `pg` external is NOT enough. Add this banner:
//   banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
import type { V2ClientMessage, V2ServerMessage } from './v2';
import { Queue, Worker, type JobsOptions, type Processor, type WorkerOptions } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';

// ---------- Names ----------

export const QUEUE_REGISTRY = 'registry' as const;
/** Skill proof: the hidden benchmark at mint and buyers' trials. */
export const QUEUE_BENCHMARKS = 'benchmarks' as const;
/** Season upkeep: lock ended seasons, write payouts, open the next one. */
export const QUEUE_SEASONS = 'seasons' as const;
export const QUEUE_NAMES = {
  registry: QUEUE_REGISTRY,
  benchmarks: QUEUE_BENCHMARKS,
  seasons: QUEUE_SEASONS,
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ---------- Jobs ----------

/** `registry` queue: record_match for a ranked v2 match, retried. */
export interface RegistryJobData {
  kind: 'v2_match';
  id: string;
  /** v2_match: the season the ranked result counted towards (v2_matches.season_id). */
  seasonId?: string | null;
}

/** `benchmarks` queue: a minted version's benchmark, or one buyer's trial (loaded from the DB). */
export type BenchmarkJobData =
  { kind: 'mint'; skillId: string; version: number } | { kind: 'trial'; trialId: string };

/** `seasons` queue: one repeatable tick. */
export interface SeasonJobData {
  kind: 'tick';
}

export interface JobDataByQueue {
  registry: RegistryJobData;
  benchmarks: BenchmarkJobData;
  seasons: SeasonJobData;
}

/** Every queue retries: registry writes, benchmarks and the season tick. */
export const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  registry: {
    attempts: 10,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
  benchmarks: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
  seasons: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 60_000 },
    removeOnComplete: 100,
    removeOnFail: 1000,
  },
};

/** Stable job ids: one job per registry record / per benchmark or trial. */
export const registryJobId = (d: RegistryJobData) => `registry-${d.kind}-${d.id}`;
export const benchmarkJobId = (d: BenchmarkJobData) =>
  d.kind === 'mint' ? `benchmark-${d.skillId}-v${d.version}` : `trial-${d.trialId}`;
/** The season tick's job scheduler id: one schedule however many workers start it. */
export const SEASON_TICK_JOB_ID = 'season-tick';
export const SEASON_TICK_EVERY_MS = 10 * 60_000;

// ---------- WebSocket (apps/realtime, path /ws) ----------

/** What a client may send: sign in, then the v2_* messages. `agentToken`: an external agent's token (`<id>.<secret>`), signing in as its player for casual and practice only. */
export type WsClientMessage = { type: 'auth'; token?: string; devUser?: string; agentToken?: string } | V2ClientMessage;

/** What realtime sends: queue_status while searching, errors, and the v2_* messages. */
export type WsServerMessage =
  | { type: 'queue_status'; searchingMs: number; eloRange: number }
  | { type: 'error'; code: string; message: string }
  | V2ServerMessage;

// ---------- Redis / BullMQ helpers ----------

/** ioredis client for BullMQ and pub/sub (`maxRetriesPerRequest: null` as BullMQ requires). */
export function createRedis(url: string, opts: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    ...opts,
  });
}

export function createQueue<Q extends QueueName>(
  name: Q,
  connection: Redis,
): Queue<JobDataByQueue[Q]> {
  return new Queue<JobDataByQueue[Q]>(name, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS[name],
  });
}

export function createWorker<Q extends QueueName, R = unknown>(
  name: Q,
  processor: Processor<JobDataByQueue[Q], R>,
  connection: Redis,
  opts: Omit<WorkerOptions, 'connection'> = {},
): Worker<JobDataByQueue[Q], R> {
  return new Worker<JobDataByQueue[Q], R>(name, processor, {
    concurrency: name === 'seasons' ? 1 : 4,
    ...opts,
    connection,
  });
}

export async function enqueueRegistry(
  queue: Queue<RegistryJobData>,
  data: RegistryJobData,
): Promise<void> {
  await queue.add('record_match', data, { jobId: registryJobId(data) });
}

export async function enqueueBenchmark(
  queue: Queue<BenchmarkJobData>,
  data: BenchmarkJobData,
): Promise<void> {
  await queue.add(data.kind === 'mint' ? 'benchmark' : 'trial', data, {
    jobId: benchmarkJobId(data),
  });
}

/** Schedules the season tick every SEASON_TICK_EVERY_MS (an upsert: one schedule per queue). */
export async function scheduleSeasonTick(
  queue: Queue<SeasonJobData>,
  everyMs: number = SEASON_TICK_EVERY_MS,
): Promise<void> {
  await queue.upsertJobScheduler(
    SEASON_TICK_JOB_ID,
    { every: everyMs },
    { name: 'tick', data: { kind: 'tick' } },
  );
}
