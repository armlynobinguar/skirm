// Request rate limits. Every request counts against its client (the first X-Forwarded-For hop on
// Cloud Run, else the socket address) in fixed one-minute windows: a tight bucket for the routes
// that call NEAR RPC or start paid work, a loose one for everything else. Over the limit: 429
// `rate_limited` with Retry-After. Counters live in Redis in production (shared by every
// instance), in memory in tests and local runs. Edge protection (Cloud Armor) still belongs in
// front of Cloud Run; this keeps a single client from flooding RPC or the queues on its own.
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './errors';

export interface RateLimitStore {
  /** Adds one hit to `key` in a window of `windowMs`; resolves with the count so far. */
  hit(key: string, windowMs: number): Promise<number>;
}

/** Per-process counters (tests, local runs). Old windows are dropped as new ones start. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counts = new Map<string, { window: number; n: number }>();
  constructor(private readonly clock: () => number = () => Date.now()) {}
  async hit(key: string, windowMs: number): Promise<number> {
    const window = Math.floor(this.clock() / windowMs);
    const c = this.counts.get(key);
    const n = c && c.window === window ? c.n + 1 : 1;
    this.counts.set(key, { window, n });
    if (this.counts.size > 50_000) for (const [k, v] of this.counts) if (v.window !== window) this.counts.delete(k);
    return n;
  }
}

/** Shared counters: INCR plus a TTL on the window's key (ioredis-compatible client). */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: { incr(k: string): Promise<number>; pexpire(k: string, ms: number): Promise<number> }) {}
  async hit(key: string, windowMs: number): Promise<number> {
    const k = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.pexpire(k, windowMs);
    return n;
  }
}

export interface RateLimits {
  /** Requests a client may make per minute to the NEAR-RPC and paid-work routes. */
  strict: number;
  /** Requests a client may make per minute to every other route. */
  general: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { strict: 20, general: 300 };

/** Routes that call NEAR RPC, start paid work, or create accounts: METHOD and a path pattern. */
const STRICT: readonly [string, RegExp][] = [
  ['POST', /^\/auth\/session$/],
  ['POST', /^\/credits\/deposits$/],
  ['POST', /^\/rentals\/[^/]+$/],
  ['POST', /^\/market\/[^/]+\/(purchase|listing|trial)$/],
  ['POST', /^\/skills\/[^/]+\/mint$/],
  ['POST', /^\/cosmetics\/[^/]+\/buy$/],
  ['POST', /^\/external-agents\/[^/]+\/ping$/],
];

export function bucketOf(method: string, path: string): 'strict' | 'general' {
  return STRICT.some(([m, re]) => m === method && re.test(path)) ? 'strict' : 'general';
}

/** The client a request counts against: the first X-Forwarded-For hop (Cloud Run's front end sets it), else the socket. */
export function clientOf(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.ip || req.socket?.remoteAddress || 'unknown';
}

const WINDOW_MS = 60_000;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly store: RateLimitStore,
    private readonly limits: RateLimits,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ method: string; path: string; headers: Record<string, string | string[] | undefined>; ip?: string }>();
    // The health check stays reachable for the platform's probes.
    if (req.path === '/health') return true;
    const bucket = bucketOf(req.method, req.path);
    const limit = this.limits[bucket];
    let n: number;
    try {
      n = await this.store.hit(`${bucket}:${clientOf(req)}`, WINDOW_MS);
    } catch {
      // A counter outage must not take the api down with it: let the request through.
      return true;
    }
    if (n > limit) {
      const res = ctx.switchToHttp().getResponse<Response>();
      res.setHeader('Retry-After', String(Math.ceil((WINDOW_MS - (Date.now() % WINDOW_MS)) / 1000)));
      throw new ApiError(429, 'rate_limited', 'too many requests, slow down');
    }
    return true;
  }
}
