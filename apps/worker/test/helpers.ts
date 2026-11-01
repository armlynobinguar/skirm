import { randomBytes } from 'node:crypto';
import { createRepos, type Db, type Repos, type ReposOptions } from '@skirm/db';
import { createTestDb } from '@skirm/db/testing';
import { createGreedyBrain } from '@skirm/decision-engine/v2';
import {
  LocalKeyWrapper,
  NoopRegistry,
  NoopSeasons,
  Vault,
  type BenchmarkJobData,
  type RegistryJobData,
} from '@skirm/server';
import type { BenchmarkQueue, Clock, Logger, RegistryQueue, WorkerDeps } from '../src/deps';

export class FakeRegistryQueue implements RegistryQueue {
  readonly jobs: RegistryJobData[] = [];
  async enqueue(data: RegistryJobData): Promise<void> {
    this.jobs.push(data);
  }
}

export class FakeBenchmarkQueue implements BenchmarkQueue {
  readonly jobs: BenchmarkJobData[] = [];
  async enqueue(data: BenchmarkJobData): Promise<void> {
    this.jobs.push(data);
  }
}

export const fakeClock = (): Clock & { slept: number[] } => {
  let t = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
  };
};

export const quietLogger = (): Logger & {
  lines: { level: string; msg: string; fields?: unknown }[];
} => {
  const lines: { level: string; msg: string; fields?: unknown }[] = [];
  return {
    lines,
    info: (msg, fields) => lines.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => lines.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => lines.push({ level: 'error', msg, fields }),
  };
};

export interface Ctx {
  db: Db;
  repos: Repos;
  vault: Vault;
  registryQueue: FakeRegistryQueue;
  registry: NoopRegistry;
  seasons: NoopSeasons;
  benchmarkQueue: FakeBenchmarkQueue;
  logger: ReturnType<typeof quietLogger>;
  deps: WorkerDeps;
  cleanup(): Promise<void>;
}

export async function setup(
  overrides: Partial<WorkerDeps> = {},
  reposOpts: ReposOptions = {},
): Promise<Ctx> {
  const db = await createTestDb();
  const repos = createRepos(db, reposOpts);
  const vault = new Vault(new LocalKeyWrapper(new Uint8Array(randomBytes(32))));
  const registryQueue = new FakeRegistryQueue();
  const registry = new NoopRegistry();
  const seasons = new NoopSeasons();
  const benchmarkQueue = new FakeBenchmarkQueue();
  const logger = quietLogger();
  const deps: WorkerDeps = {
    repos,
    vault,
    registryQueue,
    registry,
    brain: createGreedyBrain(),
    seasons,
    benchmarkQueue,
    clock: fakeClock(),
    logger,
    ...overrides,
  };
  return {
    db,
    repos,
    vault,
    registryQueue,
    registry,
    seasons,
    benchmarkQueue,
    logger,
    deps,
    cleanup: async () => undefined,
  };
}
