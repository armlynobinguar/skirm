// Agent rentals: offers, one-match passes from verified payments, using a pass, earn-back. And the
// agents' own counters, now written when a match against players ends.
import { describe, expect, it } from 'vitest';
import { RepoError } from '../src/index';
import { setup, signUp, type Ctx } from './helpers';

async function owners(ctx: Ctx) {
  const ana = await signUp(ctx, 'ana');
  const ben = await signUp(ctx, 'ben');
  const [anaAgent] = await ctx.repos.agents.listByOwner(ana.id);
  const [benAgent] = await ctx.repos.agents.listByOwner(ben.id);
  return { ana, ben, anaAgent: anaAgent!, benAgent: benAgent! };
}

const paid = (offerId: string, renterId: string, txHash: string) => ({
  offerId,
  renterId,
  priceYocto: '1000000000000000000000000',
  feeYocto: '50000000000000000000000',
  ownerProceedsYocto: '950000000000000000000000',
  txHash,
});

describe('agent rentals', () => {
  it('sets, replaces and ends an offer; only the owner may, and only above 0', async () => {
    const ctx = await setup();
    const { ana, ben, anaAgent } = await owners(ctx);
    const r = ctx.repos.rentals;
    const first = await r.setOffer(ana.id, anaAgent.id, '1000');
    expect(first).toMatchObject({ agentId: anaAgent.id, ownerId: ana.id, active: true });
    const second = await r.setOffer(ana.id, anaAgent.id, '2000');
    expect((await r.offerFor(anaAgent.id))!.id).toBe(second!.id);
    expect((await r.getOffer(first!.id))!.active).toBe(false);
    await expect(r.setOffer(ben.id, anaAgent.id, '5')).rejects.toBeInstanceOf(RepoError);
    await expect(r.setOffer(ana.id, anaAgent.id, '0')).rejects.toMatchObject({ code: 'invalid_price' });
    expect(await r.setOffer(ana.id, anaAgent.id, null)).toBeNull();
    expect(await r.offerFor(anaAgent.id)).toBeUndefined();
  });

  it('lists active offers cheapest first with the owner, leaving the viewer’s own out', async () => {
    const ctx = await setup();
    const { ana, ben, anaAgent, benAgent } = await owners(ctx);
    await ctx.repos.rentals.setOffer(ana.id, anaAgent.id, '300');
    await ctx.repos.rentals.setOffer(ben.id, benAgent.id, '100');
    const all = await ctx.repos.rentals.offers();
    expect(all.map((o) => [o.agentId, o.priceYocto, o.ownerHandle])).toEqual([
      [benAgent.id, '100', 'ben'],
      [anaAgent.id, '300', 'ana'],
    ]);
    expect((await ctx.repos.rentals.offers({ excludeOwner: ben.id })).map((o) => o.agentId)).toEqual([anaAgent.id]);
  });

  it('records a payment once, refuses the owner and a reused transaction, and pays earn-back', async () => {
    const ctx = await setup();
    const { ana, ben, anaAgent } = await owners(ctx);
    const offer = (await ctx.repos.rentals.setOffer(ana.id, anaAgent.id, '1000000000000000000000000'))!;
    const pass = await ctx.repos.rentals.record(paid(offer.id, ben.id, 'tx1'));
    expect(pass).toMatchObject({ agentId: anaAgent.id, ownerId: ana.id, renterId: ben.id, matchId: null });
    // The same transaction replayed by the same renter gives the same pass.
    expect((await ctx.repos.rentals.record(paid(offer.id, ben.id, 'tx1'))).id).toBe(pass.id);
    const cat = await signUp(ctx, 'cat');
    await expect(ctx.repos.rentals.record(paid(offer.id, cat.id, 'tx1'))).rejects.toMatchObject({ code: 'duplicate_tx' });
    await expect(ctx.repos.rentals.record(paid(offer.id, ana.id, 'tx2'))).rejects.toMatchObject({ code: 'own_agent' });
    expect(await ctx.repos.rentals.proceedsFor(ana.id)).toBe(950000000000000000000000n);
    expect(await ctx.repos.rentals.proceedsFor(ben.id)).toBe(0n);
  });

  it('uses one pass per agent per match, oldest first, and refuses a match without one', async () => {
    const ctx = await setup();
    const { ana, ben, anaAgent } = await owners(ctx);
    const offer = (await ctx.repos.rentals.setOffer(ana.id, anaAgent.id, '10'))!;
    const p1 = await ctx.repos.rentals.record(paid(offer.id, ben.id, 'tx1'));
    await ctx.repos.rentals.record(paid(offer.id, ben.id, 'tx2'));
    expect(await ctx.repos.rentals.rentable(ben.id, [anaAgent.id, 'agt_other'])).toEqual([anaAgent.id]);
    await ctx.repos.rentals.consume(ben.id, [anaAgent.id], 'mat_1');
    expect((await ctx.repos.rentals.byTx('tx1'))!).toMatchObject({ id: p1.id, matchId: 'mat_1' });
    expect(await ctx.repos.rentals.unusedPasses(ben.id)).toHaveLength(1);
    await ctx.repos.rentals.consume(ben.id, [anaAgent.id], 'mat_2');
    expect(await ctx.repos.rentals.rentable(ben.id, [anaAgent.id])).toEqual([]);
    await expect(ctx.repos.rentals.consume(ben.id, [anaAgent.id], 'mat_3')).rejects.toMatchObject({ code: 'no_rental' });
  });
});

describe("agents' own counters", () => {
  it('count ended matches against players, never practice or void ones', async () => {
    const ctx = await setup();
    const { ana, ben, anaAgent, benAgent } = await owners(ctx);
    const crew = (a: { id: string; name: string }) => [{ id: a.id, name: a.name, role: 'Runner', vision: 3, comms: 3, tier: 'standard' }];
    const crews = { A: crew(anaAgent), B: crew(benAgent) };
    const play = async (winner: 'A' | 'B' | 'draw' | null, practice = false) => {
      const m = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, practice, teamA: ana.id, teamB: ben.id, crews });
      await ctx.repos.v2Matches.finish(m.id, { winner, reason: winner ? 'goal' : 'declined' });
    };
    await play('A');
    await play('draw');
    await play('B');
    await play(null);
    await play('A', true);
    const [a] = await ctx.repos.agents.listByOwner(ana.id);
    const [b] = await ctx.repos.agents.listByOwner(ben.id);
    expect(a).toMatchObject({ matchesPlayed: 3, wins: 1, losses: 1, draws: 1 });
    expect(b).toMatchObject({ matchesPlayed: 3, wins: 1, losses: 1, draws: 1 });
  });
});
