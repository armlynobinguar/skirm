// Ranked tiers: GET /leaderboards/tiers, /leaderboards/maps/:mapId, /leaderboards/skills, the tier on
// GET /leaderboards/players and GET /me (placements, decay date).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULTS, tierOf } from '@skirm/shared';
import { SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

const DAY = 86_400_000;

let h: Harness;
let ana: UserClient;
let ben: UserClient;
let cat: UserClient;

const agent = (id: string, skills: { id: string; version: number }[] = []) => ({
  id,
  name: id,
  role: 'Runner',
  vision: 3,
  comms: 3,
  tier: 'standard',
  skills,
});

async function ranked(a: UserClient, b: UserClient, winner: 'A' | 'B' | 'draw', mapId = 'copper-hollow', skillsA: { id: string; version: number }[] = []) {
  const crews = { A: [agent('a1', skillsA)], B: [agent('b1')] };
  const m = await h.repos.v2Matches.create({ mapId, ranked: true, teamA: a.accountId, teamB: b.accountId, crews });
  await h.repos.v2Matches.finish(m.id, { winner, reason: 'goal', crews });
}

beforeAll(async () => {
  h = await setup();
  ana = await h.as('rkana');
  ben = await h.as('rkben');
  cat = await h.as('rkcat');
});
afterAll(() => h.close());

describe('ranked tiers', () => {
  it('GET /leaderboards/tiers is public and lists the shared thresholds', async () => {
    const res = await h.http().get('/leaderboards/tiers');
    expect(res.status).toBe(200);
    expect(res.body.tiers.map((t: { name: string }) => t.name)).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master']);
    expect(res.body.tiers[0]).toEqual({ name: 'Bronze', min: 0, nextAt: 1100 });
    expect(res.body.tiers.at(-1)).toEqual({ name: 'Master', min: 1900, nextAt: null });
    expect(res.body).toMatchObject({
      placementMatches: 5,
      kPlacement: 48,
      decay: { fromTier: 'Diamond', days: DEFAULTS.ranked.decay.days, amount: DEFAULTS.ranked.decay.amount },
      skillMinMatches: DEFAULTS.ranked.skillMinMatches,
    });
  });

  it('GET /me shows placements until five ranked matches, then the tier', async () => {
    expect((await cat.get('/me')).body.rank.tier).toEqual({ tier: null, placementsPlayed: 0, placementMatches: 5, nextAt: null });
    for (let i = 0; i < 4; i++) await ranked(ana, ben, 'A');
    const placing = (await ana.get('/me')).body.rank;
    expect(placing.tier).toMatchObject({ tier: null, placementsPlayed: 4 });
    // Placement K is 48: the first win between equals is +24.
    expect(placing.elo).toBeGreaterThan(1200 + 4 * 16);
    await ranked(ana, ben, 'A');
    const placed = (await ana.get('/me')).body.rank;
    // Five wins with K 48 from 1,200: 1,293, Silver; the rival's five losses leave 1,107, Silver too.
    expect(placed.elo).toBe(1293);
    expect(placed.tier).toEqual({ tier: 'Silver', placementsPlayed: 5, placementMatches: 5, nextAt: 1300 });
    expect(placed.decayAt).toBeNull();
    const rival = (await ben.get('/me')).body.rank;
    expect(rival.elo).toBe(1107);
    expect(rival.tier.tier).toBe(tierOf(1107).name);
  });

  it('GET /me says when an inactive Diamond player decays next', async () => {
    await h.repos.db.execute(`update accounts set elo = 1750 where id = '${cat.accountId}'`);
    await h.repos.db.execute(`update accounts set ranked_matches = 9 where id = '${cat.accountId}'`);
    const rank = (await cat.get('/me')).body.rank;
    expect(rank.tier.tier).toBe('Diamond');
    // No ranked result yet: the clock runs from account creation.
    const acc = (await h.repos.accounts.get(cat.accountId))!;
    expect(rank.decayAt).toBe(new Date(acc.createdAt.getTime() + DEFAULTS.ranked.decay.days * DAY).toISOString());
  });

  it('GET /leaderboards/players rows carry the tier', async () => {
    const res = await h.http().get('/leaderboards/players');
    const row = res.body.rows.find((r: { account: { id: string } }) => r.account.id === ana.accountId);
    expect(row.tier).toMatchObject({ tier: 'Silver', placementsPlayed: 5 });
  });

  it('GET /leaderboards/maps/:mapId ranks players on that map; 404 for an unknown map', async () => {
    await ranked(ben, ana, 'A', 'basalt-stair');
    const res = await h.http().get('/leaderboards/maps/copper-hollow');
    expect(res.status).toBe(200);
    expect(res.body.mapId).toBe('copper-hollow');
    expect(res.body.rows.map((r: { account: { handle: string }; wins: number; matches: number }) => [r.account.handle, r.wins, r.matches])).toEqual([
      ['rkana', 5, 5],
      ['rkben', 0, 5],
    ]);
    expect(res.body.rows[0]).toMatchObject({ rank: 1, winRate: 1, tier: { tier: 'Silver' } });
    const basalt = await h.http().get('/leaderboards/maps/basalt-stair?limit=1');
    expect(basalt.body.rows.map((r: { account: { handle: string } }) => r.account.handle)).toEqual(['rkben']);
    expect((await h.http().get('/leaderboards/maps/nowhere')).status).toBe(404);
    expect((await h.http().get('/leaderboards/maps/copper-hollow?limit=0')).status).toBe(400);
  });

  it('GET /leaderboards/skills lists skills with enough ranked matches by win rate', async () => {
    const created = await ana.post('/skills', { ...SAMPLE_SKILL, name: 'Gem Rush' });
    expect(created.status).toBe(201);
    const gem = { id: created.body.id, version: 1 };
    const min = DEFAULTS.ranked.skillMinMatches;
    for (let i = 0; i < min - 1; i++) await ranked(ana, cat, i % 2 ? 'B' : 'A', 'copper-hollow', [gem]);
    expect((await h.http().get('/leaderboards/skills')).body).toEqual({ minMatches: min, rows: [] });
    await ranked(ana, cat, 'A', 'copper-hollow', [gem]);
    const res = await h.http().get('/leaderboards/skills');
    expect(res.status).toBe(200);
    // Crew A won every even game of the first min - 1, then the last one.
    const wins = Math.ceil((min - 1) / 2) + 1;
    expect(res.body.rows).toEqual([
      {
        rank: 1,
        skill: { id: gem.id, name: 'Gem Rush' },
        creator: { id: ana.accountId, handle: 'rkana' },
        matches: min,
        wins,
        losses: min - wins,
        draws: 0,
        winRate: wins / min,
      },
    ]);
    expect((await h.http().get('/leaderboards/skills?mapId=basalt-stair')).body).toEqual({ minMatches: min, mapId: 'basalt-stair', rows: [] });
    expect((await h.http().get('/leaderboards/skills?mapId=nowhere')).status).toBe(404);
  });
});
