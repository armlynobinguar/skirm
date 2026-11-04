import { describe, expect, it } from 'vitest';
import {
  ProofRepo,
  STARTER_SKILL,
  TRIAL_LIMIT,
  versionKey,
  type Db,
  type V2CrewRecord,
} from '../src/index';
import { setup, signUp, type Ctx } from './helpers';

const meta = {
  name: 'Gem Rush',
  summary: 'Grabs the gems.',
  requiresActions: [] as [],
  handlesTags: ['collectible' as const],
  royaltyBps: 500,
};

const agent = (id: string, skills: { id: string; version: number }[]): V2CrewRecord => ({
  id,
  name: id,
  role: 'Runner',
  vision: 3,
  comms: 3,
  tier: 'standard',
  skills,
});

async function skill(ctx: Ctx, creator: string, name: string) {
  const s = await ctx.repos.skills.create(
    creator,
    { ...meta, name },
    await ctx.sealer.encryptSkill(name),
  );
  return { id: s.id, version: 1 };
}

/** Counts statements a repo sends through `execute` and the query builders. */
function counting(db: Db): { db: Db; count: () => number } {
  let n = 0;
  const proxy = new Proxy(db, {
    get(obj, prop) {
      const v = Reflect.get(obj, prop) as unknown;
      if (typeof v !== 'function') return v;
      if (
        ['execute', 'select', 'insert', 'update', 'delete', 'transaction'].includes(prop as string)
      )
        return (...args: unknown[]) => {
          n++;
          return (v as (...a: unknown[]) => unknown).apply(obj, args);
        };
      return (v as (...a: unknown[]) => unknown).bind(obj);
    },
  });
  return { db: proxy, count: () => n };
}

