// Hidden benchmark seeds drawn on chain (Zama FHEVM on Sepolia): the game server's side of
// packages/fhevm BenchmarkSeeds.sol. When a version is benchmarked the worker commits its prompt
// hash, which draws an encrypted 64-bit seed only the operator can decrypt; it user-decrypts the
// seed through the Zama relayer, plays the six matches the seed deals (benchmarkSeedPicks in
// @skirm/shared), posts the results hash and score (which opens the seed for public decryption) and
// submits the KMS-proven seed with finalize. Anyone can then check the benchmark played those seeds.
//
// Trust: the operator can read the seed before the run (it has to, to play the matches), but cannot
// choose it, and cannot redraw it (a version commits once).
//
// Gated by ZAMA_ENABLED. Env: ZAMA_OPERATOR_PRIVATE_KEY (the same operator key settlement uses;
// without it the worker falls back to the keyed-hash seeds), SEPOLIA_RPC_URL,
// ZAMA_BENCHMARK_ADDRESS (default: the BenchmarkSeeds address in packages/fhevm/deployments/
// sepolia.json, via @skirm/fhevm/generated), ZAMA_RELAYER_URL (default: the SDK's Sepolia relayer).
// The key is never logged.
import { BenchmarkSeedsAbi, sepolia } from '@skirm/fhevm/generated';
import { benchmarkSeedStatus, type BenchmarkSeedStatus } from '@skirm/shared';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { OPERATOR_KEY_RE } from './settlement';
import { zamaServerConfig, type ZamaServerConfig } from './sealed-match';

/** BenchmarkSeeds.getBenchmark plus the seed handle, as the server uses it. */
export interface ChainBenchmark {
  status: BenchmarkSeedStatus;
  promptHash: string;
  /** bytes32 seed ciphertext handle (zero before commit). */
  seedHandle: string;
  forced: boolean;
  scoreBps: number;
  resultsHash: string;
  /** Decimal uint64 once revealed, else null. */
  seed: string | null;
}

/** The BenchmarkSeeds calls the worker makes as the operator (an interface, so tests fake it). */
export interface BenchmarkSeeder {
  /** The contract address (lower-case). */
  readonly address: string;
  read(skillRef: string): Promise<ChainBenchmark>;
  /** Sends commit and waits for it; returns the tx hash. */
  commit(skillRef: string, promptHash: string): Promise<string>;
  /** User-decrypts the sealed seed as the operator (throws while the relayer is not ready yet). */
  decryptSeed(seedHandle: string): Promise<bigint>;
  /** Sends publish and waits for it; returns the tx hash. */
  publish(skillRef: string, resultsHash: string, scoreBps: number): Promise<string>;
  /** Public-decrypts the opened seed and sends finalize with the KMS proof; returns the tx hash and seed. */
  finalize(skillRef: string, seedHandle: string): Promise<{ txHash: string; seed: bigint }>;
}

/** getBenchmark's tuple and the handle as ChainBenchmark (exported for tests). */
export function parseChainBenchmark(
  b: { promptHash: string; status: bigint; forced: boolean; scoreBps: bigint; resultsHash: string; seed: bigint },
  seedHandle: string,
): ChainBenchmark {
  const status = benchmarkSeedStatus(b.status);
  return {
    status,
    promptHash: String(b.promptHash).toLowerCase(),
    seedHandle: String(seedHandle).toLowerCase(),
    forced: !!b.forced,
    scoreBps: Number(b.scoreBps),
    resultsHash: String(b.resultsHash).toLowerCase(),
    seed: status === 'revealed' ? BigInt(b.seed).toString() : null,
  };
}

/** A prompt sha256 (hex, 0x optional) as the bytes32 commit takes; throws on anything else. */
export function promptHashBytes32(sha256Hex: string): string {
  const hex = sha256Hex.startsWith('0x') ? sha256Hex.slice(2) : sha256Hex;
  if (!/^[0-9a-fA-F]{64}$/.test(hex) || /^0+$/.test(hex)) throw new Error('prompt hash must be 32 nonzero bytes of hex');
  return `0x${hex.toLowerCase()}`;
}

