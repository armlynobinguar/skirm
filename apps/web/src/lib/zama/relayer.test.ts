// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Eip1193Provider } from 'ethers';
import { getFhevmInstance, RELAYER_SDK_SRC, resetFhevmInstance } from './relayer';

const provider = {} as Eip1193Provider;

function sdkScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>(`script[src="${RELAYER_SDK_SRC}"]`)];
}

afterEach(() => {
  resetFhevmInstance();
  delete window.relayerSDK;
  sdkScripts().forEach((s) => s.remove());
});

describe('getFhevmInstance', () => {
  it('loads the UMD bundle once and builds a Sepolia instance from window.relayerSDK', async () => {
    const instance = { id: 'fhevm' };
    const sdk = {
      initSDK: vi.fn(async () => true),
      createInstance: vi.fn(async () => instance),
      SepoliaConfig: { chainId: 11155111 },
    };

    const pending = getFhevmInstance(provider);
    const [script] = sdkScripts();
    expect(script).toBeDefined();
    window.relayerSDK = sdk as unknown as NonNullable<Window['relayerSDK']>;
    script!.onload?.(new Event('load'));

    await expect(pending).resolves.toBe(instance);
    expect(sdk.initSDK).toHaveBeenCalledOnce();
    expect(sdk.createInstance).toHaveBeenCalledWith({ chainId: 11155111, network: provider });
    await expect(getFhevmInstance(provider)).resolves.toBe(instance);
    expect(sdkScripts()).toHaveLength(1);
  });

  it('rejects when the bundle fails to load, and retries with a fresh script next time', async () => {
    const pending = getFhevmInstance(provider);
    sdkScripts()[0]!.onerror?.(new Event('error'));
    await expect(pending).rejects.toThrow(/Could not load the Zama relayer SDK/);

    void getFhevmInstance(provider).catch(() => {});
    expect(sdkScripts()).toHaveLength(2);
  });
});
