import { sepolia } from '@skirm/fhevm/generated';
import { describe, expect, it } from 'vitest';
import {
  ContractBenchmarkSeeder,
  benchmarkSeedsAddress,
  createBenchmarkSeeder,
  parseChainBenchmark,
  promptHashBytes32,
  type RelayerInstance,
  type SeedsContract,
} from '../src/zama/benchmark-seeds';

const ADDRESS = '0x00000000000000000000000000000000000000BB';
const REF = `0x${'1'.repeat(64)}`;
const HANDLE = `0x${'aB'.repeat(32)}`;
const SHA = 'cd'.repeat(32);
const OPERATOR = '0x00000000000000000000000000000000000000Ee';

function fakes() {
  const calls: string[][] = [];
  const tx = (name: string) => ({ hash: `0x${name}`, wait: async () => undefined });
  const contract: SeedsContract = {
    async getBenchmark() {
      return { promptHash: `0x${SHA}`, status: 3n, forced: false, scoreBps: 5000n, resultsHash: `0x${'EE'.repeat(32)}`, seed: 42n };
    },
    async seedHandle() {
      return HANDLE;
    },
    async commit(ref, hash) {
      calls.push(['commit', ref, hash]);
      return tx('c0');
    },
    async publish(ref, hash, bps) {
      calls.push(['publish', ref, hash, String(bps)]);
      return tx('p0');
    },
    async finalize(ref, clear, proof) {
      calls.push(['finalize', ref, clear, proof]);
      return tx('f0');
    },
  };
  const relayer: RelayerInstance = {
    generateKeypair: () => ({ publicKey: 'pub', privateKey: 'priv' }),
    createEIP712: (publicKey, contracts, start, days) => {
      calls.push(['eip712', publicKey, contracts.join(','), String(days)]);
      return { domain: { name: 'Decryption' }, types: { UserDecryptRequestVerification: [{ name: 'publicKey', type: 'bytes' }] }, message: { start } };
    },
    async userDecrypt(handles, priv, pub, sig, contracts, user) {
      calls.push(['userDecrypt', handles[0]!.handle, handles[0]!.contractAddress, priv, sig, contracts.join(','), user]);
      return { [HANDLE.toLowerCase()]: 77n };
    },
    async publicDecrypt(handles) {
      calls.push(['publicDecrypt', handles.join(',')]);
      return { clearValues: { [HANDLE]: 77n }, abiEncodedClearValues: '0xclear', decryptionProof: '0xproof' };
    },
  };
  const signer = {
    address: OPERATOR,
    async signTypedData(_d: Record<string, unknown>, types: Record<string, unknown[]>) {
      calls.push(['sign', Object.keys(types).join(',')]);
      return '0xsig';
    },
  };
  let loads = 0;
  const seeder = new ContractBenchmarkSeeder(ADDRESS, contract, signer, async () => {
    loads++;
    return relayer;
  });
  return { seeder, calls, loads: () => loads };
}

describe('parseChainBenchmark and promptHashBytes32', () => {
  it('names the status and hides the seed until revealed', () => {
    const raw = { promptHash: '0xAA', status: 2n, forced: true, scoreBps: 0n, resultsHash: '0x00', seed: 0n };
    expect(parseChainBenchmark(raw, HANDLE)).toEqual({
      status: 'publishing',
      promptHash: '0xaa',
      seedHandle: HANDLE.toLowerCase(),
      forced: true,
      scoreBps: 0,
      resultsHash: '0x00',
      seed: null,
    });
    expect(parseChainBenchmark({ ...raw, status: 3n, seed: 9n }, HANDLE).seed).toBe('9');
  });

  it('takes a sha256 with or without 0x, and refuses anything else', () => {
    expect(promptHashBytes32(SHA)).toBe(`0x${SHA}`);
    expect(promptHashBytes32(`0x${SHA.toUpperCase()}`)).toBe(`0x${SHA}`);
    expect(() => promptHashBytes32('abc')).toThrow();
    expect(() => promptHashBytes32('0'.repeat(64))).toThrow();
  });
});

