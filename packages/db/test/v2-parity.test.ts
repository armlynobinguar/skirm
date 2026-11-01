// Repo additions for v2 parity: the owner's instructions on an agent, the player ladder, stored
// debriefs and difficulty, and the earn-back sums (sales net as seller, credits spent on v2 matches).
import type { TurnOutcome } from '@skirm/ledger';
import { splitSale } from '@skirm/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { AGENT_SYSTEM_PROMPT_MAX, v2DebriefOf, type V2DebriefRecord } from '../src/index';
import { setup, signUp, type Ctx } from './helpers';

const meta = {
  name: 'Gap Sealer',
  summary: null,
  requiresActions: ['place_block' as const],
  handlesTags: ['liquid' as const],
  royaltyBps: 500,
};

const debrief = (o: Partial<V2DebriefRecord> = {}): V2DebriefRecord => ({
  eloDelta: null,
  mvp: 'agt_1',
  goals: [{ title: 'Deliver', met: true }],
  talk: { sent: 3, overheard: 1 },
  credits: { held: 300, used: 120, returned: 180 },
  registry: null,
  agents: [{ agentId: 'agt_1', name: 'Wick', delivered: 2, used: 1, picks: 3 }],
  ...o,
});

async function rankedMatch(ctx: Ctx, a: string, b: string, winner: 'A' | 'B' | 'draw') {
  const m = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: a, teamB: b });
  return ctx.repos.v2Matches.finish(m.id, { winner, reason: 'goal' });
}

describe("agents: the owner's instructions", () => {
  it('stores them trimmed, clears them on null or blank, and refuses more than 600 characters', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const [rook] = await ctx.repos.agents.listByOwner(acc.id);
    expect(rook!.systemPrompt).toBeNull();

    const v = await ctx.repos.agents.update(acc.id, rook!.id, { systemPrompt: '  Hold the dam, call every fire.  ' });
    expect(v.systemPrompt).toBe('Hold the dam, call every fire.');
    expect((await ctx.repos.agents.view(rook!.id))!.systemPrompt).toBe('Hold the dam, call every fire.');

    // 600 code points pass even when they are more UTF-16 units.
    const full = '🙂'.repeat(AGENT_SYSTEM_PROMPT_MAX);
    expect((await ctx.repos.agents.update(acc.id, rook!.id, { systemPrompt: full })).systemPrompt).toBe(full);
    await expect(ctx.repos.agents.update(acc.id, rook!.id, { systemPrompt: `${full}x` })).rejects.toMatchObject({ code: 'invalid_system_prompt' });

    expect((await ctx.repos.agents.update(acc.id, rook!.id, { systemPrompt: '   ' })).systemPrompt).toBeNull();
    await ctx.repos.agents.update(acc.id, rook!.id, { systemPrompt: 'again' });
    expect((await ctx.repos.agents.update(acc.id, rook!.id, { systemPrompt: null })).systemPrompt).toBeNull();
    // Leaving it out keeps it.
    await ctx.repos.agents.update(acc.id, rook!.id, { systemPrompt: 'kept' });
    expect((await ctx.repos.agents.update(acc.id, rook!.id, { name: 'Rook II' })).systemPrompt).toBe('kept');
  });

  it('the database refuses a longer value written around the repo', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const [rook] = await ctx.repos.agents.listByOwner(acc.id);
    await expect(ctx.db.execute(sql`update agents set system_prompt = ${'x'.repeat(601)} where id = ${rook!.id}`)).rejects.toThrow();
  });
});

describe('leaderboards.playerLadder', () => {
  it('ranks players with a ranked v2 match by Elo; ties share a rank', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const cat = await signUp(ctx, 'cat');
    const dan = await signUp(ctx, 'dan');
    await signUp(ctx, 'eve'); // never played ranked
    await rankedMatch(ctx, ana.id, ben.id, 'A');
    await rankedMatch(ctx, cat.id, dan.id, 'A');

    const rows = await ctx.repos.leaderboards.playerLadder();
    expect(rows.map((r) => [r.account.handle, r.rank, r.elo])).toEqual([
      ['ana', 1, 1216],
      ['cat', 1, 1216],
      ['ben', 3, 1184],
      ['dan', 3, 1184],
    ]);
    expect(rows[0]).toMatchObject({ rankedMatches: 1, wins: 1, losses: 0, draws: 0 });
    expect(await ctx.repos.leaderboards.playerLadder(1)).toHaveLength(1);
    expect(await ctx.repos.leaderboards.playerRowFor(ben.id)).toMatchObject({ rank: 3, account: { handle: 'ben' }, losses: 1 });
    expect(await ctx.repos.leaderboards.playerRowFor((await signUp(ctx, 'eve')).id)).toBeUndefined();
  });
});

