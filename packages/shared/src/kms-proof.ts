// Retrying a public reveal when the Zama KMS proof is rejected.
//
// A reveal is two steps: public-decrypt the handles through the relayer (clear values plus a KMS
// proof), then send them to a contract that checks the proof with FHE.checkSignatures. On Sepolia the
// relayer sometimes returns a proof signed by a key the on-chain KMSVerifier does not accept, and the
// call reverts with KMSInvalidSigner(address). Asking the relayer again returns a good proof (the
// 10-wallet simulation hit this on 3 of about 35 reveals, each fixed by one retry). So on that error,
// and only that one, decrypt again and resend.

/** The selector of `KMSInvalidSigner(address)`, the KMSVerifier error behind a rejected proof. */
export const KMS_INVALID_SIGNER_SELECTOR = '0x6475522d';
/** Attempts in all (the first try and two retries with a fresh proof). */
export const KMS_PROOF_TRIES = 3;

/** Whether `e` (an ethers or viem error, a plain Error or its nested causes) is KMSInvalidSigner. */
export function isKmsInvalidSigner(e: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth: number): boolean => {
    if (v == null || depth > 6 || seen.has(v)) return false;
    if (typeof v === 'string') return v.includes('KMSInvalidSigner') || v.toLowerCase().includes(KMS_INVALID_SIGNER_SELECTOR);
    if (typeof v !== 'object') return false;
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const k of ['message', 'shortMessage', 'reason', 'data', 'name', 'errorName', 'revert', 'error', 'info', 'cause'])
      if (k in o && visit(o[k], depth + 1)) return true;
    return false;
  };
  return visit(e, 0);
}

/**
 * Runs `decrypt` then `submit(decrypted)`. If the submit fails with KMSInvalidSigner, decrypts again
 * for a fresh proof and resubmits, up to `tries` attempts in all. Any other error is thrown at once.
 */
export async function withFreshKmsProof<D, T>(
  decrypt: () => Promise<D>,
  submit: (decrypted: D) => Promise<T>,
  tries: number = KMS_PROOF_TRIES,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const decrypted = await decrypt();
    try {
      return await submit(decrypted);
    } catch (e) {
      if (attempt >= tries || !isKmsInvalidSigner(e)) throw e;
    }
  }
}
