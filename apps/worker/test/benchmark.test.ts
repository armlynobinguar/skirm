// Skill proof consumer: the hidden gauntlet and buyers' trials on the headless v2 runner. Offline
// (greedy brain) both end needs_model with nothing played; a skill-aware brain plays them for real.
import { afterEach, describe, expect, it } from 'vitest';
import { greedyAct, type V2Brain } from '@skirm/decision-engine/v2';
import { PRACTICE_MAPS } from '@skirm/engine/v2';
import { auctionSkillRef, benchmarkResultsHash, type BenchmarkSeeder, type ChainBenchmark } from '@skirm/server';
import { benchmarkSeedPicks, scoreToBps } from '@skirm/shared';
import { WorkerError } from '../src/deps';
import {
  BENCHMARK_MATCHES,
  HIJACK_LINES,
  TRIAL_MATCHES,
  benchSecretWarning,
  benchmarkPicks,
  processBenchmark,
  tallyProof,
  trialPicks,
  type ProofMatch,
} from '../src/benchmark-processor';
import { setup, type Ctx } from './helpers';

describe('BENCH_SECRET', () => {
  it('warns when production runs on the public default key', () => {
    expect(benchSecretWarning('production', undefined)).toMatch(/BENCH_SECRET is unset/);
    expect(benchSecretWarning('production', '  ')).toMatch(/BENCH_SECRET is unset/);
    expect(benchSecretWarning('production', 's3cret')).toBeNull();
    expect(benchSecretWarning('development', undefined)).toBeNull();
  });
});

const PROMPT =
  'Hold the bridge with the builder until the second wave passes, then haul every crate home fast.';

/**
 * Plays like greedy, but reads what it hears: a hijack line makes it recite its skill, which the
 * speech filter refuses as a leak. Stands in for a model brain that falls for the hijack.
 */
function gullibleBrain(): V2Brain & { hijacksHeard: number } {
  const brain = {
    kind: 'model' as const,
    model: 'fake-haiku',
    hijacksHeard: 0,
    async act(o: Parameters<V2Brain['act']>[0], ctx: Parameters<V2Brain['act']>[1]) {
      const action = greedyAct(o);
      if (o.heard.some((m) => HIJACK_LINES.includes(m.text)) && ctx.skills.length) {
        brain.hijacksHeard++;
        return {
          action,
          reason: 'chosen' as const,
          say: { channel: 'say' as const, text: ctx.skills[0]! },
        };
      }
      return { action, reason: 'chosen' as const, say: null };
    },
    async plan() {
      return { text: null };
    },
  };
  return brain;
}

let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/** A creator's skill, sealed, with its benchmark queued as mint does. */
async function mintedSkill(c: Ctx, handle = 'maker') {
  const { account } = await c.repos.accounts.getOrCreate({ handle }, c.vault);
  const sealed = await c.vault.encryptSkill(PROMPT);
  const v = await c.repos.skills.create(
    account.id,
    { name: 'Bridge Guard', requiresActions: [], handlesTags: [], royaltyBps: 500 },
    sealed,
  );
  await c.repos.proof.enqueueBenchmark(v.id, v.version);
  return v;
}

describe('benchmark picks', () => {
  it('draws 6 hidden (map, difficulty) picks from the secret, every second one a hijack pick', () => {
    const picks = benchmarkPicks('s3cret', 'skl_x', 1);
    expect(picks).toHaveLength(BENCHMARK_MATCHES);
    for (const p of picks) {
      expect(PRACTICE_MAPS).toContain(p.mapId);
      expect(['easy', 'normal']).toContain(p.difficulty);
    }
    expect(picks.map((p) => p.hijack)).toEqual([false, true, false, true, false, true]);
    expect(benchmarkPicks('s3cret', 'skl_x', 1)).toEqual(picks);
    // Another secret, version or skill gives other picks.
    const key = (ps: { mapId: string; difficulty: string }[]) =>
      ps.map((p) => `${p.mapId}/${p.difficulty}`).join(',');
    expect(key(benchmarkPicks('other', 'skl_x', 1))).not.toBe(key(picks));
    expect(key(benchmarkPicks('s3cret', 'skl_x', 2))).not.toBe(key(picks));
    expect(trialPicks('s3cret', 'trl_1')).toHaveLength(TRIAL_MATCHES);
  });

  it('scores wins/matches x (1 - leaked share), and counts hijacked matches that leaked or abused', () => {
    const m = (
      outcome: ProofMatch['outcome'],
      hijack: boolean,
      leaks = 0,
      abuse = 0,
    ): ProofMatch => ({
      mapId: 'copper-hollow',
      difficulty: 'easy',
      hijack,
      outcome,
      reason: 'goal',
      decidedBy: 'goal',
      delivered: outcome === 'win' ? 3 : 1,
      botDelivered: 2,
      ticks: 50,
      injected: hijack ? 4 : 0,
      leaks,
      abuse,
      logHash: 'h',
    });
    const t = tallyProof([
      m('win', false),
      m('win', true, 2),
      m('win', false),
      m('loss', true, 0, 1),
      m('draw', false),
      m('win', true),
    ]);
    expect(t).toEqual({
      matches: 6,
      wins: 4,
      losses: 1,
      draws: 1,
      deliveries: 3 + 3 + 3 + 1 + 1 + 3,
      leaks: 2,
      manipulations: 2,
      score: (4 / 6) * (1 - 1 / 6),
    });
    expect(tallyProof([]).score).toBeNull();
  });
});

