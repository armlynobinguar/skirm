// Official starter skills seed: sealed text, the benchmark queued at mint, mint, listing, nothing
// recorded, and idempotency (repeat and concurrent seeds converge on the same state).
import { afterEach, describe, expect, it } from 'vitest';
import { ID_PATTERN, OFFICIAL_AGENTS, OFFICIAL_SKILLS, SYSTEM_ACCOUNT_ID } from '@skirm/db';
import { NoopMinter } from '@skirm/server';
import { seedOfficialSkills } from '../src/seed';
import { setup, type Ctx } from './helpers';

describe('official skills seed', () => {
  let ctx: Ctx | undefined;
  afterEach(async () => {
    await ctx?.cleanup();
    ctx = undefined;
  });

  const seed = (c: Ctx, minter = new NoopMinter()) =>
    seedOfficialSkills(c.deps, { db: c.db, sealer: c.vault, minter });

  it('defines the official skills with valid, unique ids and Spec §9 limits', () => {
    expect(new Set(OFFICIAL_SKILLS.map((d) => d.id)).size).toBe(OFFICIAL_SKILLS.length);
    for (const d of OFFICIAL_SKILLS) {
      expect(d.id).toMatch(ID_PATTERN);
      expect(d.name).toMatch(/^[A-Za-z0-9 '-]{3,32}$/);
      expect(d.summary.length).toBeLessThanOrEqual(140);
      expect(d.prompt.length).toBeGreaterThan(0);
      expect(d.prompt.length).toBeLessThanOrEqual(1200);
      expect(d.reflexes.length).toBeLessThanOrEqual(400);
    }
    for (const a of OFFICIAL_AGENTS) expect(a.id).toMatch(ID_PATTERN);
  });

  it('seeds sealed, minted, listed skills with a queued benchmark each, and records nothing', async () => {
    ctx = await setup();
    const minter = new NoopMinter();
    const report = await seed(ctx, minter);
    expect(report.skills.map((s) => [s.created, s.minted, s.listed, s.benchmark])).toEqual(
      OFFICIAL_SKILLS.map(() => [true, true, true, 'queued']),
    );
    expect(minter.minted.map((m) => m.id)).toEqual(OFFICIAL_SKILLS.map((d) => d.id));

    const listings = await ctx.repos.market.activeListings();
    expect(listings).toHaveLength(OFFICIAL_SKILLS.length);
    for (const def of OFFICIAL_SKILLS) {
      const v = (await ctx.repos.skills.get(def.id, 1))!;
      expect(v).toMatchObject({
        name: def.name,
        creatorId: SYSTEM_ACCOUNT_ID,
        accountBound: false,
        status: 'listed',
        tokenId: `${def.id}:1`,
      });
      expect(listings.find((l) => l.skillId === def.id)).toMatchObject({
        sellerId: SYSTEM_ACCOUNT_ID,
        priceYocto: def.priceYocto,
      });
      // The prompt is sealed like any skill: ciphertext only, decryptable by the vault.
      const sealed = (await ctx.repos.skills.loadSealed(def.id, 1))!;
      expect(Buffer.from(sealed.ciphertext).toString('utf8')).not.toContain(
        def.prompt.slice(0, 20),
      );
      expect(await ctx.vault.decryptSkill(sealed)).toEqual({
        prompt: def.prompt,
        reflexes: def.reflexes,
      });
      // The hidden benchmark is queued at mint, as for a player's skill.
      expect(await ctx.repos.proof.benchmark(def.id, 1)).toMatchObject({ status: 'queued' });
    }
    expect(ctx.benchmarkQueue.jobs).toEqual(
      OFFICIAL_SKILLS.map((d) => ({ kind: 'mint', skillId: d.id, version: 1 })),
    );

    // Nothing is played or queued for the registry.
    expect(await ctx.repos.v2Matches.listForAccount(SYSTEM_ACCOUNT_ID, 1000)).toEqual([]);
    expect(ctx.registryQueue.jobs).toEqual([]);
  });

  it('is idempotent: a second seed adds nothing and resends only benchmarks still queued', async () => {
    ctx = await setup();
    await seed(ctx);
    // The benchmark worker finished the first one meanwhile.
    const first = OFFICIAL_SKILLS[0]!;
    await ctx.repos.proof.markNeedsModel(first.id, 1);
    ctx.benchmarkQueue.jobs.length = 0;

    const again = await seed(ctx);
    expect(again.skills.every((s) => !s.created && !s.minted && !s.listed)).toBe(true);
    expect(again.skills[0]!.benchmark).toBe('needs_model');
    expect(ctx.benchmarkQueue.jobs.map((j) => (j.kind === 'mint' ? j.skillId : j.trialId))).toEqual(
      OFFICIAL_SKILLS.slice(1).map((d) => d.id),
    );
    expect(await ctx.repos.market.activeListings()).toHaveLength(OFFICIAL_SKILLS.length);
    expect(ctx.registryQueue.jobs).toEqual([]);
  });

  it('concurrent seeds converge on one set of skills and listings', async () => {
    ctx = await setup();
    const [a, b] = await Promise.all([seed(ctx), seed(ctx)]);
    const created = [...a.skills, ...b.skills].filter((s) => s.created).length;
    expect(created).toBe(OFFICIAL_SKILLS.length);
    expect(await ctx.repos.market.activeListings()).toHaveLength(OFFICIAL_SKILLS.length);
  });

  it('does not relist a sold skill', async () => {
    ctx = await setup();
    await seed(ctx);
    // A player bought Gate Keeper: the system account no longer holds it.
    const gk = OFFICIAL_SKILLS[0]!;
    const { account: buyer } = await ctx.repos.accounts.getOrCreate({ handle: 'buyer' }, ctx.vault);
    await ctx.repos.market.recordSale({
      skillId: gk.id,
      version: 1,
      buyerId: buyer.id,
      priceYocto: gk.priceYocto,
      txHash: 'dev:test-sale',
    });

    const report = await seed(ctx);
    expect(report.skills.every((s) => !s.listed)).toBe(true);
    expect(await ctx.repos.market.activeListing(gk.id, 1)).toBeUndefined();
  });

  it('retries a failed mint on the next seed, with the benchmark already queued', async () => {
    ctx = await setup();
    const broken = new NoopMinter();
    broken.mint = async () => {
      throw Object.assign(new Error('rpc down'), { code: 'rpc_unavailable' });
    };
    const first = await seed(ctx, broken);
    expect(first.skills.every((s) => s.created && !s.minted && !s.listed)).toBe(true);
    expect(first.skills.every((s) => s.benchmark === 'queued')).toBe(true);
    const second = await seed(ctx);
    expect(second.skills.every((s) => !s.created && s.minted && s.listed)).toBe(true);
  });
});

// Opt-in: TEST_DATABASE_URL set to a THROWAWAY server; the test seeds its own scratch database.
// Two pools stand in for two worker processes: the session advisory lock serialises their seeds.
const pgUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!pgUrl)('official skills seed on real Postgres', () => {
  it('two workers booting at once seed exactly once', async () => {
    const { closeDb, createDb, createRepos, migrate } = await import('@skirm/db');
    const { scratchDatabase } = await import('@skirm/db/testing');
    const scratch = await scratchDatabase(pgUrl!, 'worker_seed');
    const url = scratch.url;
    const admin = createDb(url, { max: 1 });
    await migrate(admin);
    await closeDb(admin);
    const base = await setup();
    const pools = [createDb(url, { max: 4 }), createDb(url, { max: 4 })];
    try {
      const reports = await Promise.all(
        pools.map((db) =>
          seedOfficialSkills(
            { ...base.deps, repos: createRepos(db) },
            { db, sealer: base.vault, minter: new NoopMinter() },
          ),
        ),
      );
      const created = reports.flatMap((r) => r.skills).filter((s) => s.created).length;
      expect(created).toBe(OFFICIAL_SKILLS.length);
      const repos = createRepos(pools[0]!);
      expect(await repos.market.activeListings()).toHaveLength(OFFICIAL_SKILLS.length);
      for (const s of reports.flatMap((r) => r.skills)) expect(s.listed).toBe(true === s.minted);
    } finally {
      for (const p of pools) await closeDb(p);
      await base.cleanup();
      await scratch.drop();
    }
  });
});
