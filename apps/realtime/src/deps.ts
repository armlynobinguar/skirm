// Everything realtime needs from the outside world, injected as one object so tests can swap the
// pub/sub, the registry queue, the v2 brain, the map pool and the clock.
import type { Repos } from '@skirm/db';
import type { V2Brain } from '@skirm/decision-engine/v2';
import type { MapDefV2 } from '@skirm/engine/v2';
import type { ModelChoice } from '@skirm/shared';
import type { V2Timing } from './v2/match';
import type { ExternalTurnStore, LadderOperator, MatchSettler, PredictionOperator, RegistryJobData, SealedMatchReader, ServerConfig, Vault } from '@skirm/server';
import type { WebhookPost } from './v2/external';
import type { PubSub } from './pubsub';
import type { QueueTiming, Scheduler } from './timing';

/** The `registry` BullMQ queue as realtime sees it. */
export interface RegistryQueue {
  enqueue(data: RegistryJobData): Promise<void>;
  close?(): Promise<void>;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(`[realtime] ${m}`),
  warn: (m) => console.warn(`[realtime] ${m}`),
  error: (m) => console.error(`[realtime] ${m}`),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export type RealtimeConfig = Pick<
  ServerConfig,
  'AUTH_MODE' | 'PRIVY_APP_ID' | 'PRIVY_VERIFICATION_KEY'
>;

export interface RealtimeDeps {
  config: RealtimeConfig;
  /** Reports an unexpected error to Error Reporting (main: @skirm/server reportError; absent in tests). */
  report?: (err: unknown, where: string) => void;
  repos: Repos;
  vault: Pick<Vault, 'encryptSkill' | 'decryptSkill'> & Partial<Pick<Vault, 'decryptPlaybook'>>;
  pubsub: PubSub;
  registry: RegistryQueue;
  scheduler?: Scheduler;
  queueTiming?: Partial<QueueTiming>;
  /** v2: the brain every agent uses (default: the offline greedy brain; production passes the model brain). */
  v2Brain?: V2Brain;
  /** v2: the models a crew may pick per agent (config llmModels; default: the default model alone). */
  v2Models?: readonly ModelChoice[];
  v2Timing?: Partial<V2Timing>;
  /** Bring your own agent: the pull relay shared with the api (Redis in production). */
  externalTurns?: ExternalTurnStore;
  /** Sealed loadouts (ZAMA_ENABLED): the SkirmMatch reader on Sepolia (absent: the feature is off). */
  sealedMatches?: SealedMatchReader | null;
  /** Sealed matches settle on chain (ZAMA_OPERATOR_PRIVATE_KEY): anchors the log hash, pays the cSKIRM escrow. */
  matchSettler?: MatchSettler | null;
  /** Spectator prediction markets (ZAMA_ENABLED, ZAMA_OPERATOR_PRIVATE_KEY): opened on every PvP match. */
  predictionMarkets?: PredictionOperator | null;
  /** The private ladder (ZAMA_ENABLED, ZAMA_OPERATOR_PRIVATE_KEY): ranked results reported on chain. */
  privateLadder?: LadderOperator | null;
  /**
   * The private ladder's pairing check (ZAMA_LADDER_MATCHMAKING=1): isCloseMatch before two linked
   * ranked searches pair, `timeoutMs` (ZAMA_LADDER_CHECK_TIMEOUT_MS) before pairing without it.
   */
  ladderMatchmaking?: { enabled: boolean; timeoutMs?: number; vetoMs?: number };
  /** Tests only: the external agents' webhook transport (default: the SSRF-safe POST). */
  externalPost?: WebhookPost;
  /** v2 map pool (default: MAPS_V2). */
  v2Maps?: readonly MapDefV2[];
  /** Picks the map for a pair (default: random from the maps that take both crews). */
  v2PickMap?: (fits: readonly MapDefV2[]) => MapDefV2;
  /** WebSocket ping interval; 0 disables (default 30 s). */
  pingIntervalMs?: number;
  log?: Logger;
}