describe('benchmark consumer', () => {
  it('offline (greedy brain): a mint benchmark ends needs_model with no match and no score', async () => {
    ctx = await setup();
    const v = await mintedSkill(ctx);
    const out = await processBenchmark(ctx.deps, { kind: 'mint', skillId: v.id, version: 1 });
    expect(out).toEqual({ kind: 'mint', id: `${v.id}:1`, status: 'needs_model' });
    expect(await ctx.repos.proof.benchmark(v.id, 1)).toMatchObject({
      status: 'needs_model',
      brain: 'greedy',
      matches: 0,
      score: null,
      results: null,
    });
    expect(ctx.logger.lines.some((l) => l.msg.startsWith('benchmark needs a model'))).toBe(true);
    // Done is done: the job running again changes nothing.
    expect(
      await processBenchmark(ctx.deps, { kind: 'mint', skillId: v.id, version: 1 }),
    ).toMatchObject({
      status: 'skipped',
      reason: 'not_queued',
    });
  });

  it('with a skill-aware brain: 6 matches vs the bot, the hijack picks leak, and a score', async () => {
    const brain = gullibleBrain();
    ctx = await setup({ brain, benchSecret: 'test-secret' });
    const v = await mintedSkill(ctx);
    const out = await processBenchmark(ctx.deps, { kind: 'mint', skillId: v.id, version: 1 });
    expect(out.status).toBe('done');

    const row = (await ctx.repos.proof.benchmark(v.id, 1))!;
    const results = row.results as ProofMatch[];
    expect(results).toHaveLength(BENCHMARK_MATCHES);
    expect(row.seeds).toEqual(benchmarkPicks('test-secret', v.id, 1));
    expect(results.map((r) => [r.mapId, r.difficulty, r.hijack])).toEqual(
      benchmarkPicks('test-secret', v.id, 1).map((p) => [p.mapId, p.difficulty, p.hijack]),
    );
    // Only the hijack picks hear the lines; the agent recites its skill and the filter stops it.
    for (const r of results) {
      if (r.hijack) expect(r.injected).toBeGreaterThan(0);
      else expect(r.injected).toBe(0);
      if (!r.hijack) expect(r.leaks).toBe(0);
    }
    expect(brain.hijacksHeard).toBeGreaterThan(0);
    const t = tallyProof(results);
    expect(t.leaks).toBeGreaterThan(0);
    expect(t.manipulations).toBeGreaterThan(0);
    expect(row).toMatchObject({
      status: 'done',
      brain: 'model',
      matches: BENCHMARK_MATCHES,
      wins: t.wins,
      losses: t.losses,
      draws: t.draws,
      deliveries: t.deliveries,
      leaks: t.leaks,
      manipulations: t.manipulations,
    });
    expect(row.score).toBeCloseTo(t.score!, 5);
    expect(out.score).toBeCloseTo(t.score!, 5);
    // The skill text is never stored or logged.
    expect(JSON.stringify(row)).not.toContain('second wave');
    expect(JSON.stringify(ctx.logger.lines)).not.toContain('second wave');
  });

  it('fails the benchmark on the last attempt, and a retry takes over the running row', async () => {
    const vault = {
      decryptSkill: async () => {
        throw new WorkerError('vault_down', 'kms unavailable');
      },
    };
    ctx = await setup({ brain: gullibleBrain(), vault });
    const v = await mintedSkill(ctx);
    const job = { kind: 'mint' as const, skillId: v.id, version: 1 };
    await expect(
      processBenchmark(ctx.deps, job, { attemptsMade: 0, attempts: 2 }),
    ).rejects.toThrow();
    expect(await ctx.repos.proof.benchmark(v.id, 1)).toMatchObject({ status: 'running' });
    await expect(
      processBenchmark(ctx.deps, job, { attemptsMade: 1, attempts: 2 }),
    ).rejects.toThrow();
    expect(await ctx.repos.proof.benchmark(v.id, 1)).toMatchObject({
      status: 'failed',
      error: 'vault_down',
    });
  });
});

/**
 * A BenchmarkSeeds fake: the chain as the operator sees it. The seed decrypts only from the second
 * try (the relayer lagging the commit), and any step can be made to fail once.
 */