/** The relayer SDK surface the seeder uses (the node build's FhevmInstance). */
export interface RelayerInstance {
  generateKeypair(): { publicKey: string; privateKey: string };
  createEIP712(
    publicKey: string,
    contractAddresses: string[],
    startTimestamp: number,
    durationDays: number,
  ): { domain: unknown; types: { UserDecryptRequestVerification: readonly unknown[] }; message: unknown };
  userDecrypt(
    handles: { handle: string; contractAddress: string }[],
    privateKey: string,
    publicKey: string,
    signature: string,
    contractAddresses: string[],
    userAddress: string,
    startTimestamp: number,
    durationDays: number,
  ): Promise<Record<string, bigint | boolean | string>>;
  publicDecrypt(handles: string[]): Promise<{
    clearValues: Record<string, bigint | boolean | string>;
    abiEncodedClearValues: string;
    decryptionProof: string;
  }>;
}

/** The SDK keys results by handle hex; match case-insensitively. */
function clearValue(values: Record<string, bigint | boolean | string>, handle: string): bigint {
  const lower = handle.toLowerCase();
  for (const [k, v] of Object.entries(values)) if (k.toLowerCase() === lower) return BigInt(v as bigint);
  throw new Error('the relayer returned no value for the seed handle');
}

type Tx = { hash: string; wait(): Promise<unknown> };

/** The contract calls the seeder needs (an ethers Contract bound to the operator wallet, or a fake). */
export interface SeedsContract {
  getBenchmark(skillRef: string): Promise<{ promptHash: string; status: bigint; forced: boolean; scoreBps: bigint; resultsHash: string; seed: bigint }>;
  seedHandle(skillRef: string): Promise<string>;
  commit(skillRef: string, promptHash: string): Promise<Tx>;
  publish(skillRef: string, resultsHash: string, scoreBps: number): Promise<Tx>;
  finalize(skillRef: string, clear: string, proof: string): Promise<Tx>;
}

/** The operator signer: its address and EIP-712 signing. */
export interface OperatorSigner {
  readonly address: string;
  signTypedData(domain: Record<string, unknown>, types: Record<string, unknown[]>, message: Record<string, unknown>): Promise<string>;
}

/** BenchmarkSeeds as the operator: ethers for transactions, the relayer for decryption. */
export class ContractBenchmarkSeeder implements BenchmarkSeeder {
  readonly address: string;

  constructor(
    address: string,
    private readonly contract: SeedsContract,
    private readonly signer: OperatorSigner,
    private readonly relayer: () => Promise<RelayerInstance>,
  ) {
    this.address = address.toLowerCase();
  }

  async read(skillRef: string): Promise<ChainBenchmark> {
    const [b, handle] = await Promise.all([this.contract.getBenchmark(skillRef), this.contract.seedHandle(skillRef)]);
    return parseChainBenchmark(b, handle);
  }

  async commit(skillRef: string, promptHash: string): Promise<string> {
    const tx = await this.contract.commit(skillRef, promptHashBytes32(promptHash));
    await tx.wait();
    return tx.hash;
  }

