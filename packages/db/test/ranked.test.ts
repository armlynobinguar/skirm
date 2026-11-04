import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { accounts, eloDecays, type V2CrewRecord } from '../src/index';
import { setup, signUp, type Ctx } from './helpers';

const DAY = 86_400_000;

const agent = (id: string, skills: { id: string; version: number }[] = []): V2CrewRecord => ({
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
    { name, summary: null, requiresActions: [], handlesTags: [], royaltyBps: 500 },
    await ctx.sealer.encryptSkill(name),
  );
  return { id: s.id, version: 1 };
}

async function play(
  ctx: Ctx,
  a: string,
  b: string,
  winner: 'A' | 'B' | 'draw',
  opts: { mapId?: string; ranked?: boolean; crews?: Record<'A' | 'B', V2CrewRecord[]> } = {},
) {
  const crews = opts.crews ?? { A: [agent('a1')], B: [agent('b1')] };
  const m = await ctx.repos.v2Matches.create({ mapId: opts.mapId ?? 'copper-hollow', ranked: opts.ranked ?? true, teamA: a, teamB: b, crews });
  return ctx.repos.v2Matches.finish(m.id, { winner, reason: 'goal', crews });
}

const setElo = (ctx: Ctx, id: string, elo: number, rankedMatches = 30) =>
  ctx.db.update(accounts).set({ elo, rankedMatches }).where(eq(accounts.id, id));

describe('ranked leaderboards', () => {
  it('ranks players on one map by wins, then win rate; other maps and casual do not count', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const cat = await signUp(ctx, 'cat');
    await play(ctx, ana.id, ben.id, 'A');
    await play(ctx, ana.id, cat.id, 'A');
    await play(ctx, cat.id, ben.id, 'A');
    await play(ctx, ben.id, cat.id, 'draw');
    await play(ctx, ben.id, ana.id, 'A', { mapId: 'basalt-stair' });
    await play(ctx, ben.id, ana.id, 'A', { ranked: false });

    const rows = await ctx.repos.ranked.mapLadder('copper-hollow');
    expect(rows.map((r) => [r.account.handle, r.rank, r.matches, r.wins, r.losses, r.draws])).toEqual([
      ['ana', 1, 2, 2, 0, 0],
      ['cat', 2, 3, 1, 1, 1],
      ['ben', 3, 3, 0, 2, 1],
    ]);
    expect(rows[1]!.winRate).toBeCloseTo(1 / 3);
    expect(rows[0]!.rankedMatches).toBe(3);
    expect((await ctx.repos.ranked.mapLadder('basalt-stair')).map((r) => r.account.handle)).toEqual(['ben', 'ana']);
    expect(await ctx.repos.ranked.mapLadder('nowhere')).toEqual([]);
    expect(await ctx.repos.ranked.mapLadder('copper-hollow', 1)).toHaveLength(1);
  });

  it('ranks skills by win rate above the minimum matches, one count per crew and match', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const gem = await skill(ctx, ana.id, 'Gem Rush');
    const wall = await skill(ctx, ben.id, 'Wall');
    // Gem Rush on two agents of crew A still counts once per match.
    const crews = { A: [agent('a1', [gem]), agent('a2', [gem])], B: [agent('b1', [wall])] };
    for (const w of ['A', 'A', 'B'] as const) await play(ctx, ana.id, ben.id, w, { crews });
    await play(ctx, ana.id, ben.id, 'A', { crews, mapId: 'basalt-stair' });

    const rows = await ctx.repos.ranked.skillLadder({ minMatches: 2 });
    expect(rows.map((r) => [r.skill.name, r.rank, r.matches, r.wins, r.losses, r.creator.handle])).toEqual([
      ['Gem Rush', 1, 4, 3, 1, 'ana'],
      ['Wall', 2, 4, 1, 3, 'ben'],
    ]);
    expect(rows[0]!.winRate).toBe(0.75);
    expect(await ctx.repos.ranked.skillLadder({ minMatches: 5 })).toEqual([]);
    const onMap = await ctx.repos.ranked.skillLadder({ minMatches: 1, mapId: 'basalt-stair' });
    expect(onMap.map((r) => [r.skill.name, r.matches])).toEqual([
      ['Gem Rush', 1],
      ['Wall', 1],
    ]);
  });
});

