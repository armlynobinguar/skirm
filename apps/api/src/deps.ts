// Everything the api needs from the outside world, injected as one object so tests can swap the
// queue, the spend reader and the NEAR adapters (docs/backend-contract.md).
import type { Repos } from '@skirm/db';
import type { Caster } from '@skirm/decision-engine/v2';
import type { RankedDecayConfig } from '@skirm/shared';
import type { NearKeyChecker } from './near-link';
import type { ReplayFrameReader } from './replays';
import type { RateLimitStore, RateLimits } from './rate-limit';
import type {
  BenchmarkJobData,
  DepositVerifier,
  ExternalTurnStore,
  SafePostOptions,
  SafePostResult,
  RentalVerifier,
  Minter,
  OwnershipReader,
  ServerConfig,
  Vault,
} from '@skirm/server';

/** Nest injection token for ApiDeps. */
export const DEPS = Symbol('skirm.api.deps');

/** The `benchmarks` queue as the api sees it: a minted version's benchmark or a buyer's trial. */
export interface BenchmarkQueue {
  enqueue(data: BenchmarkJobData): Promise<void>;
  close?(): Promise<void>;
}

/**
 * `V2_BRAIN` (not in ServerConfig) is read from the environment like the worker and realtime read
 * it: 'greedy' forces the offline brain even with an OpenRouter key. `rankedDecay` is the worker's
 * Elo decay setting (RANKED_DECAY_DAYS / _AMOUNT, rankedDecayFromEnv), DEFAULTS.ranked.decay unset.
 */
export type ApiConfig = Pick<
  ServerConfig,
  'AUTH_MODE' | 'PRIVY_APP_ID' | 'PRIVY_VERIFICATION_KEY' | 'CREDITS_PER_NEAR'
> &
  Partial<Pick<ServerConfig, 'OPS_TOKEN' | 'COST_ALERT_DAILY_USD' | 'OPENROUTER_API_KEY'>> & {
    V2_BRAIN?: string | undefined;
    rankedDecay?: RankedDecayConfig;
    /** Bench runs per account per rolling hour (default DEFAULTS.bench.runsPerHour). */
    BENCH_RUNS_PER_HOUR?: number | undefined;
  };

/** Model spend per UTC day as the worker and realtime sum it (Redis `cost:usd:<day>`, kept 3 days). */
export interface DailyCostReader {
  /** USD per requested day; a day with no entry is 0, and null means the store did not answer. */
  usd(days: string[]): Promise<Record<string, number> | null>;
  close?(): Promise<void>;
}

export interface ApiDeps {
  config: ApiConfig;
  repos: Repos;
  vault: Vault;
  near: {
    minter: Minter;
    deposits: DepositVerifier;
    /** Agent rental payments (`market.rent`); dev mode also takes `dev:` hashes. */
    rentals: RentalVerifier;
    ownership: OwnershipReader;
    /** Checks NEAR link proofs outside dev mode (absent: linking is refused with 503). */
    keys?: NearKeyChecker;
  };
  /** Benchmarks queued at mint and buyers' trials (the worker plays them). */
  benchmarkQueue: BenchmarkQueue;
  /** Daily model spend for GET /ops/stats (absent: the route reports it as unavailable). */
  costs?: DailyCostReader;
  /** Allowed CORS origins (default http://localhost:3000). */
  corsOrigins?: string[];
  /** Request rate limits (./rate-limit.ts): Redis counters in production; absent, no limits (tests). */
  rateLimit?: { store: RateLimitStore; limits?: Partial<RateLimits> };
  /** Bring your own agent: the pull relay shared with realtime (Redis; absent: /agent/v1/turn and /action answer 503). */
  externalTurns?: ExternalTurnStore;
  /** Tests only: the webhook transport for pings (default: the SSRF-safe safePostJson). */
  externalPost?: (url: string, body: string, opts: SafePostOptions) => Promise<SafePostResult>;
  /** Stored frames of ended matches for shared replays (absent: no playback, highlights empty). */
  replayFrames?: ReplayFrameReader;
  /** Writes the highlights' caster lines (absent: the offline template caster). */
  caster?: Caster;
}
