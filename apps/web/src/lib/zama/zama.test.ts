import { describe, expect, it, vi } from 'vitest';
import { ensureSepolia, parseChainId, sepoliaChainParams, toHexChainId } from './chain';
import { parseAddress } from './config';
import {
  authIsFresh,
  checkUint,
  clearDecryptAuth,
  contractSet,
  encryptU64,
  encryptU8,
  formatUnits6,
  isZeroHandle,
  publicDecrypt,
  toHex,
  userDecrypt,
  userDecryptUint,
  ZERO_HANDLE,
  type Handle,
} from './fhe';

const TOKEN = '0x00000000000000000000000000000000000000aA';
const USER = '0x1111111111111111111111111111111111111111';
const H1 = `0x${'01'.repeat(32)}` as Handle;
const H2 = `0x${'AB'.repeat(32)}` as Handle;

function fakeInstance() {
  const added: Array<[string, bigint]> = [];
  const input = {
    add64: vi.fn((v: bigint) => (added.push(['64', BigInt(v)]), input)),
    add8: vi.fn((v: bigint) => (added.push(['8', BigInt(v)]), input)),
    encrypt: vi.fn(async () => ({ handles: [new Uint8Array([0xde, 0xad])], inputProof: new Uint8Array([1, 2, 255]) })),
  };
  return {
    added,
    createEncryptedInput: vi.fn(() => input as never),
    generateKeypair: vi.fn(() => ({ publicKey: 'pub', privateKey: 'priv' })),
    createEIP712: vi.fn(() => ({
      domain: { name: 'Decryption', chainId: 11155111 },
      types: { UserDecryptRequestVerification: [{ name: 'publicKey', type: 'bytes' }] },
      message: { publicKey: '0xpub' },
      primaryType: 'UserDecryptRequestVerification',
    }) as never),
    userDecrypt: vi.fn(async () => ({ [H1.toLowerCase()]: 42n, [H2]: true }) as never),
    publicDecrypt: vi.fn(async () => ({ clearValues: { [H1]: 7n }, abiEncodedClearValues: '0x07', decryptionProof: '0xproof' }) as never),
  };
}

function fakeSigner() {
  return { getAddress: vi.fn(async () => USER), signTypedData: vi.fn(async () => '0xsig') };
}

describe('chain helpers', () => {
  it('formats and parses chain ids', () => {
    expect(toHexChainId(11155111)).toBe('0xaa36a7');
    expect(parseChainId('0xaa36a7')).toBe(11155111);
    expect(parseChainId('11155111')).toBe(11155111);
    expect(parseChainId(5n)).toBe(5);
    expect(parseChainId(null)).toBeNaN();
    expect(sepoliaChainParams().chainId).toBe('0xaa36a7');
  });

  it('does nothing when the wallet is already on Sepolia', async () => {
    const request = vi.fn(async () => '0xaa36a7');
    await ensureSepolia({ request });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('switches, and adds Sepolia when the wallet does not know it', async () => {
    const calls: string[] = [];
    const request = vi.fn(async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain') throw Object.assign(new Error('unknown chain'), { code: 4902 });
      return null;
    });
    await ensureSepolia({ request });
    expect(calls).toEqual(['eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']);
  });

  it('rethrows other switch errors (e.g. user rejected)', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x1';
      throw Object.assign(new Error('rejected'), { code: 4001 });
    });
    await expect(ensureSepolia({ request })).rejects.toMatchObject({ code: 4001 });
  });

  it('parses contract addresses', () => {
    expect(parseAddress(` ${TOKEN} `)).toBe(TOKEN);
    expect(parseAddress('0x123')).toBeNull();
    expect(parseAddress(undefined)).toBeNull();
  });
});