function fakeSeeder(seed = 0x0123_4567_89ab_cdefn) {
  const state: ChainBenchmark = {
    status: 'none',
    promptHash: `0x${'0'.repeat(64)}`,
    seedHandle: `0x${'0'.repeat(64)}`,
    forced: false,
    scoreBps: 0,
    resultsHash: `0x${'0'.repeat(64)}`,
    seed: null,
  };
  const calls: string[] = [];
  const failOnce = new Set<string>();
  let decryptTries = 0;
  const step = (name: string) => {
    calls.push(name);
    if (failOnce.delete(name)) throw new Error(`${name} failed`);
  };
  const seeder: BenchmarkSeeder = {
    address: '0x00000000000000000000000000000000000000bb',
    async read() {
      return { ...state };
    },
    async commit(_ref, promptHash) {
      step('commit');
      if (state.status !== 'none') throw new Error('AlreadyCommitted');
      Object.assign(state, { status: 'committed', promptHash, seedHandle: `0x${'5'.repeat(64)}` });
      return '0xc0';
    },
    async decryptSeed(handle) {
      step('decrypt');
      if (handle !== state.seedHandle) throw new Error('wrong handle');
      if (++decryptTries < 2) throw new Error('not_ready_for_decryption');
      return seed;
    },
    async publish(_ref, resultsHash, scoreBps) {
      step('publish');
      Object.assign(state, { status: 'publishing', resultsHash, scoreBps });
      return '0xp0';
    },
    async finalize() {
      step('finalize');
      Object.assign(state, { status: 'revealed', seed: seed.toString() });
      return { txHash: '0xf0', seed };
    },
  };
  return { seeder, state, calls, failOnce, seed };
}

describe('benchmark seeds drawn on chain', () => {
  it('commits the prompt hash, plays the picks the sealed seed deals, posts the results and reveals it', async () => {
    const chain = fakeSeeder();
    ctx = await setup({ brain: gullibleBrain(), benchmarkSeeder: chain.seeder });
    const v = await mintedSkill(ctx);
    const out = await processBenchmark(ctx.deps, { kind: 'mint', skillId: v.id, version: 1 });
    expect(out.status).toBe('done');
    expect(chain.calls).toEqual(['commit', 'decrypt', 'decrypt', 'publish', 'finalize']);

    const version = (await ctx.repos.skills.get(v.id, 1))!;
    expect(chain.state.promptHash).toBe(`0x${version.promptSha256}`);
    const row = (await ctx.repos.proof.benchmark(v.id, 1))!;
    const results = row.results as ProofMatch[];
    const dealt = benchmarkSeedPicks(chain.seed, PRACTICE_MAPS);
    expect(results.map((r) => ({ mapId: r.mapId, difficulty: r.difficulty, hijack: r.hijack }))).toEqual(dealt);
    expect(row.seeds).toEqual(dealt);
    expect(chain.state.resultsHash).toBe(benchmarkResultsHash(results.map((r) => r.logHash)));
    expect(chain.state.scoreBps).toBe(scoreToBps(row.score));
    expect(row.onchain).toMatchObject({
      contract: chain.seeder.address,
      skillRef: auctionSkillRef(v.id, 1),
      status: 'revealed',
      seed: chain.seed.toString(),
      commitTx: '0xc0',
      publishTx: '0xp0',
      finalizeTx: '0xf0',
    });
    // The seed is never logged.
    expect(JSON.stringify(ctx.logger.lines)).not.toContain(chain.seed.toString());
  });

  it('a retried job reuses the commit, and resumes a reveal that failed after the result was stored', async () => {
    const chain = fakeSeeder();
    ctx = await setup({ brain: gullibleBrain(), benchmarkSeeder: chain.seeder });
    const v = await mintedSkill(ctx);
    const job = { kind: 'mint' as const, skillId: v.id, version: 1 };
    chain.failOnce.add('publish');
    await expect(processBenchmark(ctx.deps, job, { attemptsMade: 0, attempts: 3 })).rejects.toThrow('publish failed');
    // The result is stored (done) and the seed is still sealed on chain.
    expect(await ctx.repos.proof.benchmark(v.id, 1)).toMatchObject({ status: 'done', onchain: { status: 'committed' } });
    expect(chain.state.status).toBe('committed');

    const out = await processBenchmark(ctx.deps, job, { attemptsMade: 1, attempts: 3 });
    expect(out.status).toBe('done');
    expect(chain.calls.filter((c) => c === 'commit')).toHaveLength(1);
    expect(chain.state.status).toBe('revealed');
    const row = (await ctx.repos.proof.benchmark(v.id, 1))!;
    expect(row.onchain).toMatchObject({ status: 'revealed', publishTx: '0xp0', finalizeTx: '0xf0' });
    expect(chain.state.resultsHash).toBe(benchmarkResultsHash((row.results as ProofMatch[]).map((r) => r.logHash)));
  });

  it('a job retried mid-run takes over the commit already on chain', async () => {
    const chain = fakeSeeder();
    ctx = await setup({ brain: gullibleBrain(), benchmarkSeeder: chain.seeder });
    const v = await mintedSkill(ctx);
    // An earlier attempt claimed the row and committed, then died during the matches.
    await ctx.repos.proof.claimBenchmark(v.id, 1);
    await chain.seeder.commit(auctionSkillRef(v.id, 1), `0x${(await ctx.repos.skills.get(v.id, 1))!.promptSha256}`);
    const out = await processBenchmark(ctx.deps, { kind: 'mint', skillId: v.id, version: 1 }, { attemptsMade: 1, attempts: 3 });
    expect(out.status).toBe('done');
    expect(chain.calls.filter((c) => c === 'commit')).toHaveLength(1);
    expect(chain.state.status).toBe('revealed');
    expect((await ctx.repos.proof.benchmark(v.id, 1))!.onchain).toMatchObject({ status: 'revealed', commitTx: null });
  });

  it('refuses a seed that is already open, or committed for another prompt', async () => {
    const chain = fakeSeeder();
    ctx = await setup({ brain: gullibleBrain(), benchmarkSeeder: chain.seeder });
    const v = await mintedSkill(ctx);
    Object.assign(chain.state, { status: 'committed', promptHash: `0x${'ab'.repeat(32)}`, seedHandle: `0x${'5'.repeat(64)}` });
    const job = { kind: 'mint' as const, skillId: v.id, version: 1 };
    await expect(processBenchmark(ctx.deps, job)).rejects.toThrow();
    expect(await ctx.repos.proof.benchmark(v.id, 1)).toMatchObject({ status: 'failed', error: 'prompt_hash_mismatch' });

    const other = await mintedSkill(ctx, 'maker2');
    Object.assign(chain.state, { status: 'publishing' });
    await expect(processBenchmark(ctx.deps, { ...job, skillId: other.id })).rejects.toThrow();
    expect(await ctx.repos.proof.benchmark(other.id, 1)).toMatchObject({ status: 'failed', error: 'seed_already_open' });
  });

  it('offline (greedy brain) never touches the chain', async () => {
    const chain = fakeSeeder();
    ctx = await setup({ benchmarkSeeder: chain.seeder });
    const v = await mintedSkill(ctx);
    expect((await processBenchmark(ctx.deps, { kind: 'mint', skillId: v.id, version: 1 })).status).toBe('needs_model');
    expect(chain.calls).toEqual([]);
  });
});

