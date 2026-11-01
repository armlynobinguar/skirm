// v2 parity reads and writes: the owner's instructions on PATCH /agents/:id, GET /me rank title and
// ladder place, GET /me/earn-back, GET /leaderboards/players and GET /v2/matches/:id.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let ana: UserClient;
let ben: UserClient;
let cat: UserClient;

beforeAll(async () => {
  h = await setup();
  ana = await h.as('v2ana');
  ben = await h.as('v2ben');
  cat = await h.as('v2cat');
});
afterAll(() => h.close());

const debrief = {
  eloDelta: null,
  mvp: 'agt_1',
  goals: [{ title: 'Deliver', met: true }, { title: 'Quiet hands', met: false, available: false, progress: null }],
  talk: { sent: 4, overheard: 2 },
  credits: { held: 300, used: 120, returned: 180 },
  registry: null,
  agents: [{ agentId: 'agt_1', name: 'Wick', delivered: 2, used: 1, picks: 3 }],
};

describe("PATCH /agents/:id: the owner's instructions", () => {
  it('sets, trims and clears systemPrompt; refuses more than 600 characters', async () => {
    const [rook] = (await ana.get('/agents')).body;
    expect(rook.systemPrompt).toBeNull();
    const set = await ana.patch(`/agents/${rook.id}`, { systemPrompt: '  Hold the dam. Call every fire.  ' });
    expect(set.status).toBe(200);
    expect(set.body.systemPrompt).toBe('Hold the dam. Call every fire.');
    expect((await ana.get('/agents')).body[0].systemPrompt).toBe('Hold the dam. Call every fire.');

    // 600 characters, counted as code points: fine even though it is 1200 UTF-16 units.
    expect((await ana.patch(`/agents/${rook.id}`, { systemPrompt: '🙂'.repeat(600) })).status).toBe(200);
    const long = await ana.patch(`/agents/${rook.id}`, { systemPrompt: 'x'.repeat(601) });
    expect(long.status).toBe(400);
    expect(JSON.stringify(long.body)).not.toContain('xxxx');
    expect((await ana.patch(`/agents/${rook.id}`, { systemPrompt: 42 })).status).toBe(400);

    expect((await ana.patch(`/agents/${rook.id}`, { systemPrompt: '' })).body.systemPrompt).toBeNull();
    await ana.patch(`/agents/${rook.id}`, { systemPrompt: 'again' });
    expect((await ana.patch(`/agents/${rook.id}`, { systemPrompt: null })).body.systemPrompt).toBeNull();
    // Someone else's agent: 404, as for any other field.
    expect((await ben.patch(`/agents/${rook.id}`, { systemPrompt: 'mine now' })).status).toBe(404);
  });
});

