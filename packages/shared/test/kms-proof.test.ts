import { describe, expect, it, vi } from 'vitest';
import { KMS_INVALID_SIGNER_SELECTOR, isKmsInvalidSigner, withFreshKmsProof } from '../src/kms-proof';

const kmsError = () => Object.assign(new Error('execution reverted (unknown custom error)'), {
  data: `${KMS_INVALID_SIGNER_SELECTOR}000000000000000000000000a5a5e4aa527d42ba98276ea6f762cc542dcd44e1`,
});

describe('KMS proof retry', () => {
  it('has the selector of KMSInvalidSigner(address)', () => {
    // keccak256("KMSInvalidSigner(address)") starts 6475522d (checked with ethers' id()).
    expect(KMS_INVALID_SIGNER_SELECTOR).toBe('0x6475522d');
  });

  it('spots the error by revert data, by name, or nested in a cause', () => {
    expect(isKmsInvalidSigner(kmsError())).toBe(true);
    expect(isKmsInvalidSigner({ revert: { name: 'KMSInvalidSigner', args: ['0x1'] } })).toBe(true);
    expect(isKmsInvalidSigner(new Error('wrapped', { cause: { info: { error: { data: KMS_INVALID_SIGNER_SELECTOR.toUpperCase().replace('0X', '0x') } } } }))).toBe(true);
    expect(isKmsInvalidSigner(new Error('execution reverted: not your turn'))).toBe(false);
    expect(isKmsInvalidSigner(undefined)).toBe(false);
  });

  it('decrypts again for a fresh proof when the proof is rejected', async () => {
    const decrypt = vi.fn().mockResolvedValueOnce('proof-1').mockResolvedValueOnce('proof-2');
    const submit = vi.fn(async (p: string) => {
      if (p === 'proof-1') throw kmsError();
      return `sent ${p}`;
    });
    await expect(withFreshKmsProof(decrypt, submit)).resolves.toBe('sent proof-2');
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it('gives up after three tries, and never retries other errors', async () => {
    const always = vi.fn(async () => { throw kmsError(); });
    await expect(withFreshKmsProof(async () => 'p', always)).rejects.toThrow('unknown custom error');
    expect(always).toHaveBeenCalledTimes(3);
    const other = vi.fn(async () => { throw new Error('not your turn'); });
    await expect(withFreshKmsProof(async () => 'p', other)).rejects.toThrow('not your turn');
    expect(other).toHaveBeenCalledTimes(1);
  });
});