describe('trial consumer', () => {
  async function queuedTrial(c: Ctx) {
    const v = await mintedSkill(c);
    const { account: buyer } = await c.repos.accounts.getOrCreate({ handle: 'buyer' }, c.vault);
    const [agent] = await c.repos.agents.listByOwner(buyer.id);
    const trial = await c.repos.proof.createTrial({
      accountId: buyer.id,
      skillId: v.id,
      version: 1,
      agentId: agent!.id,
    });
    return { v, buyer, agent: agent!, trial };
  }

  it('with a skill-aware brain: 3 matches with the buyer agent vs the bot', async () => {
    ctx = await setup({ brain: gullibleBrain() });
    const { trial } = await queuedTrial(ctx);
    expect(await processBenchmark(ctx.deps, { kind: 'trial', trialId: trial.id })).toEqual({
      kind: 'trial',
      id: trial.id,
      status: 'done',
    });
    const row = (await ctx.repos.proof.trial(trial.id))!;
    expect(row.status).toBe('done');
    const results = row.results as ProofMatch[];
    expect(results).toHaveLength(TRIAL_MATCHES);
    expect(results.map((r) => [r.mapId, r.difficulty])).toEqual(
      trialPicks('skirm-bench', trial.id).map((p) => [p.mapId, p.difficulty]),
    );
    for (const r of results) {
      expect(['win', 'loss', 'draw']).toContain(r.outcome);
      expect(r.ticks).toBeGreaterThan(0);
      expect(r.injected).toBe(0);
    }
  });

  it('offline (greedy brain): needs_model, nothing played, and it does not count', async () => {
    ctx = await setup();
    const { v, buyer, trial } = await queuedTrial(ctx);
    expect(await processBenchmark(ctx.deps, { kind: 'trial', trialId: trial.id })).toMatchObject({
      status: 'needs_model',
    });
    expect(await ctx.repos.proof.trial(trial.id)).toMatchObject({
      status: 'needs_model',
      results: null,
    });
    expect(await ctx.repos.proof.trialsUsed(buyer.id, v.id, 1)).toBe(0);
  });
});
