// Additions for the web builders: /me extras, /credits creditsPerNear and ledger match ids,
// DELETE /me/near, royalties and GET /me/matches.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ledgerMatchId } from '../src/views';
import { SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let ana: UserClient;
let ben: UserClient;
let cat: UserClient;
let skillId: string;

beforeAll(async () => {
  h = await setup();
  ana = await h.as('ana');
  ben = await h.as('ben');
  cat = await h.as('cat');
  skillId = (await ana.post('/skills', SAMPLE_SKILL)).body.id;
  expect((await ana.post(`/skills/${skillId}/mint`)).status).toBe(200);
});
afterAll(() => h.close());

describe('GET /me and /credits extras', () => {
  it('has creditsPerNear, royaltiesYocto and account.createdAt', async () => {
    const me = await ana.get('/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ creditsPerNear: 1000, royaltiesYocto: '0' });
    expect(Date.parse(me.body.account.createdAt)).not.toBeNaN();
    const credits = await ana.get('/credits');
    expect(credits.body.creditsPerNear).toBe(1000);
  });

  it('ledger rows name the v2 match a hold belongs to as matchId', async () => {
    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId });
    await h.repos.ledger.hold({ accountId: ana.accountId, runId: `${m.id}-A`, stepLimit: 20, agents: 1 });
    await h.repos.ledger.abort(`${m.id}-A`);
    await h.repos.ledger.topUp({ accountId: ana.accountId, credits: 5, receipt: 'dev:ledger-match' });
    const rows = (await ana.get('/credits')).body.rows as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(r).not.toHaveProperty('runId');
    expect(rows.find((r) => r.type === 'topup')).toMatchObject({ matchId: null });
    expect(rows.filter((r) => r.matchId === m.id).length).toBeGreaterThan(0);
  });

  it('only a v2 hold key names a match: other keys give null', () => {
    const mat = 'mat_01JB7Z3K9QX4M2T8V6N5R1C0DE';
    expect(ledgerMatchId(`${mat}-A`)).toBe(mat);
    expect(ledgerMatchId(`${mat}-B`)).toBe(mat);
    for (const k of [null, mat, `${mat}-C`, `${mat}-A-x`, 'topup:dev', `x${mat}-A`])
      expect(ledgerMatchId(k), String(k)).toBeNull();
  });
});

describe('DELETE /me/near and royalties', () => {
  it('refuses to unlink with an active listing, then unlinks; resales pay royalties', async () => {
    await h.http().post('/auth/session').set('x-dev-user', 'ana').send({ nearAccountId: 'ana.testnet' });
    const price = '2000000000000000000000000';
    expect((await ana.post(`/market/${skillId}/listing`, { priceYocto: price })).status).toBe(200);
    const blocked = await ana.del('/me/near');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('listing_active');
    // Changing wallets is refused the same way, and the link stays.
    const relink = await h.http().post('/auth/session').set('x-dev-user', 'ana').send({ nearAccountId: 'ana2.testnet' });
    expect(relink.status).toBe(409);
    expect(relink.body.error.code).toBe('listing_active');
    expect((await ana.get('/me')).body.account.nearAccountId).toBe('ana.testnet');

    // Primary sale: no royalty.
    expect((await ben.post(`/market/${skillId}/purchase`, { txHash: `dev:${price}` })).status).toBe(200);
    expect((await ana.get('/me')).body.royaltiesYocto).toBe('0');
    // Resale: 5% (royalty_bps 500) of 2 NEAR to the creator.
    expect((await ben.post(`/market/${skillId}/listing`, { priceYocto: price })).status).toBe(200);
    expect((await cat.post(`/market/${skillId}/purchase`, { txHash: `dev:${price}:2` })).status).toBe(200);
    const royalty = '100000000000000000000000';
    expect((await ana.get('/me')).body.royaltiesYocto).toBe(royalty);
    const written = (await ana.get('/skills?tab=written')).body;
    expect(written.find((r: { id: string }) => r.id === skillId).royaltiesYocto).toBe(royalty);
    expect((await ben.get('/me')).body.royaltiesYocto).toBe('0');

    const ok = await ana.del('/me/near');
    expect(ok.status).toBe(200);
    expect(ok.body.account).toMatchObject({ handle: 'ana', nearAccountId: null });
    expect((await ana.get('/me')).body.account.nearAccountId).toBeNull();
    // Unlinked already: still 200.
    expect((await ana.del('/me/near')).status).toBe(200);
    expect((await h.http().delete('/me/near')).status).toBe(401);
  });
});