describe('skill benchmarks', () => {
  it('queue once, claim once, and store no score for a greedy brain', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const gem = await skill(ctx, ana.id, 'Gem Rush');
    const { proof } = ctx.repos;

    expect(await proof.benchmark(gem.id, 1)).toBeUndefined();
    expect(await proof.enqueueBenchmark(gem.id, 1)).toMatchObject({
      status: 'queued',
      score: null,
      matches: 0,
    });
    expect((await proof.enqueueBenchmark(gem.id, 1)).status).toBe('queued');
    expect(await proof.claimBenchmark(gem.id, 1)).toMatchObject({ status: 'running' });
    expect(await proof.claimBenchmark(gem.id, 1)).toBeUndefined();

    const result = {
      brain: 'greedy',
      matches: 6,
      wins: 4,
      losses: 2,
      draws: 0,
      deliveries: 3,
      leaks: 0,
      manipulations: 0,
      score: 0.66,
    };
    const done = await proof.finishBenchmark(gem.id, 1, result);
    expect(done).toMatchObject({ status: 'done', brain: 'greedy', wins: 4, score: null });
    expect(done.finishedAt).toBeInstanceOf(Date);
    // A finished benchmark is never queued again.
    expect((await proof.enqueueBenchmark(gem.id, 1)).status).toBe('done');

    const model = await skill(ctx, ana.id, 'Model');
    await proof.enqueueBenchmark(model.id, 1);
    expect(
      await proof.finishBenchmark(model.id, 1, {
        ...result,
        brain: 'model',
        leaks: 1,
        score: 0.5,
        results: [{ map: 'copper-hollow' }],
      }),
    ).toMatchObject({ status: 'done', score: 0.5, leaks: 1, results: [{ map: 'copper-hollow' }] });

    const offline = await skill(ctx, ana.id, 'Offline');
    await proof.enqueueBenchmark(offline.id, 1);
    expect(await proof.markNeedsModel(offline.id, 1)).toMatchObject({
      status: 'needs_model',
      brain: 'greedy',
      matches: 0,
      score: null,
    });

    const broken = await skill(ctx, ana.id, 'Broken');
    await proof.enqueueBenchmark(broken.id, 1);
    expect(await proof.failBenchmark(broken.id, 1, 'x'.repeat(900))).toMatchObject({
      status: 'failed',
    });
    expect((await proof.benchmark(broken.id, 1))!.error).toHaveLength(500);
    await expect(proof.markNeedsModel('skl_nope', 1)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('ranked records', () => {
  it('a ranked finish records each carried version once; casual and void matches do not', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const gem = await skill(ctx, ana.id, 'Gem Rush');
    const wall = await skill(ctx, ben.id, 'Wall');
    const starter = { id: STARTER_SKILL.id, version: 1 };
    const crews = {
      A: [agent('a1', [gem, starter]), agent('a2', [gem])],
      B: [agent('b1', [wall, starter])],
    };
    const play = async (mapId: string, winner: 'A' | 'B' | 'draw' | null, ranked = true) => {
      const m = await ctx.repos.v2Matches.create({
        mapId,
        ranked,
        teamA: ana.id,
        teamB: ben.id,
        crews,
      });
      return ctx.repos.v2Matches.finish(m.id, { winner, reason: 'goal', crews });
    };

    const first = await play('copper-hollow', 'B');
    await ctx.repos.v2Matches.finish(first.id, { winner: 'A', reason: 'goal', crews });
    await play('copper-hollow', 'A');
    await play('basalt-stair', 'draw');
    await play('basalt-stair', 'A', false);
    await play('basalt-stair', null);

    expect(await ctx.repos.proof.rankedRecord(gem.id, 1)).toEqual({
      matches: 3,
      wins: 1,
      losses: 1,
      draws: 1,
      perMap: [
        { mapId: 'copper-hollow', matches: 2, wins: 1, losses: 1, draws: 0 },
        { mapId: 'basalt-stair', matches: 1, wins: 0, losses: 0, draws: 1 },
      ],
    });
    // The starter skill was on both crews: one row per team.
    expect((await ctx.repos.proof.rankedRecord(starter.id, 1)).matches).toBe(6);
    expect(await ctx.repos.proof.rankedRecord('skl_none', 1)).toEqual({
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      perMap: [],
    });

    // Counters: who Gem Rush faced, the ones it lost to first.
    expect(await ctx.repos.proof.counters(gem.id, 1)).toEqual(
      [
        { skillId: starter.id, version: 1, matches: 3, wins: 1, losses: 1, draws: 1 },
        { skillId: wall.id, version: 1, matches: 3, wins: 1, losses: 1, draws: 1 },
      ].sort((x, y) => x.skillId.localeCompare(y.skillId)),
    );
    expect(await ctx.repos.proof.counters(wall.id, 1, 1)).toHaveLength(1);
  });

  it('marketRates answers many versions in one query, null-safe', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const gem = await skill(ctx, ana.id, 'Gem Rush');
    const wall = await skill(ctx, ben.id, 'Wall');
    const idle = await skill(ctx, ben.id, 'Idle');
    const crews = { A: [agent('a1', [gem])], B: [agent('b1', [wall])] };
    for (const winner of ['A', 'A', 'B'] as const) {
      const m = await ctx.repos.v2Matches.create({
        mapId: 'copper-hollow',
        ranked: true,
        teamA: ana.id,
        teamB: ben.id,
        crews,
      });
      await ctx.repos.v2Matches.finish(m.id, { winner, reason: 'goal' });
    }
    await ctx.repos.proof.enqueueBenchmark(gem.id, 1);
    await ctx.repos.proof.finishBenchmark(gem.id, 1, {
      brain: 'model',
      matches: 6,
      wins: 3,
      losses: 3,
      draws: 0,
      deliveries: 2,
      leaks: 0,
      manipulations: 0,
      score: 0.5,
    });
    await ctx.repos.proof.enqueueBenchmark(wall.id, 1);
    await ctx.repos.proof.markNeedsModel(wall.id, 1);

    const c = counting(ctx.db);
    const keys = [gem, wall, idle].map((s) => ({ skillId: s.id, version: s.version }));
    const rates = await new ProofRepo(c.db).marketRates([
      ...keys,
      { skillId: 'skl_unknown', version: 2 },
    ]);
    expect(c.count()).toBe(1);
    expect(rates.get(versionKey(gem.id, 1))).toEqual({
      rankedMatches: 3,
      rankedWins: 2,
      rankedWinRate: 2 / 3,
      benchmarkScore: 0.5,
      benchmarkStatus: 'done',
    });
    expect(rates.get(versionKey(wall.id, 1))).toEqual({
      rankedMatches: 3,
      rankedWins: 1,
      rankedWinRate: 1 / 3,
      benchmarkScore: null,
      benchmarkStatus: 'needs_model',
    });
    expect(rates.get(versionKey(idle.id, 1))).toEqual({
      rankedMatches: 0,
      rankedWins: 0,
      rankedWinRate: null,
      benchmarkScore: null,
      benchmarkStatus: null,
    });
    expect(rates.get(versionKey('skl_unknown', 2))?.rankedMatches).toBe(0);
    expect((await new ProofRepo(c.db).marketRates([])).size).toBe(0);
    expect(c.count()).toBe(1);

    // Two listings of the same version (two sellers) count its matches once.
    const twice = await ctx.repos.proof.marketRates([keys[0]!, keys[1]!, keys[0]!]);
    expect(twice.size).toBe(2);
    expect(twice.get(versionKey(gem.id, 1))).toEqual(rates.get(versionKey(gem.id, 1)));
  });
});

describe('trials', () => {
  it(`caps a buyer at ${TRIAL_LIMIT} trials per version; needs_model trials do not count`, async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const gem = await skill(ctx, ana.id, 'Gem Rush');
    const [rook] = await ctx.repos.agents.listByOwner(ben.id);
    const input = { accountId: ben.id, skillId: gem.id, version: 1, agentId: rook!.id };
    const { proof } = ctx.repos;

    const offline = await proof.createTrial(input);
    expect(offline).toMatchObject({ status: 'queued', accountId: ben.id });
    expect(offline.id).toMatch(/^trl_/);
    await proof.finishTrial(offline.id, { status: 'needs_model' });

    const t1 = await proof.createTrial(input);
    expect(await proof.claimTrial(t1.id)).toMatchObject({ status: 'running' });
    expect(await proof.claimTrial(t1.id)).toBeUndefined();
    const done = await proof.finishTrial(t1.id, { status: 'done', results: [{ winner: 'A' }] });
    expect(done).toMatchObject({ status: 'done', results: [{ winner: 'A' }] });
    expect(done.finishedAt).toBeInstanceOf(Date);
    await proof.createTrial(input);
    const t3 = await proof.createTrial(input);
    await proof.finishTrial(t3.id, { status: 'failed' }); // a failed trial still counts

    await expect(proof.createTrial(input)).rejects.toMatchObject({
      code: 'trial_limit',
      details: { limit: 3, used: 3 },
    });
    expect(await proof.trialsUsed(ben.id, gem.id, 1)).toBe(3);
    expect((await proof.trials(ben.id, gem.id)).map((t) => t.status).sort()).toEqual([
      'done',
      'failed',
      'needs_model',
      'queued',
    ]);
    expect(await proof.trial(t1.id)).toMatchObject({ id: t1.id, status: 'done' });

    // Another version, another buyer: their own caps.
    await proof.createTrial({ ...input, version: 2 });
    await proof.createTrial({ ...input, accountId: ana.id });
    await expect(proof.finishTrial('trl_nope', { status: 'done' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('concurrent requests cannot pass the cap together', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const gem = await skill(ctx, ana.id, 'Gem Rush');
    const input = { accountId: ben.id, skillId: gem.id, version: 1, agentId: 'agt_x' };
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => ctx.repos.proof.createTrial(input)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(TRIAL_LIMIT);
    expect(await ctx.repos.proof.trialsUsed(ben.id, gem.id, 1)).toBe(TRIAL_LIMIT);
  });
});
