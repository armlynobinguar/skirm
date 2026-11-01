// Migration 0010: delivered match lines, the practice flag, one player per NEAR account, mint claims
// and sold skills leaving the seller's agents.
import { describe, expect, it } from 'vitest';
import type { V2MatchMessageInput } from '../src/index';
import { setup, signUp, type Ctx } from './helpers';

const meta = {
  name: 'Gem Rush',
  summary: 'Grabs the gems.',
  requiresActions: [] as [],
  handlesTags: ['collectible' as const],
  royaltyBps: 500,
};

const line = (tick: number, text: string, over: Partial<V2MatchMessageInput> = {}): V2MatchMessageInput => ({
  tick,
  team: 'A',
  agentId: 'agt_1',
  agentName: 'Wick',
  channel: 'say',
  text,
  heardBy: ['agt_2'],
  overheardBy: [],
  ...over,
});

async function liveMatch(ctx: Ctx, opts: { ranked?: boolean; practice?: boolean } = {}) {
  const ana = await signUp(ctx, 'ana');
  const ben = await signUp(ctx, 'ben');
  const m = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: opts.ranked ?? false, practice: opts.practice, teamA: ana.id, teamB: ben.id });
  return { ana, ben, m };
}

describe('match messages', () => {
  it('stores the delivered lines on finish, once, and reads them back in order', async () => {
    const ctx = await setup();
    const { m } = await liveMatch(ctx);
    await ctx.repos.v2Matches.finish(m.id, {
      winner: 'A',
      reason: 'goal',
      log: { ticks: [{ says: [{ text: 'refused line' }] }] },
      messages: [
        line(3, 'gate is open', { heardBy: ['agt_2', 'agt_3'], overheardBy: ['agt_9'] }),
        line(3, 'on my way', { team: 'B', agentId: 'agt_9', agentName: 'Wren', channel: 'team', heardBy: ['agt_8'] }),
        line(7, 'x'.repeat(130)),
      ],
    });
    // A repeated finish (realtime retry) writes nothing more.
    await ctx.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal', messages: [line(9, 'again')] });

    const { messages, next } = await ctx.repos.matchMessages.list(m.id);
    expect(next).toBeUndefined();
    expect(messages.map((r) => [r.tick, r.team, r.channel, r.text.length])).toEqual([
      [3, 'A', 'say', 12],
      [3, 'B', 'team', 9],
      [7, 'A', 'say', 120],
    ]);
    expect(messages[0]).toMatchObject({ matchId: m.id, agentId: 'agt_1', agentName: 'Wick', heardBy: ['agt_2', 'agt_3'], overheardBy: ['agt_9'] });
    expect((await ctx.repos.matchMessages.list(m.id, { afterTick: 3 })).messages.map((r) => r.tick)).toEqual([7]);
    // The log's says are never copied in.
    expect(messages.some((r) => r.text === 'refused line')).toBe(false);
  });

  it('stores nothing when the finish has no messages', async () => {
    const ctx = await setup();
    const { m } = await liveMatch(ctx);
    await ctx.repos.v2Matches.finish(m.id, { winner: 'B', reason: 'time', log: { ticks: [{ says: [{ text: 'hi' }] }] } });
    expect(await ctx.repos.matchMessages.list(m.id)).toEqual({ messages: [] });
  });

  it('pages on whole ticks, so `next` never skips a line', async () => {
    const ctx = await setup();
    const { m } = await liveMatch(ctx);
    await ctx.repos.v2Matches.finish(m.id, {
      winner: 'draw',
      reason: 'time',
      messages: [line(1, 'a'), line(2, 'b'), line(2, 'c'), line(2, 'd'), line(4, 'e')],
    });
    const p1 = await ctx.repos.matchMessages.list(m.id, { limit: 2 });
    // Tick 2 does not fit whole in 2 rows: the page stops after tick 1.
    expect(p1).toMatchObject({ next: 1 });
    expect(p1.messages.map((r) => r.text)).toEqual(['a']);
    // A tick larger than the limit comes back whole.
    const p2 = await ctx.repos.matchMessages.list(m.id, { afterTick: p1.next, limit: 2 });
    expect(p2.messages.map((r) => r.text)).toEqual(['b', 'c', 'd']);
    expect(p2.next).toBe(2);
    const p3 = await ctx.repos.matchMessages.list(m.id, { afterTick: p2.next, limit: 2 });
    expect(p3.messages.map((r) => r.text)).toEqual(['e']);
    expect(p3.next).toBeUndefined();
  });
});

describe('practice flag', () => {
  it('round-trips through create, get, listLive and listForAccount', async () => {
    const ctx = await setup();
    const { ana, m } = await liveMatch(ctx, { practice: true });
    expect(m.practice).toBe(true);
    expect((await ctx.repos.v2Matches.get(m.id))!.practice).toBe(true);
    expect((await ctx.repos.v2Matches.listLive()).map((r) => [r.id, r.practice])).toEqual([[m.id, true]]);
    const plain = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: ana.id, teamB: m.teamBAccountId });
    expect(plain.practice).toBe(false);
    expect((await ctx.repos.v2Matches.listForAccount(ana.id)).map((r) => r.practice).sort()).toEqual([false, true]);
    await expect(
      ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, practice: true, teamA: ana.id, teamB: m.teamBAccountId }),
    ).rejects.toMatchObject({ code: 'invalid_match' });
  });
});