describe('ladder, rank title and v2 match record', () => {
  let matchId: string;

  beforeAll(async () => {
    const m = await h.repos.v2Matches.create({
      mapId: 'copper-hollow',
      ranked: true,
      teamA: ana.accountId,
      teamB: ben.accountId,
      crews: {
        A: [{ id: 'agt_1', name: 'Wick', role: 'Builder', vision: 3, comms: 3, tier: 'standard' }],
        B: [{ id: 'agt_2', name: 'Wren', role: 'Scout', vision: 4, comms: 2, tier: 'standard' }],
      },
    });
    matchId = m.id;
    await h.repos.v2Matches.finish(m.id, {
      winner: 'A',
      reason: 'goal',
      decidedBy: 'goal',
      score: { A: 4, B: 2 },
      ticks: 96,
      stats: {
        A: { timeouts: 0, errors: 0, illegal: 1, refusedSays: 0, costUsd: 0.01, charged: 120 },
        B: { timeouts: 1, errors: 0, illegal: 0, refusedSays: 1, costUsd: 0.01, charged: 110 },
      },
      log: { ticks: [] },
      logHash: 'ab'.repeat(32),
      debriefs: { A: debrief, B: { ...debrief, mvp: 'agt_2' } },
    });
  });

  it('GET /leaderboards/players ranks players by Elo with titles; `you` for a ranked caller', async () => {
    const res = await ana.get('/leaderboards/players');
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([
      { rank: 1, account: { id: ana.accountId, handle: 'v2ana' }, elo: 1216, title: 'Breach Runner II', rankedMatches: 1, wins: 1, losses: 0, draws: 0 },
      { rank: 2, account: { id: ben.accountId, handle: 'v2ben' }, elo: 1184, title: 'Breach Runner I', rankedMatches: 1, wins: 0, losses: 1, draws: 0 },
    ]);
    expect(res.body.you).toMatchObject({ rank: 1, title: 'Breach Runner II' });
    // Public; an unranked caller has no `you`.
    const pub = await h.http().get('/leaderboards/players?limit=1');
    expect(pub.status).toBe(200);
    expect(pub.body.rows).toHaveLength(1);
    expect(pub.body.you).toBeUndefined();
    expect((await cat.get('/leaderboards/players')).body.you).toBeUndefined();
    expect((await h.http().get('/leaderboards/players?limit=0')).status).toBe(400);
  });

  it('GET /me has the rank title and ladder position', async () => {
    expect((await ana.get('/me')).body.rank).toMatchObject({ elo: 1216, wins: 1, title: 'Breach Runner II', position: 1 });
    expect((await ben.get('/me')).body.rank).toMatchObject({ elo: 1184, title: 'Breach Runner I', position: 2 });
    expect((await cat.get('/me')).body.rank).toMatchObject({ elo: 1200, title: 'Breach Runner II', position: null });
  });

  it('GET /v2/matches/:id is public; a player also gets `you` and their own debrief', async () => {
    const pub = await h.http().get(`/v2/matches/${matchId}`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({
      id: matchId,
      mapId: 'copper-hollow',
      ranked: true,
      status: 'ended',
      difficulty: null,
      teams: {
        A: { accountId: ana.accountId, handle: 'v2ana', crew: [{ id: 'agt_1', name: 'Wick', role: 'Builder' }] },
        B: { accountId: ben.accountId, handle: 'v2ben', crew: [{ id: 'agt_2', name: 'Wren' }] },
      },
      winner: 'A',
      reason: 'goal',
      decidedBy: 'goal',
      score: { A: 4, B: 2 },
      ticks: 96,
      elo: [
        { accountId: ana.accountId, team: 'A', before: 1200, delta: 16, after: 1216 },
        { accountId: ben.accountId, team: 'B', before: 1200, delta: -16, after: 1184 },
      ],
      stats: { A: { illegal: 1, charged: 120 }, B: { timeouts: 1 } },
      logHash: 'ab'.repeat(32),
      registry: { status: 'pending' },
    });
    expect(Date.parse(pub.body.endedAt)).not.toBeNaN();
    expect(pub.body.log).toBeUndefined();
    expect(pub.body.you).toBeUndefined();
    expect(pub.body.debrief).toBeUndefined();
    expect((await cat.get(`/v2/matches/${matchId}`)).body.debrief).toBeUndefined();

    const mine = await ben.get(`/v2/matches/${matchId}`);
    expect(mine.body.you).toBe('B');
    expect(mine.body.debrief).toMatchObject({ mvp: 'agt_2', eloDelta: -16, registry: 'pending', talk: { sent: 4, overheard: 2 } });

    await h.repos.v2Matches.setRegistry(matchId, 'recorded', 'tx9');
    const written = await ana.get(`/v2/matches/${matchId}`);
    expect(written.body.registry).toEqual({ status: 'recorded', txHash: 'tx9' });
    expect(written.body.debrief).toMatchObject({ mvp: 'agt_1', eloDelta: 16, registry: 'written' });

    expect((await h.http().get('/v2/matches/mat_01JB7Z3K9QX4M2T8V6N5R1C0DF')).status).toBe(404);
    expect((await h.http().get('/v2/matches/nope')).status).toBe(404);
  });

  it('GET /v2/matches/:id hides the rival while the match is live (found, lock-in, play)', async () => {
    const live = await h.repos.v2Matches.create({
      mapId: 'copper-hollow',
      ranked: true,
      teamA: ana.accountId,
      teamB: ben.accountId,
      crews: {
        A: [{ id: 'agt_1', name: 'Wick', role: 'Builder', vision: 3, comms: 3, tier: 'standard' }],
        B: [{ id: 'agt_2', name: 'Wren', role: 'Scout', vision: 4, comms: 2, tier: 'standard' }],
      },
    });
    const hidden = { accountId: null, handle: null, crew: [] };
    expect((await h.http().get(`/v2/matches/${live.id}`)).body.teams).toEqual({ A: hidden, B: hidden });
    const asAna = (await ana.get(`/v2/matches/${live.id}`)).body.teams;
    expect(asAna.A).toMatchObject({ accountId: ana.accountId, handle: 'v2ana', crew: [{ id: 'agt_1' }] });
    expect(asAna.B).toEqual(hidden);
  });

  it('a casual match keeps its difficulty; a void one is never recorded', async () => {
    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, difficulty: 'hard', teamA: ana.accountId, teamB: cat.accountId });
    expect((await h.http().get(`/v2/matches/${m.id}`)).body).toMatchObject({ status: 'live', difficulty: 'hard', winner: null, score: null, elo: [], stats: null });
    await h.repos.v2Matches.finish(m.id, { winner: null, reason: 'declined', fault: 'B' });
    expect((await cat.get(`/v2/matches/${m.id}`)).body).toMatchObject({ status: 'void', registry: { status: 'none' }, you: 'B', debrief: null });
  });
});

