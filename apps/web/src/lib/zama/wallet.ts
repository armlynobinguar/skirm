// EVM wallet for the Zama features: the browser's injected EIP-1193 provider (window.ethereum),
// wrapped in an ethers BrowserProvider. Separate from the NEAR wallet in src/lib/wallet.
import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from 'ethers';
import { ensureSepolia, parseChainId } from './chain';
import { zamaConfig } from './config';

/** An EIP-1193 provider that can also emit wallet events (accountsChanged, chainChanged). */
export interface InjectedProvider extends Eip1193Provider {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export class ZamaWalletError extends Error {
  constructor(
    readonly code: 'no_wallet' | 'rejected' | 'wrong_chain' | 'not_deployed' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'ZamaWalletError';
  }
}

/** The injected wallet, or null (no extension, or server side). */
export function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === 'undefined') return null;
  const eth = (window as unknown as { ethereum?: InjectedProvider }).ethereum;
  return eth && typeof eth.request === 'function' ? eth : null;
}

export interface EvmConnection {
  address: `0x${string}`;
  chainId: number;
  eip1193: InjectedProvider;
  provider: BrowserProvider;
  signer: JsonRpcSigner;
}

/** Asks the wallet for an account, switches it to Sepolia and returns a signer. */
export async function connectEvmWallet(): Promise<EvmConnection> {
  const eip1193 = getInjectedProvider();
  if (!eip1193) throw new ZamaWalletError('no_wallet', 'No browser wallet found. Install MetaMask or another EVM wallet.');
  try {
    await eip1193.request({ method: 'eth_requestAccounts' });
    await ensureSepolia(eip1193);
  } catch (e) {
    if ((e as { code?: unknown })?.code === 4001) throw new ZamaWalletError('rejected', 'The request was rejected in the wallet.');
    throw e;
  }
  return currentConnection(eip1193);
}

/** The already-authorised account (no prompt), or null if the site is not connected yet. */
export async function restoreEvmWallet(): Promise<EvmConnection | null> {
  const eip1193 = getInjectedProvider();
  if (!eip1193) return null;
  const accounts = (await eip1193.request({ method: 'eth_accounts' })) as string[] | undefined;
  if (!accounts?.length) return null;
  return currentConnection(eip1193);
}

async function currentConnection(eip1193: InjectedProvider): Promise<EvmConnection> {
  const provider = new BrowserProvider(eip1193);
  const signer = await provider.getSigner();
  const chainId = parseChainId(await eip1193.request({ method: 'eth_chainId' }));
  return { address: (await signer.getAddress()) as `0x${string}`, chainId, eip1193, provider, signer };
}

/** Throws unless the connection is on the configured chain (Sepolia). */
export function assertSepolia(conn: Pick<EvmConnection, 'chainId'>): void {
  if (conn.chainId !== zamaConfig.chainId) {
    throw new ZamaWalletError('wrong_chain', 'Switch your wallet to Sepolia to use confidential credits.');
  }
}
