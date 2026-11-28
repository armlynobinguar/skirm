// A short-lived Redis cache for hot public reads (ladders, seasons, the market, tournaments,
// community maps). Postgres is far from the api (Supabase in Mumbai, ~250 ms a round trip) while
// Redis is next to it (Memorystore in the same region), so a hit saves the whole database trip.
//
// Entries live in scopes. A write that changes what a scope shows calls `invalidate(scope)`, which
// bumps the scope's generation: every key of the old generation is skipped from then on and expires
// by its TTL (every entry has one; Memorystore runs `noeviction`). Writes made by another service
// (match results from realtime) are not invalidated: those entries are at most their TTL old.
//
// Redis down or slow never fails a request: a read that does not answer within `timeoutMs` loads
// from the database, and a failed store or invalidation is ignored.
import type { Redis } from 'ioredis';

export interface ReadCache {
  /** `key` of `scope` from the cache, else `load()`'s value, stored for `ttlSec`. JSON values only. */
  read<T>(scope: string, key: string, ttlSec: number, load: () => Promise<T>): Promise<T>;
  /** Drops every entry of `scope` (on every api instance). Never throws. */
  invalidate(scope: string): Promise<void>;
}

/** No cache: every read loads (tests, and the default when none is injected). */
export const NO_READ_CACHE: ReadCache = {
  read: (_scope, _key, _ttl, load) => load(),
  invalidate: async () => {},
};

/** The scopes the api caches, with their TTLs in seconds. */
export const CACHE = {
  leaderboards: { scope: 'leaderboards', ttl: 30 },
  seasons: { scope: 'seasons', ttl: 30 },
  market: { scope: 'market', ttl: 30 },
  tournaments: { scope: 'tournaments', ttl: 15 },
  communityMaps: { scope: 'community-maps', ttl: 30 },
  recordedMatches: { scope: 'recorded-matches', ttl: 30 },
} as const;

type CacheRedis = Pick<Redis, 'get' | 'set' | 'incr' | 'expire'>;

const PREFIX = 'cache:v1:';
/** How long a scope's generation counter is kept after its last bump. */
const GENERATION_TTL_SEC = 86_400;

export class RedisReadCache implements ReadCache {
  constructor(
    private readonly redis: CacheRedis,
    private readonly timeoutMs = 150,
  ) {}

  async read<T>(scope: string, key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
    const gen = await this.answer(this.redis.get(`${PREFIX}gen:${scope}`));
    // No answer (Redis down or slow): straight to the database, and nothing is stored.
    if (gen === undefined) return load();
    const entry = `${PREFIX}${scope}:${gen ?? '0'}:${key}`;
    const hit = await this.answer(this.redis.get(entry));
    if (typeof hit === 'string') {
      try {
        return JSON.parse(hit) as T;
      } catch {
        // A corrupt entry is reloaded and overwritten below.
      }
    }
    const value = await load();
    void this.answer(this.redis.set(entry, JSON.stringify(value), 'EX', ttlSec));
    return value;
  }

  async invalidate(scope: string): Promise<void> {
    const key = `${PREFIX}gen:${scope}`;
    await this.answer(this.redis.incr(key).then(() => this.redis.expire(key, GENERATION_TTL_SEC)));
  }

  /** The command's result, or undefined when it failed or took longer than `timeoutMs`. */
  private answer<T>(p: Promise<T>): Promise<T | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), this.timeoutMs);
      timer.unref?.();
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        () => {
          clearTimeout(timer);
          resolve(undefined);
        },
      );
    });
  }
}

/** The injected cache, or none. */
export const readCacheOf = (deps: { readCache?: ReadCache | undefined }): ReadCache => deps.readCache ?? NO_READ_CACHE;