describe('v2 matches: difficulty and debriefs', () => {
  it('keeps casual difficulty, drops it for ranked, and stores debriefs with live Elo and registry', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const casual = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, difficulty: 'hard', teamA: ana.id, teamB: ben.id });
    expect(casual.difficulty).toBe('hard');
    const c = await ctx.repos.v2Matches.finish(casual.id, { winner: 'B', reason: 'time', debriefs: { A: debrief(), B: debrief({ mvp: null }) } });
    expect(c.debriefs?.A).toMatchObject({ eloDelta: null, registry: null, talk: { sent: 3, overheard: 1 } });
    expect(v2DebriefOf(c, 'B')).toMatchObject({ mvp: null, registry: null });

    const ranked = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, difficulty: 'mega', teamA: ana.id, teamB: ben.id });
    expect(ranked.difficulty).toBeNull();
    // The stored delta and registry come from the result, not from what the caller sent.
    const r = await ctx.repos.v2Matches.finish(ranked.id, { winner: 'A', reason: 'goal', debriefs: { A: debrief({ eloDelta: 99, registry: 'written' }) } });
    expect(r.debriefs?.A).toMatchObject({ eloDelta: 16, registry: 'pending' });
    expect(r.debriefs?.B).toBeUndefined();
    expect(v2DebriefOf(r, 'B')).toBeNull();

    await ctx.repos.v2Matches.setRegistry(ranked.id, 'recorded', 'tx1');
    const after = (await ctx.repos.v2Matches.get(ranked.id))!;
    expect(v2DebriefOf(after, 'A')).toMatchObject({ eloDelta: 16, registry: 'written', mvp: 'agt_1' });
  });
});

describe('earn-back sums', () => {
  it('market.salesNetBySeller: the seller share of each sale, royalty only on resales', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const cat = await signUp(ctx, 'cat');
    const v = await ctx.repos.skills.create(ana.id, meta, await ctx.sealer.encryptSkill('p'));
    await ctx.repos.skills.markMinted(v.id, 1, `${v.id}:1`);
    const price = 3_000_000_000_000_000_000_000_000n;
    expect(await ctx.repos.market.salesNetBySeller(ana.id)).toBe(0n);
    await ctx.repos.market.list({ skillId: v.id, version: 1, sellerId: ana.id, priceYocto: price.toString() });
    await ctx.repos.market.recordSale({ skillId: v.id, version: 1, buyerId: ben.id, txHash: 't1' });
    await ctx.repos.market.list({ skillId: v.id, version: 1, sellerId: ben.id, priceYocto: price.toString() });
    await ctx.repos.market.recordSale({ skillId: v.id, version: 1, buyerId: cat.id, txHash: 't2' });

    expect(await ctx.repos.market.salesNetBySeller(ana.id)).toBe(splitSale(price, { primary: true, royaltyBps: 500 }).seller);
    const resale = splitSale(price, { primary: false, royaltyBps: 500 });
    expect(resale.royalty).toBe(150_000_000_000_000_000_000_000n);
    expect(await ctx.repos.market.salesNetBySeller(ben.id)).toBe(resale.seller);
    expect(await ctx.repos.market.salesNetBySeller(cat.id)).toBe(0n);
  });

  it('ledger.v2MatchSpend: paid credits charged on v2 match holds, net of reversals', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    await ctx.repos.ledger.topUp({ accountId: ana.id, credits: 500, receipt: 'tx1' });
    const turns = (n: number): TurnOutcome[] => Array.from({ length: n }, () => ({ agent: 0, reason: null }));

    // Settled: 100 held (60 free + 40 paid), 70 charged = 60 free + 10 paid.
    const m1 = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.id, teamB: ben.id });
    expect((await ctx.repos.ledger.hold({ accountId: ana.id, runId: `${m1.id}-A`, stepLimit: 100, agents: 1 })).ok).toBe(true);
    expect((await ctx.repos.ledger.chargeTurns(`${m1.id}-A`, turns(70))).ok).toBe(true);
    expect((await ctx.repos.ledger.settle(`${m1.id}-A`)).ok).toBe(true);
    expect(await ctx.repos.ledger.v2MatchSpend(ana.id)).toBe(10);

    // Released: its charges are reversed, so it adds nothing.
    const m2 = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ben.id, teamB: ana.id });
    expect((await ctx.repos.ledger.hold({ accountId: ana.id, runId: `${m2.id}-B`, stepLimit: 50, agents: 1 })).ok).toBe(true);
    expect((await ctx.repos.ledger.chargeTurns(`${m2.id}-B`, turns(20))).ok).toBe(true);
    expect((await ctx.repos.ledger.abort(`${m2.id}-B`)).ok).toBe(true);
    // A hold that is not a v2 match crew of this account does not count.
    expect((await ctx.repos.ledger.hold({ accountId: ana.id, runId: 'r-solo', stepLimit: 30, agents: 1 })).ok).toBe(true);
    expect((await ctx.repos.ledger.chargeTurns('r-solo', turns(30))).ok).toBe(true);
    expect((await ctx.repos.ledger.settle('r-solo')).ok).toBe(true);

    expect(await ctx.repos.ledger.v2MatchSpend(ana.id)).toBe(10);
    expect(await ctx.repos.ledger.v2MatchSpend(ben.id)).toBe(0);
  });
});