describe('NEAR account links', () => {
  it('a NEAR account links to one player only', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    expect(await ctx.repos.accounts.linkNearAccount(ana.id, 'ana.testnet')).toEqual({ ok: true });
    expect(await ctx.repos.accounts.linkNearAccount(ben.id, 'ana.testnet')).toEqual({ ok: false, error: 'taken' });
    expect((await ctx.repos.accounts.get(ben.id))!.nearAccountId).toBeNull();
    // Inside a transaction the refused link leaves the rest of it usable.
    await ctx.repos.transaction(async (r) => {
      expect(await r.accounts.linkNearAccount(ben.id, 'ana.testnet')).toEqual({ ok: false, error: 'taken' });
      expect(await r.accounts.linkNearAccount(ben.id, 'ben.testnet')).toEqual({ ok: true });
    });
    expect((await ctx.repos.accounts.get(ben.id))!.nearAccountId).toBe('ben.testnet');
    // Unlinking frees the account for someone else.
    await ctx.repos.accounts.unlinkNearAccount(ana.id);
    expect(await ctx.repos.accounts.linkNearAccount(ben.id, 'ana.testnet')).toEqual({ ok: true });
  });
});

describe('mint claims', () => {
  it('one request at a time holds a draft; stale or released claims can be taken again', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const v = await ctx.repos.skills.create(ana.id, meta, await ctx.sealer.encryptSkill('p'));
    const t0 = new Date('2026-11-03T08:00:00Z');
    const [a, b] = await Promise.all([ctx.repos.skills.claimMint(v.id, 1, 120_000, t0), ctx.repos.skills.claimMint(v.id, 1, 120_000, t0)]);
    expect([a, b].sort()).toEqual([false, true]);
    expect(await ctx.repos.skills.claimMint(v.id, 1, 120_000, new Date(t0.getTime() + 60_000))).toBe(false);
    // The holder died: after staleMs the claim is free again.
    expect(await ctx.repos.skills.claimMint(v.id, 1, 120_000, new Date(t0.getTime() + 120_001))).toBe(true);
    await ctx.repos.skills.releaseMint(v.id, 1);
    expect(await ctx.repos.skills.claimMint(v.id, 1)).toBe(true);
    await ctx.repos.skills.markMinted(v.id, 1, `${v.id}:1`);
    await ctx.repos.skills.releaseMint(v.id, 1);
    // Minted: nothing left to claim.
    expect(await ctx.repos.skills.claimMint(v.id, 1)).toBe(false);
  });
});

describe('sold skills leave the seller’s agents', () => {
  async function mintedAndEquipped(ctx: Ctx) {
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    await ctx.repos.accounts.linkNearAccount(ben.id, 'ben.testnet');
    const v = await ctx.repos.skills.create(ana.id, meta, await ctx.sealer.encryptSkill('p'));
    await ctx.repos.skills.createVersion(v.id, ana.id, { ...meta, name: 'Gem Rush 2' }, await ctx.sealer.encryptSkill('q'));
    await ctx.repos.skills.markMinted(v.id, 1, `${v.id}:1`);
    const [rook, wren] = await ctx.repos.agents.listByOwner(ana.id);
    await ctx.repos.agents.update(ana.id, wren!.id, { skills: [{ id: v.id, version: 1 }] });
    await ctx.repos.agents.update(ana.id, rook!.id, { skills: [{ id: v.id, version: 2 }] });
    const slots = async (id: string) => (await ctx.repos.agents.view(id))!.skills.map((s) => `${s.id}:${s.version}`);
    return { ana, ben, v, rook: rook!, wren: wren!, slots };
  }

  it('recordSale unequips the sold version from the seller’s agents only', async () => {
    const ctx = await setup();
    const { ana, ben, v, rook, wren, slots } = await mintedAndEquipped(ctx);
    await ctx.repos.market.list({ skillId: v.id, version: 1, sellerId: ana.id, priceYocto: '1000' });
    await ctx.repos.market.recordSale({ skillId: v.id, version: 1, buyerId: ben.id, txHash: 'tx1' });
    expect(await slots(wren.id)).toEqual([]);
    // Version 2 is still Ana's.
    expect(await slots(rook.id)).toEqual([`${v.id}:2`]);
    // The buyer can equip it.
    const [benAgent] = await ctx.repos.agents.listByOwner(ben.id);
    await ctx.repos.agents.update(ben.id, benAgent!.id, { skills: [{ id: v.id, version: 1 }] });
    expect(await slots(benAgent!.id)).toContain(`${v.id}:1`);
  });

  it('setTokenOwner unequips the version from every agent the new owner does not own', async () => {
    const ctx = await setup();
    const { ben, v, rook, wren, slots } = await mintedAndEquipped(ctx);
    await ctx.repos.skills.setTokenOwner(`${v.id}:1`, ben.id, 'ben.testnet');
    expect(await slots(wren.id)).toEqual([]);
    expect(await slots(rook.id)).toEqual([`${v.id}:2`]);
    expect(await ctx.repos.skills.owns(ben.id, v.id, 1)).toBe(true);
  });
});
