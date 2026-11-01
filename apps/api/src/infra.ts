// Production and in-memory implementations of the injected queue and spend reader (deps.ts).
import { costKey, enqueueBenchmark, type BenchmarkJobData } from '@skirm/server';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { BenchmarkQueue, DailyCostReader } from './deps';

/** BullMQ `benchmarks` queue: stable job ids `benchmark-<skill>-v<n>` and `trial-<id>`. */
export class BullBenchmarkQueue implements BenchmarkQueue {
  constructor(private readonly queue: Queue<BenchmarkJobData>) {}
  enqueue(data: BenchmarkJobData): Promise<void> {
    return enqueueBenchmark(this.queue, data);
  }
  async close(): Promise<void> {
    await this.queue.close();
  }
}

/** Records benchmark and trial jobs in memory (tests). */
export class MemoryBenchmarkQueue implements BenchmarkQueue {
  readonly jobs: BenchmarkJobData[] = [];
  fail = false;
  async enqueue(data: BenchmarkJobData): Promise<void> {
    if (this.fail) throw new Error('queue unavailable');
    this.jobs.push(data);
  }
}

/** Reads the per-day spend totals the worker and realtime keep in Redis; null when Redis is slow or down. */
export class RedisDailyCosts implements DailyCostReader {
  constructor(
    private readonly redis: Redis,
    private readonly timeoutMs = 500,
  ) {}

  async usd(days: string[]): Promise<Record<string, number> | null> {
    if (days.length === 0) return {};
    try {
      const vals = await Promise.race([
        this.redis.mget(...days.map(costKey)),
        new Promise<null>((r) => setTimeout(() => r(null), this.timeoutMs).unref()),
      ]);
      if (!vals) return null;
      return Object.fromEntries(days.map((d, i) => [d, Number(vals[i] ?? 0) || 0]));
    } catch {
      return null;
    }
  }
}

export class MemoryDailyCosts implements DailyCostReader {
  readonly totals: Record<string, number> = {};
  async usd(days: string[]): Promise<Record<string, number> | null> {
    return Object.fromEntries(days.map((d) => [d, this.totals[d] ?? 0]));
  }
}
