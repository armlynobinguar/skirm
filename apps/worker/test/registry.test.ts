// Registry consumer: ranked v2 match records, retries, the `failed` mark on the last attempt, and
// skipped jobs.
import { afterEach, describe, expect, it } from 'vitest';
import { NoopRegistry, recordMatchArgs, type RegistryResult } from '@skirm/server';
import { processRegistry } from '../src/registry-processor';
import { setup, type Ctx } from './helpers';

let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/** Fails record_match `failures` times, then records it onchain. */
class FlakyRegistry extends NoopRegistry {
  calls = 0;
  constructor(private failures: number) {
    super();
  }
  override async recordMatch(): Promise<RegistryResult> {
    this.calls++;
    if (this.failures-- > 0)
      throw Object.assign(new Error('rpc down'), { code: 'rpc_unavailable' });
    return { status: 'recorded', txHash: `tx${this.calls}` };
  }
}

/** A ranked v2 match between two new players, ended with a result and a log hash. */
async function endedRankedMatch(c: Ctx, handles: [string, string]) {
  const a = await c.repos.accounts.getOrCreate({ handle: handles[0] }, c.vault);
  const b = await c.repos.accounts.getOrCreate({ handle: handles[1] }, c.vault);
  const [a1] = await c.repos.agents.listByOwner(a.account.id);
  const [b1] = await c.repos.agents.listByOwner(b.account.id);
  const crew = (id: string) => ({
    id,
    name: id,
    role: 'Runner',
    vision: 3,
    comms: 3,
    tier: 'standard',
  });
  const m = await c.repos.v2Matches.create({
    mapId: 'copper-hollow',
    ranked: true,
    teamA: a.account.id,
    teamB: b.account.id,
    crews: { A: [crew(a1!.id)], B: [crew(b1!.id)] },
  });
  await c.repos.v2Matches.finish(m.id, {
    winner: 'A',
    reason: 'goal',
    decidedBy: 'goal',
    score: { A: 2, B: 0 },
    ticks: 60,
    logHash: 'f'.repeat(64),
  });
  return m;
}

