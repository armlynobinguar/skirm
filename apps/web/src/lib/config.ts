// Public runtime config. NEXT_PUBLIC_* values are inlined at build time, so each one must be read
// with a literal `process.env.NEXT_PUBLIC_…` expression (no dynamic lookups).

export type AuthMode = 'dev' | 'privy';

export interface WebConfig {
  /** Public origin of this site, no trailing slash: canonical URLs, Open Graph, sitemap, robots. */
  siteUrl: string;
  /** Show the internal design notes (top bar Notes, N key); off in production builds by default. */
  designNotes: boolean;
  /** REST base URL of apps/api, no trailing slash. */
  apiUrl: string;
  /** WebSocket URL of apps/realtime (path /ws). */
  wsUrl: string;
  /**
   * `dev`: a handle kept in localStorage is sent as `x-dev-user` (REST) and `devUser` (WS).
   * `privy`: a Privy access token (JWT) is sent as `Authorization: Bearer` / `token`
   * (src/lib/auth/privy.ts, PrivyRoot.tsx). Outside dev mode money and ownership go through the
   * player's NEAR wallet (src/lib/wallet).
   */
  authMode: AuthMode;
  /** Privy app id (privy mode). Empty: the Privy buttons explain that sign-in is not set up. */
  privyAppId: string;
  /** Optional Privy app client id (per-environment client in the Privy dashboard). */
  privyClientId: string;
  /** A known ranked, recorded match id for /verify's "Try a sample match" (NEXT_PUBLIC_SAMPLE_MATCH_ID); empty hides the button. */
  sampleMatchId: string;
  near: NearConfig;
}

export type NearNetwork = 'testnet' | 'mainnet';

export interface NearConfig {
  network: NearNetwork;
  /** JSON-RPC endpoint for read-only calls (e.g. `view_account` for the header's NEAR balance). */
  rpcUrl: string;
  /** Contract accounts (contracts/README.md), defaults are the testnet deployment. */
  contracts: { skills: string; market: string; deposits: string; registry: string };
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export const config: WebConfig = {
  siteUrl: trimSlash(process.env.NEXT_PUBLIC_SITE_URL || 'https://playskirm.xyz'),
  /** The design notes (top bar Notes, N): internal notes for the team, so off in production builds unless NEXT_PUBLIC_DESIGN_NOTES=1. */
  designNotes: process.env.NEXT_PUBLIC_DESIGN_NOTES === '1' || process.env.NODE_ENV !== 'production',
  apiUrl: trimSlash(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'),
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4001/ws',
  authMode: process.env.NEXT_PUBLIC_AUTH_MODE === 'privy' ? 'privy' : 'dev',
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || '',
  privyClientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || '',
  sampleMatchId: (process.env.NEXT_PUBLIC_SAMPLE_MATCH_ID || '').trim(),
  near: {
    network: process.env.NEXT_PUBLIC_NEAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
    // FastNEAR, the api's default (packages/server NEAR_RPC_URL).
    rpcUrl:
      process.env.NEXT_PUBLIC_NEAR_RPC_URL ||
      (process.env.NEXT_PUBLIC_NEAR_NETWORK === 'mainnet' ? 'https://rpc.mainnet.fastnear.com' : 'https://test.rpc.fastnear.com'),
    contracts: {
      skills: process.env.NEXT_PUBLIC_NEAR_CONTRACT_SKILLS || 'skills.playskirm.testnet',
      market: process.env.NEXT_PUBLIC_NEAR_CONTRACT_MARKET || 'market.playskirm.testnet',
      deposits: process.env.NEXT_PUBLIC_NEAR_CONTRACT_DEPOSITS || 'deposits.playskirm.testnet',
      registry: process.env.NEXT_PUBLIC_NEAR_CONTRACT_REGISTRY || 'registry.playskirm.testnet',
    },
  },
};
