// Everything realtime needs from the outside world, injected as one object so tests can swap the
// pub/sub, the registry queue, the v2 brain, the map pool and the clock.
import type { Repos } from '@skirm/db';
import type { V2Brain } from '@skirm/decision-engine/v2';
import type { MapDefV2 } from '@skirm/engine/v2';
import type { V2Timing } from './v2/match';
import type { RegistryJobData, ServerConfig, Vault } from '@skirm/server';
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
  repos: Repos;
  vault: Pick<Vault, 'encryptSkill' | 'decryptSkill'>;
  pubsub: PubSub;
  registry: RegistryQueue;
  scheduler?: Scheduler;
  queueTiming?: Partial<QueueTiming>;
  /** v2: the brain every agent uses (default: the offline greedy brain; production passes Haiku). */
  v2Brain?: V2Brain;
  v2Timing?: Partial<V2Timing>;
  /** v2 map pool (default: MAPS_V2). */
  v2Maps?: readonly MapDefV2[];
  /** Picks the map for a pair (default: random from the maps that take both crews). */
  v2PickMap?: (fits: readonly MapDefV2[]) => MapDefV2;
  /** WebSocket ping interval; 0 disables (default 30 s). */
  pingIntervalMs?: number;
  log?: Logger;
}