describe('Elo decay', () => {
  it('a ranked result stamps the inactivity clock', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    await play(ctx, ana.id, ben.id, 'A', { ranked: false });
    expect((await ctx.repos.accounts.get(ana.id))!.lastRankedAt).toBeNull();
    await play(ctx, ana.id, ben.id, 'A');
    expect((await ctx.repos.accounts.get(ana.id))!.lastRankedAt?.getTime()).toBe(ctx.clock.now);
  });

  it('takes the amount from inactive Diamond and Master players, never below their tier floor, once per period', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const cat = await signUp(ctx, 'cat');
    const dan = await signUp(ctx, 'dan');
    const eve = await signUp(ctx, 'eve');
    const fay = await signUp(ctx, 'fay');
    await play(ctx, ana.id, ben.id, 'A');
    await play(ctx, cat.id, dan.id, 'A');
    await play(ctx, eve.id, dan.id, 'A');
    await setElo(ctx, ana.id, 1760); // Diamond
    await setElo(ctx, ben.id, 1910); // Master, 10 above its floor
    await setElo(ctx, cat.id, 1650); // Platinum: no decay
    await setElo(ctx, dan.id, 1800, 3); // still placing: no decay
    await setElo(ctx, eve.id, 2000);

    // Not inactive long enough yet.
    ctx.clock.now += 13 * DAY;
    expect(await ctx.repos.ranked.decayInactive({ days: 14, amount: 25 })).toEqual([]);
    // eve plays again, so she is active.
    await play(ctx, eve.id, fay.id, 'A');
    ctx.clock.now += 1 * DAY;

    const steps = await ctx.repos.ranked.decayInactive({ days: 14, amount: 25 });
    expect(steps).toEqual([
      { accountId: ana.id, before: 1760, after: 1735 },
      { accountId: ben.id, before: 1910, after: 1900 },
    ].sort((x, y) => x.accountId.localeCompare(y.accountId)));
    expect((await ctx.repos.accounts.get(cat.id))!.elo).toBe(1650);
    expect((await ctx.repos.accounts.get(dan.id))!.elo).toBe(1800);
    expect((await ctx.repos.accounts.get(eve.id))!.elo).toBe(2000);

    // Again at once: nothing (one step per period).
    expect(await ctx.repos.ranked.decayInactive({ days: 14, amount: 25 })).toEqual([]);
    expect(await ctx.db.select().from(eloDecays)).toHaveLength(2);

    // Next periods: ana loses 25 more each time down to the Diamond floor, ben stays at the Master
    // floor (eve, inactive since day 13, starts decaying too).
    const anaSteps = async () => (await ctx.repos.ranked.decayInactive({ days: 14, amount: 25 })).filter((s) => s.accountId !== eve.id);
    ctx.clock.now += 14 * DAY;
    expect(await anaSteps()).toEqual([{ accountId: ana.id, before: 1735, after: 1710 }]);
    ctx.clock.now += 14 * DAY;
    expect(await anaSteps()).toEqual([{ accountId: ana.id, before: 1710, after: 1700 }]);
    ctx.clock.now += 14 * DAY;
    expect(await anaSteps()).toEqual([]);
    expect((await ctx.repos.accounts.get(ana.id))!.elo).toBe(1700);
    expect((await ctx.repos.accounts.get(ben.id))!.elo).toBe(1900);
    expect((await ctx.repos.accounts.get(eve.id))!.elo).toBeLessThan(2000);
  });

  it('says when the next step lands', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    await play(ctx, ana.id, ben.id, 'A');
    const playedAt = ctx.clock.now;
    expect(await ctx.repos.ranked.nextDecayAt((await ctx.repos.accounts.get(ana.id))!)).toBeNull();
    await setElo(ctx, ana.id, 1760);
    const a = (await ctx.repos.accounts.get(ana.id))!;
    expect((await ctx.repos.ranked.nextDecayAt(a, 14))?.getTime()).toBe(playedAt + 14 * DAY);
    ctx.clock.now += 20 * DAY;
    await ctx.repos.ranked.decayInactive({ days: 14, amount: 25 });
    const after = (await ctx.repos.accounts.get(ana.id))!;
    expect((await ctx.repos.ranked.nextDecayAt(after, 14))?.getTime()).toBe(ctx.clock.now + 14 * DAY);
  });
});
