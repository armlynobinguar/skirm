import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { V2DebriefRecord } from '../src/schema';
import { setup, signUp, type Ctx } from './helpers';

const debrief = (agents: { agentId: string; name: string; delivered: number }[]): V2DebriefRecord => ({
  eloDelta: null,
  mvp: null,
  goals: [],
  talk: { sent: 0, overheard: 0 },
  credits: { held: 0, used: 0, returned: 0 },
  registry: null,
  agents: agents.map((a) => ({ ...a, used: 0, picks: 0 })),
});

const crewOf = (a: { id: string; name: string }) => ({ id: a.id, name: a.name, role: 'Runner', vision: 3, comms: 3, tier: 'standard' });

async function players(ctx: Ctx) {
  const ana = await signUp(ctx, 'ana');
  const ben = await signUp(ctx, 'ben');
  const [a] = await ctx.repos.agents.listByOwner(ana.id);
  const [b] = await ctx.repos.agents.listByOwner(ben.id);
  return { ana, ben, a: a!, b: b! };
}

describe('agent progression', () => {
  it('starts every agent at level 1 with no traits', async () => {
    const ctx = await setup();
    const { a } = await players(ctx);
    expect(a.progression).toMatchObject({ xp: 0, level: 1, traits: [], traitSlots: 0, nextLevelXp: 100, nextTraitLevel: 3 });
  });

  it('a finished match gives each agent XP once, in its crew debrief', async () => {
    const ctx = await setup();
    const { ana, ben, a, b } = await players(ctx);
    const m = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.id, teamB: ben.id });
    const row = await ctx.repos.v2Matches.finish(m.id, {
      winner: 'A',
      reason: 'goal',
      crews: { A: [crewOf(a)], B: [crewOf(b)] },
      debriefs: { A: debrief([{ agentId: a.id, name: a.name, delivered: 3 }]), B: debrief([{ agentId: b.id, name: b.name, delivered: 0 }]) },
    });
    // casual 25 + win 20 + 3 × 2; the loser casual 25.
    expect(row.debriefs!.A!.xp).toEqual([{ agentId: a.id, name: a.name, gained: 51, xp: 51, level: 1, leveledUp: false, traitReady: false }]);
    expect(row.debriefs!.B!.xp).toEqual([expect.objectContaining({ gained: 25, xp: 25 })]);
    expect((await ctx.repos.agents.view(a.id))!.progression.xp).toBe(51);
    // Idempotent: a closed match writes nothing again.
    await ctx.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal', crews: { A: [crewOf(a)], B: [crewOf(b)] } });
    expect((await ctx.repos.agents.view(a.id))!.progression.xp).toBe(51);
  });

  it('practice and void matches give no XP', async () => {
    const ctx = await setup();
    const { ana, ben, a, b } = await players(ctx);
    const p = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, practice: true, teamA: ana.id, teamB: ben.id });
    const row = await ctx.repos.v2Matches.finish(p.id, { winner: 'A', reason: 'goal', crews: { A: [crewOf(a)], B: [crewOf(b)] }, debriefs: { A: debrief([]) } });
    expect(row.debriefs!.A!.xp).toBeUndefined();
    const v = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: ana.id, teamB: ben.id });
    await ctx.repos.v2Matches.finish(v.id, { winner: null, reason: 'declined', crews: { A: [crewOf(a)], B: [crewOf(b)] } });
    expect((await ctx.repos.agents.view(a.id))!.progression.xp).toBe(0);
  });

  it('marks a level up and a waiting trait pick', async () => {
    const ctx = await setup();
    const { ana, ben, a, b } = await players(ctx);
    await ctx.db.execute(sql`update agents set xp = 240 where id = ${a.id}`);
    const m = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: ana.id, teamB: ben.id });
    const row = await ctx.repos.v2Matches.finish(m.id, {
      winner: 'B',
      reason: 'time',
      crews: { A: [crewOf(a)], B: [crewOf(b)] },
      debriefs: { A: debrief([{ agentId: a.id, name: a.name, delivered: 0 }]) },
    });
    expect(row.debriefs!.A!.xp![0]).toMatchObject({ gained: 40, xp: 280, level: 3, leveledUp: true, traitReady: true });
  });

  it('picks a trait only into an earned slot, once each', async () => {
    const ctx = await setup();
    const { ana, a } = await players(ctx);
    await expect(ctx.repos.agents.pickTrait(ana.id, a.id, 'keen')).rejects.toMatchObject({ code: 'no_trait_slot' });
    await ctx.db.execute(sql`update agents set xp = 250 where id = ${a.id}`);
    await expect(ctx.repos.agents.pickTrait(ana.id, a.id, 'wings')).rejects.toMatchObject({ code: 'invalid_trait' });
    const v = await ctx.repos.agents.pickTrait(ana.id, a.id, 'keen');
    expect(v.progression).toMatchObject({ level: 3, traits: ['keen'], traitSlots: 1 });
    await expect(ctx.repos.agents.pickTrait(ana.id, a.id, 'keen')).rejects.toMatchObject({ code: 'trait_taken' });
    await expect(ctx.repos.agents.pickTrait(ana.id, a.id, 'calm')).rejects.toMatchObject({ code: 'no_trait_slot' });
    const ben = await signUp(ctx, 'ben');
    await expect(ctx.repos.agents.pickTrait(ben.id, a.id, 'calm')).rejects.toMatchObject({ code: 'not_found' });
  });
});
