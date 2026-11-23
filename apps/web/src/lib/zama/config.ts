// Zama Protocol (FHEVM on Sepolia) public config. Everything Zama is behind NEXT_PUBLIC_ZAMA_ENABLED
// so the NEAR flows are untouched when it is off. NEXT_PUBLIC_* values are inlined at build time, so
// each one is read with a literal `process.env.NEXT_PUBLIC_…` expression.
import { sepolia } from '@skirm/fhevm/generated';

export type HexAddress = `0x${string}`;

export interface ZamaConfig {
  /** NEXT_PUBLIC_ZAMA_ENABLED=1 (or true) turns the confidential (FHEVM) features on. */
  enabled: boolean;
  /** Sepolia chain id (11155111). */
  chainId: number;
  /** Public Sepolia JSON-RPC offered to the wallet when it has to add the chain. */
  rpcUrl: string;
  /** Block explorer for tx links. */
  explorerUrl: string;
  /** Contract addresses: env override, else packages/fhevm/deployments/sepolia.json (via generated/). */
  contracts: { credits: HexAddress | null; match: HexAddress | null; fog: HexAddress | null; auction: HexAddress | null };
}

const flag = (v: string | undefined) => v === '1' || v === 'true';

/** Accepts a 0x-prefixed 20-byte hex address, else null. */
export function parseAddress(v: string | null | undefined): HexAddress | null {
  const s = (v ?? '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? (s as HexAddress) : null;
}

export const zamaConfig: ZamaConfig = {
  enabled: flag(process.env.NEXT_PUBLIC_ZAMA_ENABLED),
  chainId: sepolia.chainId,
  rpcUrl: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
  explorerUrl: 'https://sepolia.etherscan.io',
  contracts: {
    credits:
      parseAddress(process.env.NEXT_PUBLIC_ZAMA_CREDITS_ADDRESS) ?? sepolia.contracts.ConfidentialSkirmCredits,
    match: parseAddress(process.env.NEXT_PUBLIC_ZAMA_MATCH_ADDRESS) ?? sepolia.contracts.SkirmMatch,
    fog: parseAddress(process.env.NEXT_PUBLIC_ZAMA_FOG_ADDRESS) ?? sepolia.contracts.FogSkirm,
    auction: parseAddress(process.env.NEXT_PUBLIC_ZAMA_AUCTION_ADDRESS) ?? sepolia.contracts.SkillAuction,
  },
};
