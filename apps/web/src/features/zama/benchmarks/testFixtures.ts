// A revealed benchmark whose seed deals exactly the played picks, for the benchmarks tests.
import { PRACTICE_MAPS } from '@skirm/engine/v2';
import { benchmarkSeedPicks, resultsHashPreimage, skillRefPreimage, type ChainBenchmarkRecord } from '@skirm/shared';
import { id, keccak256 } from 'ethers';
import type { BenchmarkOnchainView } from './benchmarks';

const SEED = 0x0fed_cba9_8765_4321n;
const SHA = 'ab'.repeat(32);

/** The api's seed record and the chain's, agreeing. */
export function fixture(): { onchain: BenchmarkOnchainView; chain: ChainBenchmarkRecord } {
  const picks = benchmarkSeedPicks(SEED, PRACTICE_MAPS);
  const played = picks.map((p, i) => ({ ...p, logHash: String(i + 1).repeat(64) }));
  const resultsHash = keccak256(resultsHashPreimage(played.map((m) => m.logHash)));
  return {
    onchain: {
      contract: '0x00000000000000000000000000000000000000bb',
      skillRef: id(skillRefPreimage('skl_x', 2)),
      promptHash: `0x${SHA}`,
      status: 'revealed',
      resultsHash,
      scoreBps: 5000,
      seed: SEED.toString(),
      commitTx: '0xc0',
      publishTx: '0xp0',
      finalizeTx: '0xf0',
      played,
    },
    chain: { status: 'revealed', promptHash: `0x${SHA}`, forced: false, scoreBps: 5000, resultsHash, seed: SEED.toString() },
  };
}