describe('encryption helpers', () => {
  it('checks integer ranges', () => {
    expect(checkUint(255, 255n, 'x')).toBe(255n);
    expect(() => checkUint(256, 255n, 'x')).toThrow(RangeError);
    expect(() => checkUint(-1n, 255n, 'x')).toThrow(RangeError);
    expect(() => checkUint(1.5, 255n, 'x')).toThrow(RangeError);
  });

  it('hex-encodes bytes and recognises zero handles', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('0x000fff');
    expect(toHex('abcd')).toBe('0xabcd');
    expect(isZeroHandle(ZERO_HANDLE)).toBe(true);
    expect(isZeroHandle(H1)).toBe(false);
  });

  it('encrypts a uint64 / uint8 bound to the contract and user', async () => {
    const inst = fakeInstance();
    await expect(encryptU64(inst, TOKEN, USER, 10n ** 12n)).resolves.toEqual({ handle: '0xdead', inputProof: '0x0102ff' });
    await encryptU8(inst, TOKEN, USER, 3);
    expect(inst.createEncryptedInput).toHaveBeenCalledWith(TOKEN, USER);
    expect(inst.added).toEqual([
      ['64', 10n ** 12n],
      ['8', 3n],
    ]);
    await expect(encryptU8(inst, TOKEN, USER, 256)).rejects.toThrow(RangeError);
    await expect(encryptU64(inst, TOKEN, USER, 1n << 64n)).rejects.toThrow(RangeError);
  });
});

describe('decryption helpers', () => {
  it('signs one EIP-712 request, then reuses it while fresh', async () => {
    clearDecryptAuth();
    const inst = fakeInstance();
    const signer = fakeSigner();
    const refs = [
      { handle: H1, contractAddress: TOKEN },
      { handle: ZERO_HANDLE, contractAddress: TOKEN },
      { handle: H2, contractAddress: TOKEN.toLowerCase() },
    ];
    await expect(userDecrypt(inst, signer, refs)).resolves.toEqual([42n, 0n, true]);
    expect(signer.signTypedData).toHaveBeenCalledWith(
      { name: 'Decryption', chainId: 11155111 },
      { UserDecryptRequestVerification: [{ name: 'publicKey', type: 'bytes' }] },
      { publicKey: '0xpub' },
    );
    const args = inst.userDecrypt.mock.calls[0] as unknown[];
    expect(args[0]).toHaveLength(2); // the zero handle never goes to the relayer
    expect(args.slice(1, 6)).toEqual(['priv', 'pub', 'sig', [TOKEN.toLowerCase()], USER]);

    await expect(userDecryptUint(inst, signer, { handle: H1, contractAddress: TOKEN })).resolves.toBe(42n);
    expect(signer.signTypedData).toHaveBeenCalledTimes(1);
    expect(inst.userDecrypt).toHaveBeenCalledTimes(2);
  });

  it('skips the relayer entirely for zero handles', async () => {
    const inst = fakeInstance();
    await expect(userDecrypt(inst, fakeSigner(), [{ handle: ZERO_HANDLE, contractAddress: TOKEN }])).resolves.toEqual([0n]);
    expect(inst.userDecrypt).not.toHaveBeenCalled();
  });

  it('rejects a non-integer result for userDecryptUint', async () => {
    clearDecryptAuth();
    await expect(userDecryptUint(fakeInstance(), fakeSigner(), { handle: H2, contractAddress: TOKEN })).rejects.toThrow(TypeError);
  });

  it('public-decrypts handles with the KMS proof', async () => {
    await expect(publicDecrypt(fakeInstance(), [H1])).resolves.toEqual({
      values: [7n],
      abiEncodedClearValues: '0x07',
      decryptionProof: '0xproof',
    });
  });

  it('dedupes contract sets and expires authorisations', () => {
    expect(contractSet([{ handle: H1, contractAddress: TOKEN }, { handle: H2, contractAddress: TOKEN.toLowerCase() }])).toEqual([TOKEN.toLowerCase()]);
    expect(authIsFresh({ startTimestamp: 0, durationDays: 1 }, 86_400 - 61)).toBe(true);
    expect(authIsFresh({ startTimestamp: 0, durationDays: 1 }, 86_400 - 60)).toBe(false);
  });

  it('formats 6-decimal base units', () => {
    expect(formatUnits6(1_000_000_000n)).toBe('1,000');
    expect(formatUnits6(1_234_567n)).toBe('1.23');
    expect(formatUnits6(500_000n)).toBe('0.5');
    expect(formatUnits6(0n)).toBe('0');
  });
});
