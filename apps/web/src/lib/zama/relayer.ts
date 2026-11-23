// Lazy, client-only Zama relayer SDK instance. The SDK ships WebAssembly (TFHE + KMS) that is only
// fetched the first time a confidential feature needs it, never during SSR.
import type { FhevmInstance } from '@zama-fhe/relayer-sdk/web';
import type { Eip1193Provider } from 'ethers';

let instance: Promise<FhevmInstance> | null = null;

/**
 * Returns the shared FHEVM instance for Sepolia, loading the SDK and its WASM on first use.
 * A failed load is not cached, so the next call retries.
 */
export function getFhevmInstance(network: Eip1193Provider): Promise<FhevmInstance> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('The Zama relayer SDK only runs in the browser.'));
  }
  instance ??= (async () => {
    const sdk = await import('@zama-fhe/relayer-sdk/web');
    await sdk.initSDK();
    return sdk.createInstance({ ...sdk.SepoliaConfig, network });
  })().catch((e: unknown) => {
    instance = null;
    throw e;
  });
  return instance;
}

/** Drops the cached instance (tests, or after the wallet provider changes). */
export function resetFhevmInstance(): void {
  instance = null;
}