describe('GET /me/matches', () => {
  it("lists the caller's v2 matches newest first, from their side", async () => {
    const dee = await h.as('dee');
    const eve = await h.as('eve');
    const won = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: dee.accountId, teamB: eve.accountId });
    await h.repos.v2Matches.finish(won.id, { winner: 'B', reason: 'goal', decidedBy: 'goal', score: { A: 1, B: 3 }, ticks: 90 });
    h.clock.now += 1000;
    const voided = await h.repos.v2Matches.create({ mapId: 'saltmarsh-weir', ranked: false, teamA: eve.accountId, teamB: dee.accountId });
    await h.repos.v2Matches.finish(voided.id, { winner: null, reason: 'declined' });
    h.clock.now += 1000;
    const live = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: dee.accountId, teamB: eve.accountId });

    const res = await eve.get('/me/matches');
    expect(res.status).toBe(200);
    expect(res.body.map((m: { id: string }) => m.id)).toEqual([live.id, voided.id, won.id]);
    const by = Object.fromEntries(res.body.map((m: { id: string }) => [m.id, m]));
    const eloEve = (await h.repos.v2Matches.get(won.id))!.eloDeltas!.find((d) => d.team === 'B')!.delta;
    expect(eloEve).toBeGreaterThan(0);
    expect(by[won.id]).toEqual({
      id: won.id,
      mapId: 'copper-hollow',
      ranked: true,
      practice: false,
      result: 'win',
      score: { you: 3, rival: 1 },
      endedAt: expect.any(String),
      eloDelta: eloEve,
    });
    expect(by[voided.id]).toMatchObject({ result: 'void', score: null, eloDelta: null, ranked: false });
    expect(by[live.id]).toMatchObject({ result: 'live', score: null, endedAt: null, eloDelta: null });

    const dees = (await dee.get('/me/matches?limit=1')).body;
    expect(dees).toHaveLength(1);
    expect((await dee.get('/me/matches')).body.find((m: { id: string }) => m.id === won.id)).toMatchObject({
      result: 'loss',
      score: { you: 1, rival: 3 },
    });
    expect((await ana.get('/me/matches')).body.some((m: { id: string }) => m.id === won.id)).toBe(false);
    expect((await dee.get('/me/matches?limit=99')).status).toBe(400);
    expect((await h.http().get('/me/matches')).status).toBe(401);
  });
});

describe('GET /agents/:id/record', () => {
  const crewOf = (id: string, name: string) => [{ id, name, role: 'Runner', vision: 3, comms: 3, tier: 'standard' }];
  const debrief = (agentId: string, delivered: number, bluffs?: { told: number; landed: number; seenThrough: number }) => ({
    eloDelta: null,
    mvp: agentId,
    goals: [],
    talk: { sent: 0, overheard: 0 },
    credits: { held: 0, used: 0, returned: 0 },
    registry: null,
    agents: [{ agentId, name: 'x', delivered, used: 0, picks: delivered, ...(bluffs ? { bluffs } : {}) }],
  });

  it("counts an agent's season and all-time results, bluffs included, leaving out practice and void matches", async () => {
    const fay = await h.as('fay');
    const gus = await h.as('gus');
    const [mine] = (await fay.get('/agents')).body as { id: string; name: string }[];
    const [theirs] = (await gus.get('/agents')).body as { id: string; name: string }[];
    const crews = (side: 'A' | 'B') =>
      side === 'A' ? { A: crewOf(mine!.id, mine!.name), B: crewOf(theirs!.id, theirs!.name) } : { A: crewOf(theirs!.id, theirs!.name), B: crewOf(mine!.id, mine!.name) };

    expect((await fay.get(`/agents/${mine!.id}/record`)).body.allTime).toMatchObject({ matches: 0, wins: 0 });

    // Ranked win on side A with bluffs (this opens a season), a casual draw on side B stored before
    // bluffs were judged, a practice win and a void: two matches count.
    const ranked = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: fay.accountId, teamB: gus.accountId, crews: crews('A') });
    await h.repos.v2Matches.finish(ranked.id, { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 4, B: 1 }, ticks: 90, debriefs: { A: debrief(mine!.id, 3, { told: 2, landed: 1, seenThrough: 1 }) } });
    const draw = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: gus.accountId, teamB: fay.accountId, crews: crews('B') });
    await h.repos.v2Matches.finish(draw.id, { winner: 'draw', reason: 'time', decidedBy: 'draw', score: { A: 1, B: 1 }, ticks: 150, debriefs: { B: debrief(mine!.id, 1) } });
    const practice = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, practice: true, teamA: fay.accountId, teamB: gus.accountId, crews: crews('A') });
    await h.repos.v2Matches.finish(practice.id, { winner: 'A', reason: 'goal', debriefs: { A: debrief(mine!.id, 4) } });
    const voided = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: fay.accountId, teamB: gus.accountId, crews: crews('A') });
    await h.repos.v2Matches.finish(voided.id, { winner: null, reason: 'declined' });

    const res = await fay.get(`/agents/${mine!.id}/record`);
    expect(res.status).toBe(200);
    const counted = { matches: 2, wins: 1, losses: 0, draws: 1, delivered: 4, bluffsTold: 2, bluffsLanded: 1, seenThrough: 1 };
    expect(res.body.allTime).toEqual(counted);
    expect(res.body.season).toMatchObject({ number: expect.any(Number), endsAt: expect.any(String), ...counted });
    // The rival's agent lost the ranked match.
    expect((await gus.get(`/agents/${theirs!.id}/record`)).body.allTime).toMatchObject({ matches: 2, wins: 0, losses: 1, draws: 1 });

    // Once the season is over and no new one is open, only the all-time record remains.
    h.clock.now += 60 * 86_400_000;
    const late = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: fay.accountId, teamB: gus.accountId, crews: crews('A') });
    await h.repos.v2Matches.finish(late.id, { winner: 'B', reason: 'goal', debriefs: { A: debrief(mine!.id, 0) } });
    const after = (await fay.get(`/agents/${mine!.id}/record`)).body;
    expect(after.season).toBeNull();
    expect(after.allTime).toMatchObject({ matches: 3, losses: 1 });
  });

  it("refuses another player's agent and needs a session", async () => {
    const hal = await h.as('hal');
    const ivy = await h.as('ivy');
    const [ivys] = (await ivy.get('/agents')).body as { id: string }[];
    expect((await hal.get(`/agents/${ivys!.id}/record`)).status).toBe(404);
    expect((await h.http().get(`/agents/${ivys!.id}/record`)).status).toBe(401);
  });
});
