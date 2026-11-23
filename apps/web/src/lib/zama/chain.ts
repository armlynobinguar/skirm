// Sepolia chain switching for an injected EIP-1193 wallet (MetaMask, Rabby, ...).
import type { Eip1193Provider } from 'ethers';
import { zamaConfig } from './config';

/** `0x`-prefixed hex chain id, as wallets expect in wallet_switchEthereumChain. */
export function toHexChainId(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

/** Parses a chain id from a wallet (hex string, decimal string, number or bigint); NaN if invalid. */
export function parseChainId(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return v.startsWith('0x') ? parseInt(v, 16) : Number(v);
  return Number.NaN;
}

/** The wallet_addEthereumChain parameters for Sepolia. */
export function sepoliaChainParams(cfg = zamaConfig) {
  return {
    chainId: toHexChainId(cfg.chainId),
    chainName: 'Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [cfg.rpcUrl],
    blockExplorerUrls: [cfg.explorerUrl],
  };
}

/** EIP-1193 / MetaMask code for "this chain has not been added to the wallet". */
const UNRECOGNIZED_CHAIN = 4902;

function errorCode(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const err = e as { code?: unknown; data?: { originalError?: { code?: unknown } } };
  const code = err.code ?? err.data?.originalError?.code;
  return typeof code === 'number' ? code : undefined;
}

/** Switches the wallet to Sepolia, adding the chain first if the wallet does not know it. */
export async function ensureSepolia(provider: Eip1193Provider, cfg = zamaConfig): Promise<void> {
  const current = parseChainId(await provider.request({ method: 'eth_chainId' }));
  if (current === cfg.chainId) return;
  const chainId = toHexChainId(cfg.chainId);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e) {
    if (errorCode(e) !== UNRECOGNIZED_CHAIN) throw e;
    await provider.request({ method: 'wallet_addEthereumChain', params: [sepoliaChainParams(cfg)] });
  }
}
