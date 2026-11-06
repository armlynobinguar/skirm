import type { ServerConfig } from '../config';
import { NearBadges, NoopBadges, type BadgeMinter } from './badges';
import { NearCosmetics, type CosmeticsChain } from './cosmetics';
import {
  CompositeDepositVerifier,
  DevDepositVerifier,
  RpcDepositVerifier,
  type DepositVerifier,
} from './deposits';
import { CompositeRentalVerifier, DevRentalVerifier, RpcRentalVerifier, type RentalVerifier } from './rentals';
import { NearOwnershipReader, NoopOwnershipReader, type OwnershipReader } from './ownership';
import {
  NearMinter,
  NearRegistry,
  NoopMinter,
  NoopRegistry,
  type Minter,
  type Registry,
} from './registry';
import { RpcMarketTxVerifier, type MarketTxVerifier } from './market';
import { NearRpc, type NearRpcOptions } from './rpc';
import { NearSeasons, NoopSeasons, type SeasonsChain } from './seasons';
import { NearMetaTxRelayer, type MetaTxRelayer } from './relayer';
import { OpsFunctionCaller, type FunctionCaller } from './signer';

export * from './backing';
export * from './badges';
export * from './cosmetics';
export * from './delegate';
export * from './deposits';
export * from './market';
export * from './rentals';
export * from './ownership';
export * from './registry';
export * from './relayer';
export * from './rpc';
export * from './seasons';
export * from './signer';

export interface NearAdapters {
  rpc: NearRpc;
  registry: Registry;
  minter: Minter;
  deposits: DepositVerifier;
  /** Agent rental payments to the market contract (`market.rent`). */
  rentals: RentalVerifier;
  /** Skill NFT purchases (`market.buy`) and listings (`skills.nft_approve`) read through RPC. */
  market: MarketTxVerifier;
  ownership: OwnershipReader;
  seasons: SeasonsChain;
  /** Soulbound achievement badges (`badges` contract). */
  badges: BadgeMinter;
  /** NEP-245 cosmetic items; absent unless NEAR_CONTRACT_COSMETICS and the ops signer are set (credits-only). */
  cosmetics?: CosmeticsChain;
  /** Gasless onboarding's relayer (NEP-366); absent unless RELAYER_ACCOUNT_ID and _PRIVATE_KEY are set. */
  relayer?: MetaTxRelayer;
}

export interface NearAdapterOptions extends NearRpcOptions {
  /** Override the signer (tests). */
  caller?: FunctionCaller;
}

type NearConfig = Pick<
  ServerConfig,
  | 'AUTH_MODE'
  | 'NEAR_OPS_ACCOUNT'
  | 'NEAR_OPS_KEY'
  | 'NEAR_CONTRACT_SKILLS'
  | 'NEAR_CONTRACT_REGISTRY'
  | 'NEAR_CONTRACT_DEPOSITS'
  | 'NEAR_CONTRACT_MARKET'
  | 'NEAR_CONTRACT_SEASONS'
  | 'NEAR_CONTRACT_BADGES'
  | 'CREDITS_PER_NEAR'
  | 'nearRpcUrls'
> &
  Partial<Pick<ServerConfig, 'RELAYER_ACCOUNT_ID' | 'RELAYER_PRIVATE_KEY' | 'NEAR_CONTRACT_COSMETICS'>>;

/**
 * Registry/Minter/OwnershipReader/Seasons/Badges are Near* when the ops signer is configured, Noop*
 * otherwise. The relayer exists only with RELAYER_ACCOUNT_ID and RELAYER_PRIVATE_KEY set, and the
 * cosmetics chain only with NEAR_CONTRACT_COSMETICS and the ops signer.
 * Deposits and rentals always verify through RPC; `dev:` hashes are accepted only with AUTH_MODE=dev.
 */
export function createNearAdapters(
  config: NearConfig,
  opts: NearAdapterOptions = {},
): NearAdapters {
  const rpc = new NearRpc(config.nearRpcUrls, opts);
  const caller =
    opts.caller ??
    (config.NEAR_OPS_ACCOUNT && config.NEAR_OPS_KEY
      ? new OpsFunctionCaller(config.NEAR_OPS_ACCOUNT, config.NEAR_OPS_KEY, config.nearRpcUrls)
      : undefined);
  const relayer =
    config.RELAYER_ACCOUNT_ID && config.RELAYER_PRIVATE_KEY
      ? new NearMetaTxRelayer(config.RELAYER_ACCOUNT_ID, config.RELAYER_PRIVATE_KEY, rpc)
      : undefined;
  // Deposits and rentals the relayer sent for a player count as the player's (docs/gasless.md).
  const relayers = relayer ? [relayer.relayerId] : [];
  return {
    ...(relayer ? { relayer } : {}),
    // Cosmetics go onchain only when their contract is named (it is not deployed yet).
    ...(caller && config.NEAR_CONTRACT_COSMETICS
      ? { cosmetics: new NearCosmetics(caller, rpc, config.NEAR_CONTRACT_COSMETICS) }
      : {}),
    rpc,
    registry: caller ? new NearRegistry(caller, config.NEAR_CONTRACT_REGISTRY) : new NoopRegistry(),
    minter: caller ? new NearMinter(caller, config.NEAR_CONTRACT_SKILLS) : new NoopMinter(),
    ownership: caller
      ? new NearOwnershipReader(rpc, config.NEAR_CONTRACT_SKILLS)
      : new NoopOwnershipReader(),
    seasons: caller
      ? new NearSeasons(caller, rpc, config.NEAR_CONTRACT_SEASONS)
      : new NoopSeasons(),
    badges: caller ? new NearBadges(caller, config.NEAR_CONTRACT_BADGES) : new NoopBadges(),
    deposits: new CompositeDepositVerifier(
      new RpcDepositVerifier(rpc, config.NEAR_CONTRACT_DEPOSITS, config.CREDITS_PER_NEAR, relayers),
      config.AUTH_MODE === 'dev' ? new DevDepositVerifier(config.CREDITS_PER_NEAR) : undefined,
    ),
    market: new RpcMarketTxVerifier(rpc, config.NEAR_CONTRACT_MARKET, config.NEAR_CONTRACT_SKILLS, relayers),
    rentals: new CompositeRentalVerifier(
      new RpcRentalVerifier(rpc, config.NEAR_CONTRACT_MARKET, relayers),
      config.AUTH_MODE === 'dev' ? new DevRentalVerifier() : undefined,
    ),
  };
}
