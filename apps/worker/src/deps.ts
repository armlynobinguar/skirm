// Everything the worker needs from the outside world, injected as one object so tests can swap the
// database, queues, registry, v2 brain, seasons chain and clock (docs/backend-contract.md).
import type { Repos } from '@skirm/db';
import type { V2Brain } from '@skirm/decision-engine/v2';
import type {
  BenchmarkJobData,
  RegistryJobData,
  Registry,
  SeasonsChain,
  Vault,
} from '@skirm/server';

/** The `registry` queue as the worker sees it: one job per record, deduplicated by job id. */
export interface RegistryQueue {
  enqueue(data: RegistryJobData): Promise<void>;
}

/** The `benchmarks` queue: one job per minted version's benchmark or per trial (stable job ids). */
export interface BenchmarkQueue {
  enqueue(data: BenchmarkJobData): Promise<void>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** Structured logs. Fields are codes and ids only: never skill text, plan text or model output. */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface WorkerDeps {
  repos: Repos;
  vault: Pick<Vault, 'decryptSkill'>;
  registryQueue: RegistryQueue;
  registry: Registry;
  /** The v2 brain benchmarks and trials play the tested crew with (greedy: they need a model). */
  brain: V2Brain;
  /** Seasons contract (Noop: everything stays `local`). */
  seasons: SeasonsChain;
  benchmarkQueue: BenchmarkQueue;
  /** HMAC key for the hidden benchmark picks (BENCH_SECRET; default 'skirm-bench'). */
  benchSecret?: string;
  clock: Clock;
  logger: Logger;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** One JSON line per entry on stdout/stderr. */
export const jsonLogger: Logger = {
  // `severity` is what Cloud Logging reads; `level` stays for anything already parsing it.
  info: (msg, fields) => console.log(JSON.stringify({ severity: 'INFO', level: 'info', msg, ...fields })),
  warn: (msg, fields) => console.warn(JSON.stringify({ severity: 'WARNING', level: 'warn', msg, ...fields })),
  error: (msg, fields) => console.error(JSON.stringify({ severity: 'ERROR', level: 'error', msg, ...fields })),
};

/** Error class/code for logs and errorCode; never the message (it could quote provider output). */
export function errorCode(err: unknown): string {
  // Walk wrapped causes (Drizzle wraps driver errors such as ECONNREFUSED).
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[a-z0-9_]{1,40}$/i.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  if (err instanceof Error) return err.name || 'Error';
  return 'Error';
}

/** A failure with a stable code (logged, and stored on a failed benchmark or trial). */
export class WorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}
