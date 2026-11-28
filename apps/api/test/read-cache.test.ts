// The Redis read cache: hits, TTLs, scope invalidation, Redis down, and the api's writes dropping
// what they change.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisReadCache } from '../src/read-cache';
import { SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

/** The four commands the cache uses, over a Map (TTLs recorded, not enforced). */
class FakeRedis {
  data = new Map<string, string>();
  ttls = new Map<string, number>();
  down = false;
  hang = false;
  private gate<T>(v: () => T): Promise<T> {
    if (this.hang) return new Promise(() => {});
    return this.down ? Promise.reject(new Error('connection refused')) : Promise.resolve(v());
  }
  get(k: string) {
    return this.gate(() => this.data.get(k) ?? null);
  }
  set(k: string, v: string, _ex: 'EX', ttl: number) {
    return this.gate(() => {
      this.data.set(k, v);
      this.ttls.set(k, ttl);
      return 'OK' as const;
    });
  }
  incr(k: string) {
    return this.gate(() => {
      const n = Number(this.data.get(k) ?? 0) + 1;
      this.data.set(k, String(n));
      return n;
    });
  }
  expire(k: string, ttl: number) {
    return this.gate(() => {
      this.ttls.set(k, ttl);
      return 1 as const;
    });
  }
}

const cacheOver = (r: FakeRedis, timeoutMs = 50) => new RedisReadCache(r as never, timeoutMs);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('RedisReadCache', () => {
  it('loads once, then answers from Redis with the TTL it was given', async () => {
    const r = new FakeRedis();
    const cache = cacheOver(r);
    let loads = 0;
    const load = async () => ({ n: ++loads });
    expect(await cache.read('s', 'k', 30, load)).toEqual({ n: 1 });
    await flush();
    expect(await cache.read('s', 'k', 30, load)).toEqual({ n: 1 });
    expect(loads).toBe(1);
    expect([...r.ttls.values()]).toEqual([30]);
  });

  it('invalidate drops the whole scope and leaves other scopes', async () => {
    const r = new FakeRedis();
    const cache = cacheOver(r);
    let loads = 0;
    const load = async () => ++loads;
    await cache.read('a', 'x', 30, load);
    await cache.read('b', 'x', 30, load);
    await flush();
    await cache.invalidate('a');
    expect(await cache.read('a', 'x', 30, load)).toBe(3);
    expect(await cache.read('b', 'x', 30, load)).toBe(2);
  });

  it('reloads a corrupt entry', async () => {
    const r = new FakeRedis();
    const cache = cacheOver(r);
    r.data.set('cache:v1:s:0:k', '{nope');
    expect(await cache.read('s', 'k', 30, async () => 7)).toBe(7);
  });

  it('goes to the database when Redis is down or slow, and never throws', async () => {
    for (const mode of ['down', 'hang'] as const) {
      const r = new FakeRedis();
      r[mode] = true;
      const cache = cacheOver(r, 20);
      let loads = 0;
      expect(await cache.read('s', 'k', 30, async () => ++loads)).toBe(1);
      expect(await cache.read('s', 'k', 30, async () => ++loads)).toBe(2);
      await expect(cache.invalidate('s')).resolves.toBeUndefined();
    }
  });

  it('passes a load error through', async () => {
    const cache = cacheOver(new FakeRedis());
    await expect(cache.read('s', 'k', 30, async () => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
  });
});

describe('cached api reads', () => {
  let h: Harness;
  let seller: UserClient;
  let buyer: UserClient;
  let skillId: string;
  beforeAll(async () => {
    h = await setup({ deps: { readCache: cacheOver(new FakeRedis()) } });
    seller = await h.as('seller');
    buyer = await h.as('buyer');
    skillId = (await seller.post('/skills', SAMPLE_SKILL)).body.id;
    await seller.post(`/skills/${skillId}/mint`);
  });
  afterAll(() => h.close());

  it('the market shows a new listing and sale at once, with the caller’s own `owned`', async () => {
    expect((await buyer.get('/market')).body[0]).toMatchObject({ priceYocto: null, owned: false });
    expect((await seller.get('/market')).body[0]).toMatchObject({ owned: true });
    const listed = await seller.post(`/market/${skillId}/listing`, { priceYocto: '1000', txHash: 'approve-tx' });
    expect(listed.status).toBe(200);
    expect((await buyer.get('/market')).body[0]).toMatchObject({ priceYocto: '1000', skill: { status: 'Listed' } });
    const bought = await buyer.post(`/market/${skillId}/purchase`, { txHash: 'dev:1000' });
    expect(bought.status).toBe(200);
    expect((await buyer.get('/market')).body[0]).toMatchObject({ priceYocto: null, owned: true });
  });

  it('seasons and the ladder answer the same from the cache, with the caller’s own row', async () => {
    const first = await buyer.get('/seasons/current');
    const again = await buyer.get('/seasons/current');
    expect(first.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await buyer.get(`/seasons/${first.body.season.id}/standings`)).body).toEqual({ rows: [], total: 0 });
    expect((await buyer.get('/seasons/ssn_01M8GVV0E6G179R4QFK9QZ7PJS/standings')).status).toBe(404);
    expect((await buyer.get('/leaderboards/players')).body).toEqual({ rows: [] });
  });
});