describe('GET /me/earn-back', () => {
  it('sums royalties, sales net as seller, prizes and paid v2 spend; rentals are null', async () => {
    const empty = await cat.get('/me/earn-back');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ royaltiesYocto: '0', salesNetYocto: '0', spentCredits: 0, creditsPerNear: 1000, prizesYocto: '0', rentalsYocto: null });
    expect((await h.http().get('/me/earn-back')).status).toBe(401);

    // Ana writes and sells a skill; Ben resells it to Cat.
    const skillId = (await ana.post('/skills', SAMPLE_SKILL)).body.id;
    expect((await ana.post(`/skills/${skillId}/mint`)).status).toBe(200);
    for (const [u, near] of [[ana, 'v2ana.testnet'], [ben, 'v2ben.testnet']] as const)
      await h.http().post('/auth/session').set('x-dev-user', u.handle).send({ nearAccountId: near });
    const price = '2000000000000000000000000';
    expect((await ana.post(`/market/${skillId}/listing`, { priceYocto: price })).status).toBe(200);
    expect((await ben.post(`/market/${skillId}/purchase`, { txHash: `dev:${price}` })).status).toBe(200);
    expect((await ben.post(`/market/${skillId}/listing`, { priceYocto: price })).status).toBe(200);
    expect((await cat.post(`/market/${skillId}/purchase`, { txHash: `dev:${price}:2` })).status).toBe(200);

    // One of Ana's v2 match holds: today's allowance first, then paid credits. Only the paid part
    // counts.
    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: cat.accountId });
    await h.repos.ledger.topUp({ accountId: ana.accountId, credits: 100, receipt: 'v2-earn' });
    await h.repos.ledger.hold({ accountId: ana.accountId, runId: `${m.id}-A`, stepLimit: 90, agents: 1 });
    const charged = await h.repos.ledger.chargeTurns(`${m.id}-A`, Array.from({ length: 75 }, () => ({ agent: 0, reason: null })));
    if (!charged.ok) throw new Error(charged.error);
    const paid = charged.rows.filter((r) => r.type === 'charge' && r.source === 'paid').reduce((n, r) => n + r.amount, 0);
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThan(75);
    await h.repos.ledger.settle(`${m.id}-A`);

    const a = (await ana.get('/me/earn-back')).body;
    // Royalty: 5% of Ben's 2 NEAR resale.
    expect(a.royaltiesYocto).toBe('100000000000000000000000');
    expect(BigInt(a.salesNetYocto)).toBeGreaterThan(0n);
    expect(BigInt(a.salesNetYocto)).toBeLessThan(BigInt(price));
    expect(a.spentCredits).toBe(paid);
    expect(a).toMatchObject({ prizesYocto: '0', rentalsYocto: null });
    const b = (await ben.get('/me/earn-back')).body;
    expect(b.royaltiesYocto).toBe('0');
    // Ben's resale pays the creator royalty on top of the fee, so it nets less than Ana's primary sale.
    expect(BigInt(b.salesNetYocto)).toBeLessThan(BigInt(a.salesNetYocto));
    expect(b.spentCredits).toBe(0);
  });
});