describe('ContractBenchmarkSeeder', () => {
  it('commits the prompt hash as bytes32 and returns the tx hash', async () => {
    const { seeder, calls } = fakes();
    expect(seeder.address).toBe(ADDRESS.toLowerCase());
    expect(await seeder.commit(REF, SHA)).toBe('0xc0');
    expect(calls).toEqual([['commit', REF, `0x${SHA}`]]);
  });

  it('user-decrypts the seed as the operator, for this contract only', async () => {
    const { seeder, calls } = fakes();
    expect(await seeder.decryptSeed(HANDLE)).toBe(77n);
    expect(calls).toEqual([
      ['eip712', 'pub', ADDRESS.toLowerCase(), '1'],
      ['sign', 'UserDecryptRequestVerification'],
      ['userDecrypt', HANDLE, ADDRESS.toLowerCase(), 'priv', 'sig', ADDRESS.toLowerCase(), OPERATOR],
    ]);
  });

  it('publishes, then finalizes with the relayer proof', async () => {
    const { seeder, calls } = fakes();
    expect(await seeder.publish(REF, `0x${'ee'.repeat(32)}`, 5000)).toBe('0xp0');
    expect(await seeder.finalize(REF, HANDLE)).toEqual({ txHash: '0xf0', seed: 77n });
    expect(calls.slice(1)).toEqual([
      ['publicDecrypt', HANDLE],
      ['finalize', REF, '0xclear', '0xproof'],
    ]);
  });

  it('reads the record', async () => {
    const { seeder } = fakes();
    expect(await seeder.read(REF)).toMatchObject({ status: 'revealed', seed: '42', scoreBps: 5000 });
  });
});

describe('createBenchmarkSeeder', () => {
  const log = () => {
    const lines: string[] = [];
    return { lines, log: { warn: (m: string) => void lines.push(m) } };
  };

  it('is off without ZAMA_ENABLED', () => {
    const l = log();
    expect(createBenchmarkSeeder({ ZAMA_BENCHMARK_ADDRESS: ADDRESS }, l.log)).toBeNull();
    expect(l.lines).toEqual([]);
  });

  it('falls back to the Sepolia deployment, still needing the key', () => {
    const l = log();
    expect(createBenchmarkSeeder({ ZAMA_ENABLED: '1' }, l.log)).toBeNull();
    expect(l.lines).toHaveLength(1);
    expect(benchmarkSeedsAddress({})).toBe(sepolia.contracts.BenchmarkSeeds);
  });

  it('warns without the key or with a malformed one, never printing it', () => {
    const l = log();
    expect(createBenchmarkSeeder({ ZAMA_ENABLED: '1', ZAMA_BENCHMARK_ADDRESS: ADDRESS }, l.log)).toBeNull();
    expect(createBenchmarkSeeder({ ZAMA_ENABLED: '1', ZAMA_BENCHMARK_ADDRESS: ADDRESS, ZAMA_OPERATOR_PRIVATE_KEY: 'secret-ish' }, l.log)).toBeNull();
    expect(l.lines).toHaveLength(2);
    expect(l.lines.join(' ')).not.toContain('secret-ish');
  });

  it('builds a seeder with a key and an address', () => {
    const seeder = createBenchmarkSeeder({ ZAMA_ENABLED: 'true', ZAMA_BENCHMARK_ADDRESS: ADDRESS, ZAMA_OPERATOR_PRIVATE_KEY: '1'.repeat(64) }, log().log);
    expect(seeder?.address).toBe(ADDRESS.toLowerCase());
    expect(benchmarkSeedsAddress({ ZAMA_BENCHMARK_ADDRESS: 'nope' })).toBe(sepolia.contracts.BenchmarkSeeds);
  });
});
