// Hidden benchmark seeds drawn on chain (ZAMA_ENABLED, BenchmarkSeeds deployed, operator key set):
// the worker's two steps around the gauntlet a minted version plays.
//
// 1. drawOnchainSeed, before the matches: commits the version's prompt hash on BenchmarkSeeds (which
//    draws an encrypted seed in the same transaction), then user-decrypts the seed as the operator
//    (the coprocessor and the relayer need a few blocks, so it retries) and maps it to the six
//    (map, difficulty) picks with @skirm/shared benchmarkSeedPicks. A retried job finds the commit
//    already on chain and reuses it: a version's seed is drawn once.
// 2. revealOnchainSeed, after the result is stored: posts the results hash (keccak256 of the six
//    match log heads in play order) and the score, which opens the seed for public decryption, then
//    submits the seed's KMS proof with finalize. Each step is recorded in skill_benchmarks.onchain,
//    so a retried job resumes where the last one stopped. If the worker never gets there, anyone can
//    force the reveal on chain once the reveal deadline has passed.
//
// Without a seeder (ZAMA off) the benchmark keeps the keyed-hash picks (benchmarkPicks).
import { PRACTICE_MAPS } from '@skirm/engine/v2';
import {
  auctionSkillRef,
  benchmarkResultsHash,
  promptHashBytes32,
  type BenchmarkSeeder,
  type ChainBenchmark,
} from '@skirm/server';
import { benchmarkSeedPicks, scoreToBps, type BenchmarkSeedPick, type OnchainBenchmark } from '@skirm/shared';
import { WorkerError, errorCode, type WorkerDeps } from './deps';

export type SeedDeps = Pick<WorkerDeps, 'repos' | 'logger' | 'clock'> & { benchmarkSeeder: BenchmarkSeeder };

/** Tries for a relayer step (the seed decrypts once the coprocessor has computed it). */
export const SEED_RELAYER_ATTEMPTS = 10;
/** Wait between relayer tries. */
export const SEED_RELAYER_WAIT_MS = 6_000;

/** `f`, retried with a pause while it throws (the last error is rethrown). */
async function withRetries<T>(deps: Pick<SeedDeps, 'clock' | 'logger'>, step: string, fields: Record<string, unknown>, f: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (err) {
      if (i >= SEED_RELAYER_ATTEMPTS) throw err;
      deps.logger.info('benchmark seed step not ready, retrying', { ...fields, step, attempt: i, code: errorCode(err) });
      await deps.clock.sleep(SEED_RELAYER_WAIT_MS);
    }
  }
}

/**
 * Commits the version (or finds its commit), decrypts the seed as the operator and returns the six
 * picks it deals plus the on-chain record to store with the result.
 */
export async function drawOnchainSeed(
  deps: SeedDeps,
  skillId: string,
  version: number,
  promptSha256: string,
): Promise<{ picks: BenchmarkSeedPick[]; onchain: OnchainBenchmark }> {
  const seeder = deps.benchmarkSeeder;
  const skillRef = auctionSkillRef(skillId, version);
  const promptHash = promptHashBytes32(promptSha256);
  const fields = { skillId, version };
  let b: ChainBenchmark = await seeder.read(skillRef);
  let commitTx: string | null = null;
  if (b.status === 'none') {
    commitTx = await seeder.commit(skillRef, promptHash);
    b = await seeder.read(skillRef);
    deps.logger.info('benchmark seed committed', { ...fields, tx: commitTx });
  }
  if (b.status !== 'committed') throw new WorkerError('seed_already_open', `the benchmark seed is ${b.status} on chain`);
  if (b.promptHash !== promptHash) throw new WorkerError('prompt_hash_mismatch', 'the version was committed with another prompt hash');
  const seed = await withRetries(deps, 'decrypt', fields, () => seeder.decryptSeed(b.seedHandle));
  return {
    picks: benchmarkSeedPicks(seed, PRACTICE_MAPS),
    onchain: {
      contract: seeder.address,
      skillRef,
      promptHash,
      status: 'committed',
      resultsHash: null,
      scoreBps: null,
      seed: null,
      commitTx,
      publishTx: null,
      finalizeTx: null,
    },
  };
}

/**
 * Posts the results and finalizes the seed's reveal, resuming from whatever the chain already has.
 * Stores each step in skill_benchmarks.onchain and returns the last record.
 */
export async function revealOnchainSeed(
  deps: SeedDeps,
  skillId: string,
  version: number,
  start: OnchainBenchmark,
  played: { logHashes: readonly string[]; score: number | null },
): Promise<OnchainBenchmark> {
  const seeder = deps.benchmarkSeeder;
  const fields = { skillId, version };
  let onchain = start;
  const save = async (next: OnchainBenchmark) => {
    onchain = next;
    await deps.repos.proof.setBenchmarkOnchain(skillId, version, next);
  };
  let b = await seeder.read(onchain.skillRef);
  if (b.status === 'committed') {
    const resultsHash = benchmarkResultsHash(played.logHashes);
    const scoreBps = scoreToBps(played.score);
    const publishTx = await seeder.publish(onchain.skillRef, resultsHash, scoreBps);
    await save({ ...onchain, status: 'published', resultsHash, scoreBps, publishTx });
    deps.logger.info('benchmark results posted, seed opened', { ...fields, tx: publishTx });
    b = await seeder.read(onchain.skillRef);
  } else if (b.status === 'none') {
    throw new WorkerError('seed_not_committed', 'the benchmark seed is not on chain');
  }
  if (b.status === 'publishing') {
    if (onchain.status === 'committed') await save({ ...onchain, status: 'published', resultsHash: b.resultsHash, scoreBps: b.scoreBps, forced: b.forced });
    const handle = b.seedHandle;
    const { txHash, seed } = await withRetries(deps, 'finalize', fields, () => seeder.finalize(onchain.skillRef, handle));
    await save({ ...onchain, status: 'revealed', seed: seed.toString(), finalizeTx: txHash });
    deps.logger.info('benchmark seed revealed', { ...fields, tx: txHash });
  } else if (b.status === 'revealed' && onchain.status !== 'revealed') {
    await save({ ...onchain, status: 'revealed', resultsHash: b.resultsHash, scoreBps: b.scoreBps, seed: b.seed, forced: b.forced });
  }
  return onchain;
}
