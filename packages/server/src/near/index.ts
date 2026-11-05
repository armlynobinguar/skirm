import type { ServerConfig } from '../config';
import { NearBadges, NoopBadges, type BadgeMinter } from './badges';
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
import { NearRpc, type NearRpcOptions } from './rpc';
import { NearSeasons, NoopSeasons, type SeasonsChain } from './seasons';
import { OpsFunctionCaller, type FunctionCaller } from './signer';

export * from './backing';
export * from './badges';
export * from './deposits';
export * from './rentals';
export * from './ownership';
export * from './registry';
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
  ownership: OwnershipReader;
  seasons: SeasonsChain;
  /** Soulbound achievement badges (`badges` contract). */
  badges: BadgeMinter;
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
>;

/**
 * Registry/Minter/OwnershipReader/Seasons/Badges are Near* when the ops signer is configured, Noop*
 * otherwise.
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
  return {
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
      new RpcDepositVerifier(rpc, config.NEAR_CONTRACT_DEPOSITS, config.CREDITS_PER_NEAR),
      config.AUTH_MODE === 'dev' ? new DevDepositVerifier(config.CREDITS_PER_NEAR) : undefined,
    ),
    rentals: new CompositeRentalVerifier(
      new RpcRentalVerifier(rpc, config.NEAR_CONTRACT_MARKET),
      config.AUTH_MODE === 'dev' ? new DevRentalVerifier() : undefined,
    ),
  };
}
