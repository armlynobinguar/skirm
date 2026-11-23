// Hidden benchmark seeds drawn on chain (Zama FHEVM, packages/fhevm BenchmarkSeeds.sol), in plain
// TypeScript: how a revealed 64-bit seed maps to the benchmark's six (map, difficulty) picks, the
// score scale the contract stores, the bytes whose keccak256 is the posted results hash, and the
// checks behind the web's "Verify benchmark". It has no runtime imports (packages/fhevm's Hardhat
// tests load it as CommonJS); keccak256 is taken by the caller (ethers on the server and the web).

/** BenchmarkSeeds.Status, by index. */
export const BENCHMARK_SEED_STATUSES = ['none', 'committed', 'publishing', 'revealed'] as const;
export type BenchmarkSeedStatus = (typeof BENCHMARK_SEED_STATUSES)[number];

/** The contract status name for a numeric status (unknown values read as 'none'). */
export function benchmarkSeedStatus(n: number | bigint): BenchmarkSeedStatus {
  return BENCHMARK_SEED_STATUSES[Number(n)] ?? 'none';
}

/** Matches per benchmark (BenchmarkSeeds.SEED_COUNT). */
export const BENCHMARK_SEED_COUNT = 6;
/** Seed bits per pick (BenchmarkSeeds.SEED_BITS). */
export const BENCHMARK_SEED_BITS = 10;
/** Difficulties a pick draws from, by the value's low bit. */
export const BENCHMARK_SEED_DIFFICULTIES = ['easy', 'normal'] as const;
export type BenchmarkSeedDifficulty = (typeof BENCHMARK_SEED_DIFFICULTIES)[number];
/** The score scale (BenchmarkSeeds.MAX_SCORE_BPS): 10_000 is a score of 1. */
export const BENCHMARK_SCORE_BPS = 10_000;

const MAX_U64 = (1n << 64n) - 1n;

/** The six pick values of a seed: value i is bits [10*i, 10*i + 10) (BenchmarkSeeds.splitSeed). */
export function splitBenchmarkSeed(seed: bigint | string): number[] {
  const s = BigInt(seed);
  if (s < 0n || s > MAX_U64) throw new RangeError('seed must be a uint64');
  const mask = (1n << BigInt(BENCHMARK_SEED_BITS)) - 1n;
  return Array.from({ length: BENCHMARK_SEED_COUNT }, (_, i) => Number((s >> BigInt(BENCHMARK_SEED_BITS * i)) & mask));
}

export interface BenchmarkSeedPick {
  mapId: string;
  difficulty: BenchmarkSeedDifficulty;
  /** Every second match (2nd, 4th, 6th) also feeds the tested agent hijack lines. */
  hijack: boolean;
}

/**
 * The benchmark's picks for a seed, in play order: value v picks map `maps[(v >> 1) % maps.length]`
 * and difficulty `v & 1` (easy, normal). `maps` is the practice map list (PRACTICE_MAPS in
 * @skirm/engine/v2), passed in so this module has no imports.
 */
export function benchmarkSeedPicks(seed: bigint | string, maps: readonly string[]): BenchmarkSeedPick[] {
  if (maps.length === 0) throw new Error('maps is empty');
  return splitBenchmarkSeed(seed).map((v, i) => ({
    mapId: maps[(v >> 1) % maps.length]!,
    difficulty: BENCHMARK_SEED_DIFFICULTIES[v & 1]!,
    hijack: i % 2 === 1,
  }));
}

/** A 0–1 score as the contract's basis points (rounded, clamped). */
export function scoreToBps(score: number | null): number {
  if (score === null || !Number.isFinite(score)) return 0;
  return Math.round(Math.min(1, Math.max(0, score)) * BENCHMARK_SCORE_BPS);
}

/**
 * The bytes whose keccak256 is the results hash the operator posts: the match log head hashes
 * (sha256 hex, 32 bytes each) concatenated in play order, as one 0x hex string. Throws on a hash
 * that is not 32 bytes of hex.
 */
export function resultsHashPreimage(logHashes: readonly string[]): `0x${string}` {
  if (logHashes.length === 0) throw new Error('no match log hashes');
  let out = '0x';
  for (const h of logHashes) {
    const hex = h.startsWith('0x') ? h.slice(2) : h;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`log hash ${h} is not 32 bytes of hex`);
    out += hex.toLowerCase();
  }
  return out as `0x${string}`;
}

