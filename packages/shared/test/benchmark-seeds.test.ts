import { keccak256 } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_SEED_COUNT,
  benchmarkSeedPicks,
  benchmarkSeedStatus,
  resultsHashPreimage,
  scoreToBps,
  splitBenchmarkSeed,
  verifyBenchmark,
  type ChainBenchmarkRecord,
} from '../src/benchmark-seeds';

const MAPS = ['alpha', 'bravo', 'charlie'];
const keccak = (hex: `0x${string}`) => keccak256(hex);

/** A seed whose six 10-bit values are `values` (value i at bits 10i..10i+9). */
const seedOf = (values: number[]) => values.reduce((s, v, i) => s | (BigInt(v) << BigInt(10 * i)), 0n);

describe('splitBenchmarkSeed', () => {
  it('reads six 10-bit values, lowest bits first', () => {
    expect(splitBenchmarkSeed(seedOf([1, 2, 3, 1023, 0, 512]))).toEqual([1, 2, 3, 1023, 0, 512]);
    expect(splitBenchmarkSeed('0')).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('ignores the top 4 bits and rejects values outside uint64', () => {
    expect(splitBenchmarkSeed((1n << 64n) - 1n)).toEqual(new Array(BENCHMARK_SEED_COUNT).fill(1023));
    expect(() => splitBenchmarkSeed(1n << 64n)).toThrow(RangeError);
    expect(() => splitBenchmarkSeed(-1n)).toThrow(RangeError);
  });
});

describe('benchmarkSeedPicks', () => {
  it('maps value v to maps[(v >> 1) % n] and difficulty v & 1, hijack on odd picks', () => {
    const picks = benchmarkSeedPicks(seedOf([0, 1, 2, 3, 4, 7]), MAPS);
    expect(picks).toEqual([
      { mapId: 'alpha', difficulty: 'easy', hijack: false },
      { mapId: 'alpha', difficulty: 'normal', hijack: true },
      { mapId: 'bravo', difficulty: 'easy', hijack: false },
      { mapId: 'bravo', difficulty: 'normal', hijack: true },
      { mapId: 'charlie', difficulty: 'easy', hijack: false },
      { mapId: 'alpha', difficulty: 'normal', hijack: true },
    ]);
  });

  it('is deterministic and accepts a decimal string', () => {
    const seed = 0x1234_5678_9abc_def0n;
    expect(benchmarkSeedPicks(seed.toString(), MAPS)).toEqual(benchmarkSeedPicks(seed, MAPS));
  });

  it('refuses an empty map list', () => {
    expect(() => benchmarkSeedPicks(1n, [])).toThrow();
  });
});

describe('statuses, score, results hash', () => {
  it('names contract statuses', () => {
    expect(benchmarkSeedStatus(0)).toBe('none');
    expect(benchmarkSeedStatus(3n)).toBe('revealed');
    expect(benchmarkSeedStatus(9)).toBe('none');
  });

  it('rounds and clamps the score to basis points', () => {
    expect(scoreToBps(0.5)).toBe(5000);
    expect(scoreToBps(2 / 3)).toBe(6667);
    expect(scoreToBps(null)).toBe(0);
    expect(scoreToBps(1.5)).toBe(10_000);
  });

  it('concatenates log hashes in order, with or without 0x', () => {
    const a = 'ab'.repeat(32);
    const b = `0x${'CD'.repeat(32)}`;
    expect(resultsHashPreimage([a, b])).toBe(`0x${a}${'cd'.repeat(32)}`);
    expect(() => resultsHashPreimage(['abc'])).toThrow();
    expect(() => resultsHashPreimage([])).toThrow();
  });
});

describe('verifyBenchmark', () => {
  const seed = seedOf([5, 2, 9, 0, 3, 6]);
  const picks = benchmarkSeedPicks(seed, MAPS);
  const logs = picks.map((_, i) => String(i + 1).repeat(64));
  const played = picks.map((p, i) => ({ ...p, logHash: logs[i]! }));
  const chain: ChainBenchmarkRecord = {
    status: 'revealed',
    promptHash: `0x${'aa'.repeat(32)}`,
    forced: false,
    scoreBps: 5000,
    resultsHash: keccak256(resultsHashPreimage(logs)),
    seed: seed.toString(),
  };
  const base = { chain, promptSha256: 'aa'.repeat(32), played, score: 0.5, maps: MAPS, keccak };

  it('passes when the seed deals the played picks and the logs hash to the posted results', () => {
    const r = verifyBenchmark(base);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(['revealed', 'prompt', 'picks', 'results', 'score']);
  });

  it('fails on a swapped match, a changed log, another score or prompt, or a forced reveal', () => {
    const swapped = [played[1]!, played[0]!, ...played.slice(2)];
    expect(verifyBenchmark({ ...base, played: swapped }).ok).toBe(false);
    const changed = played.map((m, i) => (i === 3 ? { ...m, logHash: 'f'.repeat(64) } : m));
    expect(verifyBenchmark({ ...base, played: changed }).checks.find((c) => c.name === 'results')!.ok).toBe(false);
    expect(verifyBenchmark({ ...base, score: 0.6 }).ok).toBe(false);
    expect(verifyBenchmark({ ...base, promptSha256: 'bb'.repeat(32) }).ok).toBe(false);
    expect(verifyBenchmark({ ...base, chain: { ...chain, forced: true } }).ok).toBe(false);
  });

  it('fails before the reveal', () => {
    const r = verifyBenchmark({ ...base, chain: { ...chain, status: 'publishing', seed: null } });
    expect(r.ok).toBe(false);
    expect(r.checks.some((c) => c.name === 'picks')).toBe(false);
  });
});
