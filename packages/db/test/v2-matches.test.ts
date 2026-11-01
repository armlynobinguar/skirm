import { describe, expect, it } from 'vitest';
import { setup, signUp } from './helpers';

describe('v2 matches', () => {
  it('a ranked result moves both players’ Elo once, and a closed match stays closed', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const m = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: ana.id, teamB: ben.id });
    expect(m.status).toBe('live');
    expect((await ctx.repos.v2Matches.listLive()).map((r) => r.id)).toEqual([m.id]);

    const row = await ctx.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 4, B: 1 }, ticks: 88, log: { ticks: [] }, logHash: 'ab'.repeat(32) });
    expect(row).toMatchObject({ status: 'ended', winner: 'A', scoreA: 4, scoreB: 1, registryStatus: 'pending' });
    expect(row.eloDeltas).toEqual([
      { accountId: ana.id, team: 'A', before: 1200, delta: 16, after: 1216 },
      { accountId: ben.id, team: 'B', before: 1200, delta: -16, after: 1184 },
    ]);
    const a = await ctx.repos.accounts.get(ana.id);
    expect(a).toMatchObject({ elo: 1216, rankedMatches: 1, wins: 1, losses: 0 });
    expect(await ctx.repos.accounts.get(ben.id)).toMatchObject({ elo: 1184, losses: 1 });

    await ctx.repos.v2Matches.finish(m.id, { winner: 'B', reason: 'goal' });
    expect((await ctx.repos.accounts.get(ana.id))!.elo).toBe(1216);
    expect((await ctx.repos.v2Matches.listForAccount(ben.id)).map((r) => r.id)).toEqual([m.id]);
  });

  it('void and unranked matches leave Elo alone', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const v = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: ana.id, teamB: ben.id });
    expect(await ctx.repos.v2Matches.finish(v.id, { winner: null, reason: 'declined', fault: 'B' })).toMatchObject({ status: 'void', fault: 'B', registryStatus: 'none', eloDeltas: [] });
    const c = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.id, teamB: ben.id });
    await ctx.repos.v2Matches.finish(c.id, { winner: 'B', reason: 'time' });
    expect((await ctx.repos.accounts.get(ana.id))!.elo).toBe(1200);
  });
});
