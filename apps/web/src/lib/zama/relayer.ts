// Lazy, client-only Zama relayer SDK instance. The SDK ships WebAssembly (TFHE + KMS) that is only
// fetched the first time a confidential feature needs it, never during SSR.
//
// The SDK is loaded from its prebuilt UMD bundle in public/ (scripts/copy-relayer-sdk.mjs), never
// imported at runtime: bundling its ESM build hangs `next build` (a worker that spawns itself).
// Only its types are imported here, and type imports are erased.
import type { FhevmInstance } from '@zama-fhe/relayer-sdk/web';
import type * as RelayerSdk from '@zama-fhe/relayer-sdk/web';
import type { Eip1193Provider } from 'ethers';

/** Where the copied UMD bundle is served from (it defines window.relayerSDK). */
export const RELAYER_SDK_SRC = '/zama/relayer-sdk-js.umd.js';

type RelayerSdkGlobal = Pick<typeof RelayerSdk, 'initSDK' | 'createInstance' | 'SepoliaConfig'>;

declare global {
  interface Window {
    relayerSDK?: RelayerSdkGlobal;
  }
}

let sdkScript: Promise<RelayerSdkGlobal> | null = null;

/** Injects the UMD bundle once and resolves with window.relayerSDK. */
function loadRelayerSdk(): Promise<RelayerSdkGlobal> {
  if (window.relayerSDK) return Promise.resolve(window.relayerSDK);
  sdkScript ??= new Promise<RelayerSdkGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = RELAYER_SDK_SRC;
    script.async = true;
    script.onload = () =>
      window.relayerSDK
        ? resolve(window.relayerSDK)
        : reject(new Error('The Zama relayer SDK loaded but did not define window.relayerSDK.'));
    script.onerror = () => reject(new Error(`Could not load the Zama relayer SDK from ${RELAYER_SDK_SRC}.`));
    document.head.appendChild(script);
  }).catch((e: unknown) => {
    sdkScript = null;
    throw e;
  });
  return sdkScript;
}

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
    const sdk = await loadRelayerSdk();
    await sdk.initSDK();
    return sdk.createInstance({ ...sdk.SepoliaConfig, network });
  })().catch((e: unknown) => {
    instance = null;
    throw e;
  });
  return instance;
}

/** Drops the cached instance and script load (tests, or after the wallet provider changes). */
export function resetFhevmInstance(): void {
  instance = null;
  sdkScript = null;
}
