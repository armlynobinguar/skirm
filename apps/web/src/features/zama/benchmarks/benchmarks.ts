// Hidden benchmark seeds drawn on chain (packages/fhevm BenchmarkSeeds, Sepolia), behind
// NEXT_PUBLIC_ZAMA_ENABLED: the badge's steps and the "Verify benchmark" check.
//
// When a version is minted the game server commits its prompt hash on BenchmarkSeeds, which draws an
// encrypted seed nobody else can read (🎲 drawn on-chain); it stays sealed while the benchmark plays
// (🔒 sealed until run); then the server posts the results hash and score, the seed opens and its
// KMS proof is checked on chain (✅ revealed). Verify reads the record straight from the chain and
// checks, with @skirm/shared verifyBenchmark, that the revealed seed deals exactly the six
// (map, difficulty) picks the Exchange shows were played and that their log hashes hash to the
// posted results. Reads only: no wallet, no relayer.
import { PRACTICE_MAPS } from '@skirm/engine/v2';
import { BenchmarkSeedsAbi } from '@skirm/fhevm/generated';
import {
  benchmarkSeedStatus,
  skillRefPreimage,
  verifyBenchmark,
  type BenchmarkCheck,
  type ChainBenchmarkRecord,
  type OnchainBenchmark,
  type PlayedBenchmarkMatch,
} from '@skirm/shared';
import { Contract, JsonRpcProvider, id as keccakUtf8, keccak256, type ContractRunner } from 'ethers';
import { zamaConfig } from '@/lib/zama/config';

/** The on-chain seed record the api returns with a benchmark. */
export type BenchmarkOnchainView = OnchainBenchmark & { played: PlayedBenchmarkMatch[] };

/** keccak256("skirm-skill:<skillId>:<version>"): the version's key on BenchmarkSeeds. */
export const benchmarkSkillRef = (skillId: string, version: number) => keccakUtf8(skillRefPreimage(skillId, version));

/** Reads BenchmarkSeeds.getBenchmark (an interface, so tests fake the chain). */
export interface BenchmarkSeedsApi {
  read(skillRef: string): Promise<ChainBenchmarkRecord>;
}

/** The public Sepolia RPC from the config (no wallet). */
export const readOnlyRunner = () => new JsonRpcProvider(zamaConfig.rpcUrl, zamaConfig.chainId, { staticNetwork: true });

export function benchmarkSeedsApi(runner: ContractRunner, address: string): BenchmarkSeedsApi {
  const c = new Contract(address, BenchmarkSeedsAbi, runner);
  return {
    async read(skillRef) {
      const b = (await c.getFunction('getBenchmark')(skillRef)) as {
        promptHash: string;
        status: bigint;
        forced: boolean;
        scoreBps: bigint;
        resultsHash: string;
        seed: bigint;
      };
      const status = benchmarkSeedStatus(b.status);
      return {
        status,
        promptHash: b.promptHash,
        forced: b.forced,
        scoreBps: Number(b.scoreBps),
        resultsHash: b.resultsHash,
        seed: status === 'revealed' ? b.seed.toString() : null,
      };
    },
  };
}

/** The contract to verify against: the configured deployment, else the one the api names. */
export function benchmarkContract(onchain: Pick<OnchainBenchmark, 'contract'>): string {
  return zamaConfig.contracts.benchmarks ?? onchain.contract;
}

export interface VerifyResult {
  ok: boolean;
  checks: BenchmarkCheck[];
  chain: ChainBenchmarkRecord;
}

/**
 * Verifies a benchmark against the chain: reads the version's record from BenchmarkSeeds (by the
 * skill reference computed here, not the api's), then runs verifyBenchmark over what the api says
 * was played.
 */
export async function verifyBenchmarkOnChain(
  api: BenchmarkSeedsApi,
  input: { skillId: string; version: number; onchain: BenchmarkOnchainView; promptSha256: string | null; score: number | null },
): Promise<VerifyResult> {
  const chain = await api.read(benchmarkSkillRef(input.skillId, input.version));
  const r = verifyBenchmark({
    chain,
    promptSha256: input.promptSha256,
    played: input.onchain.played,
    score: input.score,
    maps: PRACTICE_MAPS,
    keccak: (hex) => keccak256(hex),
  });
  return { ...r, chain };
}

/** A Sepolia Etherscan link for a transaction, else for the contract. */
export function explorerLink(tx: string | null, contract: string): string {
  return tx ? `${zamaConfig.explorerUrl}/tx/${tx}` : `${zamaConfig.explorerUrl}/address/${contract}`;
}