describe('registry consumer', () => {
  it('retries a failing write; records status and tx hash once it lands; then skips', async () => {
    const registry = new FlakyRegistry(2);
    ctx = await setup({ registry });
    const m = await endedRankedMatch(ctx, ['reg1a', 'reg1b']);
    const job = { kind: 'v2_match' as const, id: m.id };
    await expect(
      processRegistry(ctx.deps, job, { attemptsMade: 0, attempts: 10 }),
    ).rejects.toThrow();
    await expect(
      processRegistry(ctx.deps, job, { attemptsMade: 1, attempts: 10 }),
    ).rejects.toThrow();
    expect(await ctx.repos.v2Matches.get(m.id)).toMatchObject({ registryStatus: 'pending' });
    expect(await processRegistry(ctx.deps, job, { attemptsMade: 2, attempts: 10 })).toEqual({
      kind: 'v2_match',
      id: m.id,
      status: 'recorded',
      txHash: 'tx3',
    });
    expect(await ctx.repos.v2Matches.get(m.id)).toMatchObject({
      registryStatus: 'recorded',
      registryTx: 'tx3',
    });
    expect(await processRegistry(ctx.deps, job)).toMatchObject({
      status: 'skipped',
      reason: 'already_recorded',
    });
    expect(registry.calls).toBe(3);
  });

  it('marks the record failed on the last attempt', async () => {
    ctx = await setup({ registry: new FlakyRegistry(99) });
    const m = await endedRankedMatch(ctx, ['reg2a', 'reg2b']);
    await expect(
      processRegistry(ctx.deps, { kind: 'v2_match', id: m.id }, { attemptsMade: 9, attempts: 10 }),
    ).rejects.toThrow();
    expect(await ctx.repos.v2Matches.get(m.id)).toMatchObject({ registryStatus: 'failed' });
  });

  it('skips unknown matches, with no chain call', async () => {
    const registry = new FlakyRegistry(0);
    ctx = await setup({ registry });
    expect(
      await processRegistry(ctx.deps, { kind: 'v2_match', id: 'mat_01JB7Z3K9QX4M2T8V6N5R1C0DE' }),
    ).toMatchObject({ status: 'skipped', reason: 'not_found' });
    expect(registry.calls).toBe(0);
  });

  it('records a ranked v2 match: crews with tiers, per-player Elo, the log hash', async () => {
    ctx = await setup();
    const a = await ctx.repos.accounts.getOrCreate({ handle: 'va' }, ctx.vault);
    const b = await ctx.repos.accounts.getOrCreate({ handle: 'vb' }, ctx.vault);
    const [a1, a2] = await ctx.repos.agents.listByOwner(a.account.id);
    const [b1] = await ctx.repos.agents.listByOwner(b.account.id);
    const crew = (id: string, tier = 'standard') => ({
      id,
      name: id,
      role: 'Runner',
      vision: 3,
      comms: 3,
      tier,
    });
    const create = (ranked: boolean) =>
      ctx!.repos.v2Matches.create({
        mapId: 'copper-hollow',
        ranked,
        teamA: a.account.id,
        teamB: b.account.id,
        crews: { A: [crew(a1!.id, 'quiet'), crew(a2!.id, 'open')], B: [crew(b1!.id)] },
      });
    const m = await create(true);
    const job = { kind: 'v2_match' as const, id: m.id };
    expect(await processRegistry(ctx.deps, job)).toMatchObject({
      status: 'skipped',
      reason: 'not_ended',
    });
    const ended = await ctx.repos.v2Matches.finish(m.id, {
      winner: 'B',
      reason: 'goal',
      decidedBy: 'goal',
      score: { A: 1, B: 3 },
      ticks: 90,
      logHash: 'c'.repeat(64),
    });
    const deltas = ended.eloDeltas!;
    const out = await processRegistry(ctx.deps, job);
    expect(out).toMatchObject({ kind: 'v2_match', id: m.id, status: 'local' });
    expect(ctx.registry.matches).toHaveLength(1);
    const rec = ctx.registry.matches[0]!;
    const delta = (t: 'A' | 'B') => deltas.find((d) => d.team === t)!.delta;
    expect(rec).toMatchObject({
      matchId: m.id,
      mapId: 'copper-hollow',
      ranked: true,
      result: 'B',
      decidedBy: 'goal',
      ticks: 90,
      sideA: {
        player: a.account.id,
        crew: [
          { id: a1!.id, tier: 'quiet' },
          { id: a2!.id, tier: 'open' },
        ],
        delivered: 1,
      },
      sideB: { player: b.account.id, crew: [{ id: b1!.id, tier: 'standard' }], delivered: 3 },
      logSha256: 'c'.repeat(64),
    });
    // The season the ranked result counted towards, by the number the seasons contract knows.
    const season = (await ctx.repos.seasons.get(ended.seasonId!))!;
    expect(season.number).toBe(1);
    expect(rec.seasonId).toBe(1);
    expect(rec.eloDeltas.map((d) => ({ team: d.team, delta: d.delta }))).toEqual([
      { team: 'A', delta: delta('A') },
      { team: 'B', delta: delta('B') },
    ]);
    expect(delta('B')).toBeGreaterThan(0);
    // The contract args: one change per player, the smaller crew's head start.
    expect(recordMatchArgs(rec)).toMatchObject({
      head_start_ticks: 5,
      side_a: { agents: [a1!.id, a2!.id], tiers: ['quiet', 'open'], delivered: 1 },
      elo_changes: [
        { player: a.account.id, delta: delta('A') },
        { player: b.account.id, delta: delta('B') },
      ],
    });
    expect(await ctx.repos.v2Matches.get(m.id)).toMatchObject({
      registryStatus: 'local',
      registryTx: out.txHash,
    });

    // A result without what decided it cannot make a valid record.
    const undecided = await create(true);
    await ctx.repos.v2Matches.finish(undecided.id, {
      winner: 'A',
      reason: 'goal',
      logHash: 'e'.repeat(64),
    });
    expect(await processRegistry(ctx.deps, { kind: 'v2_match', id: undecided.id })).toMatchObject({
      reason: 'no_result',
    });

    // Casual and void matches never go on chain.
    const casual = await create(false);
    await ctx.repos.v2Matches.finish(casual.id, {
      winner: 'A',
      reason: 'goal',
      logHash: 'd'.repeat(64),
    });
    expect(await processRegistry(ctx.deps, { kind: 'v2_match', id: casual.id })).toMatchObject({
      reason: 'not_registered',
    });
    const voided = await create(true);
    await ctx.repos.v2Matches.finish(voided.id, { winner: null, reason: 'declined' });
    expect(await processRegistry(ctx.deps, { kind: 'v2_match', id: voided.id })).toMatchObject({
      reason: 'not_ended',
    });
    expect(ctx.registry.matches).toHaveLength(1);
  });
});