  async decryptSeed(seedHandle: string): Promise<bigint> {
    const sdk = await this.relayer();
    const { publicKey, privateKey } = sdk.generateKeypair();
    const start = Math.floor(Date.now() / 1000);
    const contracts = [this.address];
    const eip712 = sdk.createEIP712(publicKey, contracts, start, 1);
    const signature = await this.signer.signTypedData(
      eip712.domain as Record<string, unknown>,
      { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
      eip712.message as Record<string, unknown>,
    );
    const clear = await sdk.userDecrypt(
      [{ handle: seedHandle, contractAddress: this.address }],
      privateKey,
      publicKey,
      signature.replace(/^0x/, ''),
      contracts,
      this.signer.address,
      start,
      1,
    );
    return clearValue(clear, seedHandle);
  }

  async publish(skillRef: string, resultsHash: string, scoreBps: number): Promise<string> {
    const tx = await this.contract.publish(skillRef, resultsHash, scoreBps);
    await tx.wait();
    return tx.hash;
  }

  async finalize(skillRef: string, seedHandle: string): Promise<{ txHash: string; seed: bigint }> {
    const sdk = await this.relayer();
    const res = await sdk.publicDecrypt([seedHandle]);
    const tx = await this.contract.finalize(skillRef, res.abiEncodedClearValues, res.decryptionProof);
    await tx.wait();
    return { txHash: tx.hash, seed: clearValue(res.clearValues, seedHandle) };
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** ZAMA_BENCHMARK_ADDRESS, else the deployments file; null when not deployed. */
export function benchmarkSeedsAddress(env: Record<string, string | undefined> = process.env): string | null {
  const override = env.ZAMA_BENCHMARK_ADDRESS?.trim();
  return override && ADDRESS_RE.test(override) ? override : sepolia.contracts.BenchmarkSeeds;
}

/**
 * The relayer SDK's node build, created once per process. Imported lazily so nothing loads its WASM
 * unless benchmark seeds are on (it stays external in the worker bundle: see apps/worker/tsup.config.ts).
 */
export function nodeRelayer(rpcUrl: string, relayerUrl?: string): () => Promise<RelayerInstance> {
  let instance: Promise<RelayerInstance> | null = null;
  return () => {
    instance ??= import('@zama-fhe/relayer-sdk/node')
      .then(({ createInstance, SepoliaConfig }) =>
        createInstance({ ...SepoliaConfig, network: rpcUrl, ...(relayerUrl ? { relayerUrl } : {}) }),
      )
      .then((i) => i as unknown as RelayerInstance)
      .catch((err: unknown) => {
        instance = null;
        throw err;
      });
    return instance;
  };
}

interface SeederLog {
  warn(msg: string): void;
}

/**
 * The seeder when ZAMA_ENABLED is on, BenchmarkSeeds is deployed and ZAMA_OPERATOR_PRIVATE_KEY holds
 * a key; else null, and the worker keeps the keyed-hash seeds (a missing or malformed key logs a
 * warning, never the key itself).
 */
export function createBenchmarkSeeder(
  env: Record<string, string | undefined> = process.env,
  log: SeederLog = console,
  cfg: ZamaServerConfig = zamaServerConfig(env),
): BenchmarkSeeder | null {
  const address = benchmarkSeedsAddress(env);
  if (!cfg.enabled || !address) return null;
  const key = env.ZAMA_OPERATOR_PRIVATE_KEY?.trim();
  if (!key || !OPERATOR_KEY_RE.test(key)) {
    log.warn(
      key
        ? 'zama: ZAMA_OPERATOR_PRIVATE_KEY is not a 32-byte hex key, benchmark seeds use the keyed hash'
        : 'zama: ZAMA_OPERATOR_PRIVATE_KEY is not set, benchmark seeds use the keyed hash',
    );
    return null;
  }
  const wallet = new Wallet(key.startsWith('0x') ? key : `0x${key}`, new JsonRpcProvider(cfg.rpcUrl, sepolia.chainId, { staticNetwork: true }));
  const c = new Contract(address, BenchmarkSeedsAbi, wallet);
  const fn = (name: string) => c.getFunction(name);
  const contract: SeedsContract = {
    getBenchmark: (ref) => fn('getBenchmark')(ref) as ReturnType<SeedsContract['getBenchmark']>,
    seedHandle: (ref) => fn('seedHandle')(ref) as Promise<string>,
    commit: (ref, hash) => fn('commit')(ref, hash) as Promise<Tx>,
    publish: (ref, hash, bps) => fn('publish')(ref, hash, bps) as Promise<Tx>,
    finalize: (ref, clear, proof) => fn('finalize')(ref, clear, proof) as Promise<Tx>,
  };
  const signer: OperatorSigner = {
    address: wallet.address,
    signTypedData: (domain, types, message) => wallet.signTypedData(domain, types as never, message),
  };
  return new ContractBenchmarkSeeder(address, contract, signer, nodeRelayer(cfg.rpcUrl, env.ZAMA_RELAYER_URL?.trim() || undefined));
}
