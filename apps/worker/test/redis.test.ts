// End to end over real Redis (opt-in): a BullMQ `registry` job for a ranked v2 match → the registry
// consumer → record_match (NoopRegistry) → the status and tx hash on the row.
//   TEST_REDIS_URL=redis://localhost:6379 npx vitest run test/redis.test.ts
// BullMQ keys go to Redis database 13 so a dev worker on database 0 never takes these jobs.
import { afterAll, describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY, createQueue, createRedis } from '@skirm/server';
import { bullRegistryQueue, startConsumers } from '../src/app';
import { setup, type Ctx } from './helpers';

const BASE = process.env.TEST_REDIS_URL;
const url = (() => {
  if (!BASE) return '';
  const u = new URL(BASE);
  u.pathname = '/13';
  return u.toString();
})();

describe.skipIf(!BASE)('worker over real Redis', () => {
  const closers: (() => Promise<unknown>)[] = [];
  let ctx: Ctx | undefined;
  afterAll(async () => {
    for (const c of closers.reverse()) await c().catch(() => undefined);
    await ctx?.cleanup();
  });

  it('records a ranked v2 match from a queued registry job', async () => {
    const redis = createRedis(url);
    const conn = createRedis(url);
    const registryQueue = createQueue(QUEUE_REGISTRY, redis);
    closers.push(
      () => redis.quit(),
      () => conn.quit(),
      () => registryQueue.obliterate({ force: true }).then(() => registryQueue.close()),
    );
    ctx = await setup();
    const a = await ctx.repos.accounts.getOrCreate({ handle: 'redis-a' }, ctx.vault);
    const b = await ctx.repos.accounts.getOrCreate({ handle: 'redis-b' }, ctx.vault);
    const [a1] = await ctx.repos.agents.listByOwner(a.account.id);
    const [b1] = await ctx.repos.agents.listByOwner(b.account.id);
    const crew = (id: string) => ({
      id,
      name: id,
      role: 'Runner',
      vision: 3,
      comms: 3,
      tier: 'standard',
    });
    const m = await ctx.repos.v2Matches.create({
      mapId: 'copper-hollow',
      ranked: true,
      teamA: a.account.id,
      teamB: b.account.id,
      crews: { A: [crew(a1!.id)], B: [crew(b1!.id)] },
    });
    await ctx.repos.v2Matches.finish(m.id, {
      winner: 'A',
      reason: 'goal',
      decidedBy: 'goal',
      score: { A: 2, B: 0 },
      ticks: 60,
      logHash: 'f'.repeat(64),
    });

    const consumers = startConsumers(ctx.deps, conn);
    closers.unshift(() => Promise.all(Object.values(consumers).map((w) => w.close())));
    await bullRegistryQueue(registryQueue).enqueue({ kind: 'v2_match', id: m.id });

    for (let i = 0; i < 100; i++) {
      const row = await ctx.repos.v2Matches.get(m.id);
      if (row?.registryTx) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const row = (await ctx.repos.v2Matches.get(m.id))!;
    expect(row.registryStatus).toBe('local');
    expect(row.registryTx).toMatch(/^noop:/);
    expect(ctx.registry.matches).toHaveLength(1);
    expect(await registryQueue.getJob(`registry-v2_match-${m.id}`)).toBeTruthy();
  });
});