/** One played benchmark match, as the Exchange shows it (no text). */
export interface PlayedBenchmarkMatch {
  mapId: string;
  difficulty: string;
  hijack: boolean;
  logHash: string;
}

/** What the chain says about a benchmark, for the verifier. */
export interface ChainBenchmarkRecord {
  status: BenchmarkSeedStatus;
  promptHash: string;
  forced: boolean;
  scoreBps: number;
  resultsHash: string;
  /** Decimal uint64, null before the reveal. */
  seed: string | null;
}

export interface BenchmarkCheck {
  name: 'revealed' | 'prompt' | 'picks' | 'results' | 'score';
  ok: boolean;
  detail: string;
}

/**
 * Checks a revealed benchmark against what was played: the chain seed is revealed (not forced), the
 * prompt hash bound at commit is the version's, the seed maps to exactly the (map, difficulty, hijack)
 * picks that were played, keccak256 of the played log hashes is the posted results hash, and the
 * posted score is the shown one. `keccak` is keccak256 over 0x hex bytes (ethers `keccak256`).
 */
export function verifyBenchmark(input: {
  chain: ChainBenchmarkRecord;
  promptSha256: string | null;
  played: readonly PlayedBenchmarkMatch[];
  score: number | null;
  maps: readonly string[];
  keccak: (hexBytes: `0x${string}`) => string;
}): { ok: boolean; checks: BenchmarkCheck[] } {
  const { chain, played } = input;
  const checks: BenchmarkCheck[] = [];
  const revealed = chain.status === 'revealed' && chain.seed !== null;
  checks.push({
    name: 'revealed',
    ok: revealed && !chain.forced,
    detail: !revealed ? `the seed is ${chain.status} on chain` : chain.forced ? 'the seed was forced open: the operator never posted results' : `seed ${chain.seed}, verified by the KMS proof`,
  });
  const norm = (h: string | null) => (h ?? '').toLowerCase().replace(/^0x/, '');
  if (input.promptSha256 !== null) {
    const ok = norm(chain.promptHash) === norm(input.promptSha256);
    checks.push({ name: 'prompt', ok, detail: ok ? 'committed for this exact prompt' : 'the committed prompt hash is another version’s' });
  }
  if (revealed) {
    const want = benchmarkSeedPicks(chain.seed!, input.maps);
    const same = want.length === played.length && want.every((p, i) => p.mapId === played[i]!.mapId && p.difficulty === played[i]!.difficulty && p.hijack === played[i]!.hijack);
    checks.push({
      name: 'picks',
      ok: same,
      detail: same ? want.map((p) => `${p.mapId}/${p.difficulty}`).join(', ') : `the seed deals ${want.map((p) => `${p.mapId}/${p.difficulty}`).join(', ')}`,
    });
  }
  let resultsOk = false;
  try {
    resultsOk = norm(input.keccak(resultsHashPreimage(played.map((m) => m.logHash)))) === norm(chain.resultsHash);
  } catch {
    resultsOk = false;
  }
  checks.push({ name: 'results', ok: resultsOk, detail: resultsOk ? 'the match logs hash to the posted results' : 'the match logs do not hash to the posted results' });
  const scoreOk = scoreToBps(input.score) === chain.scoreBps;
  checks.push({ name: 'score', ok: scoreOk, detail: `${(chain.scoreBps / 100).toFixed(2)}% posted on chain` });
  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * What the server keeps about a benchmark whose seed was drawn on chain (skill_benchmarks.onchain):
 * where to find it and how far the reveal got. The chain stays the source of truth; the web reads it
 * back to verify.
 */
export interface OnchainBenchmark {
  /** BenchmarkSeeds address (lower-case). */
  contract: string;
  /** keccak256(skillRefPreimage(skillId, version)). */
  skillRef: string;
  /** The prompt hash bound at commit (0x + the version's prompt sha256). */
  promptHash: string;
  /** committed: seed drawn and sealed; published: results posted, seed public; revealed: seed verified on chain. */
  status: 'committed' | 'published' | 'revealed';
  /** keccak256 of the played log hashes, once posted. */
  resultsHash: string | null;
  scoreBps: number | null;
  /** The revealed seed (decimal), once finalized. */
  seed: string | null;
  commitTx: string | null;
  publishTx: string | null;
  finalizeTx: string | null;
}
