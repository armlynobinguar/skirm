// Request rate limits: a tight bucket for NEAR-RPC and paid-work routes, a loose one for the rest,
// counted per client per minute; 429 rate_limited with Retry-After; /health never limited.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryRateLimitStore, bucketOf, clientOf, type RateLimitStore } from '../src/rate-limit';
import { setup, type Harness } from './helpers';

describe('rate limit buckets', () => {
  it('puts NEAR-RPC, paid-work and sign-in routes in the strict bucket', () => {
    expect(bucketOf('POST', '/auth/session')).toBe('strict');
    expect(bucketOf('POST', '/credits/deposits')).toBe('strict');
    expect(bucketOf('POST', '/rentals/rof_1')).toBe('strict');
    expect(bucketOf('POST', '/puzzles/pz_1/runs')).toBe('strict');
    expect(bucketOf('POST', '/backing/sync')).toBe('strict');
    expect(bucketOf('POST', '/backing/rounds/br_1/back')).toBe('strict');
    expect(bucketOf('POST', '/achievements/first_win/badge')).toBe('strict');
    expect(bucketOf('POST', '/tournaments')).toBe('strict');
    expect(bucketOf('POST', '/tournaments/t_1/join')).toBe('general');
    expect(bucketOf('POST', '/market/skl_1/purchase')).toBe('strict');
    expect(bucketOf('POST', '/market/skl_1/trial')).toBe('strict');
    expect(bucketOf('POST', '/skills/skl_1/mint')).toBe('strict');
    expect(bucketOf('POST', '/relay')).toBe('strict');
    expect(bucketOf('GET', '/relay')).toBe('general');
    expect(bucketOf('GET', '/rentals')).toBe('general');
    expect(bucketOf('GET', '/market/skl_1')).toBe('general');
  });

  it('counts the first forwarded hop, else the socket address', () => {
    // The client-supplied entries come first; the trusted proxy appends the real address last.
    expect(clientOf({ headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, ip: '10.0.0.1' })).toBe('203.0.113.7');
    expect(clientOf({ headers: { 'x-forwarded-for': '203.0.113.7' }, ip: '10.0.0.1' })).toBe('203.0.113.7');
    // Behind a load balancer (2 hops) the client is the second entry from the end.
    expect(clientOf({ headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.7, 10.0.0.1' }, ip: '10.0.0.1' }, 2)).toBe('203.0.113.7');
    expect(clientOf({ headers: {}, ip: '198.51.100.2' })).toBe('198.51.100.2');
  });

  it('counts in fixed windows', async () => {
    const clock = { now: 0 };
    const store = new MemoryRateLimitStore(() => clock.now);
    expect(await store.hit('k', 60_000)).toBe(1);
    expect(await store.hit('k', 60_000)).toBe(2);
    clock.now = 60_000;
    expect(await store.hit('k', 60_000)).toBe(1);
  });
});

describe('rate limits over the api', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setup({ rateLimit: { store: new MemoryRateLimitStore(), limits: { strict: 3, general: 5 } } });
  });
  afterAll(() => h.close());

  it('refuses a client over the strict limit with 429 and Retry-After, per client', async () => {
    const signIn = (ip: string, handle: string) => h.http().post('/auth/session').set('x-forwarded-for', ip).set('x-dev-user', handle).send({});
    for (let i = 0; i < 3; i++) expect((await signIn('203.0.113.1', `u${i}`)).status).toBe(200);
    const over = await signIn('203.0.113.1', 'u9');
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('rate_limited');
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    // Another client has its own count.
    expect((await signIn('203.0.113.2', 'v0')).status).toBe(200);
  });

  it('limits other routes on the general bucket, and never the health check', async () => {
    const get = () => h.http().get('/seasons').set('x-forwarded-for', '198.51.100.9');
    for (let i = 0; i < 5; i++) expect((await get()).status).not.toBe(429);
    expect((await get()).status).toBe(429);
    for (let i = 0; i < 10; i++) expect((await h.http().get('/health').set('x-forwarded-for', '198.51.100.9')).status).toBe(200);
  });
});

describe('a counter outage', () => {
  let h: Harness;
  const broken: RateLimitStore = { hit: () => Promise.reject(new Error('redis down')) };
  beforeAll(async () => {
    h = await setup({ rateLimit: { store: broken, limits: { strict: 1, general: 1 } } });
  });
  afterAll(() => h.close());

  it('lets requests through rather than taking the api down', async () => {
    for (let i = 0; i < 3; i++) expect((await h.http().get('/seasons')).status).toBe(200);
  });
});
