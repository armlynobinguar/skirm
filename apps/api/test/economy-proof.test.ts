// Seasons, the v2 live list, Exchange proof on the market (ranked records, benchmark, counters),
// buyers' trials and premium cosmetics.
import { SYSTEM_ACCOUNT_ID, schema } from '@skirm/db';
import { FREE_OUTFIT_COUNT, OUTFIT_COLORS } from '@skirm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let seller: UserClient;
let ana: UserClient;
let ben: UserClient;
let buyer: UserClient;
/** X is carried by the winning crew, Y by the losing one, Z never plays. */
let X: string;
let Y: string;
let Z: string;

/** A played gauntlet as the worker stores it: every second pick hears hijack lines. */
const GAUNTLET = [
  { outcome: 'win', hijack: false, leaks: 0, abuse: 0 },
  { outcome: 'win', hijack: true, leaks: 2, abuse: 0 },
  { outcome: 'win', hijack: false, leaks: 0, abuse: 0 },
  { outcome: 'loss', hijack: true, leaks: 0, abuse: 1 },
  { outcome: 'win', hijack: false, leaks: 1, abuse: 0 },
  { outcome: 'loss', hijack: true, leaks: 0, abuse: 0 },
].map((r, i) => ({
  mapId: 'copper-hollow',
  difficulty: i % 4 < 2 ? 'easy' : 'normal',
  ...r,
  delivered: 5,
  injected: r.hijack ? 4 : 0,
}));

const crew = (id: string, name: string, skill: string) => [
  {
    id,
    name,
    role: 'Builder',
    vision: 3,
    comms: 3,
    tier: 'standard',
    skills: [{ id: skill, version: 1 }],
  },
];

async function mintSkill(name: string): Promise<string> {
  const id = (await seller.post('/skills', { ...SAMPLE_SKILL, name })).body.id as string;
  expect((await seller.post(`/skills/${id}/mint`)).status).toBe(200);
  return id;
}

beforeAll(async () => {
  h = await setup();
  seller = await h.as('ecoseller');
  ana = await h.as('ecoana');
  ben = await h.as('ecoben');
  buyer = await h.as('ecobuyer');
  X = await mintSkill('Skill X');
  Y = await mintSkill('Skill Y');
  Z = await mintSkill('Skill Z');
  // One ranked match: Ana's crew carries X and beats Ben's crew carrying Y.
  const m = await h.repos.v2Matches.create({
    mapId: 'copper-hollow',
    ranked: true,
    teamA: ana.accountId,
    teamB: ben.accountId,
    crews: { A: crew('agt_x', 'Wick', X), B: crew('agt_y', 'Wren', Y) },
  });
  await h.repos.v2Matches.finish(m.id, {
    winner: 'A',
    reason: 'goal',
    score: { A: 3, B: 1 },
    ticks: 80,
  });
});
afterAll(() => h.close());

describe('market proof', () => {
  it('cards carry the ranked record and benchmark score from one grouped query', async () => {
    await h.repos.proof.finishBenchmark(X, 1, {
      brain: 'model',
      seeds: GAUNTLET.map(({ mapId, difficulty, hijack }) => ({ mapId, difficulty, hijack })),
      matches: 6,
      wins: 4,
      losses: 2,
      draws: 0,
      deliveries: 30,
      leaks: 3,
      manipulations: 2,
      score: 0.6,
      results: GAUNTLET,
    });
    await h.repos.proof.markNeedsModel(Y, 1);

    const cards = (await buyer.get('/market')).body as {
      skill: { id: string };
      rankedWinRate: number | null;
      rankedMatches: number;
      benchmarkScore: number | null;
    }[];
    const by = Object.fromEntries(cards.map((c) => [c.skill.id, c]));
    expect(by[X]).toMatchObject({ rankedWinRate: 1, rankedMatches: 1, benchmarkScore: 0.6 });
    expect(by[Y]).toMatchObject({ rankedWinRate: 0, rankedMatches: 1, benchmarkScore: null });
    expect(by[Z]).toMatchObject({ rankedWinRate: null, rankedMatches: 0, benchmarkScore: null });

    const order = async (sort: string) =>
      ((await buyer.get(`/market?sort=${sort}`)).body as { skill: { id: string } }[]).map(
        (c) => c.skill.id,
      );
    // Nulls sort last.
    expect(await order('winrate')).toEqual([X, Y, Z]);
    // Win rate is the default sort.
    expect(await order('')).toEqual([X, Y, Z]);
    expect((await order('benchmark'))[0]).toBe(X);
    expect((await buyer.get('/market?sort=bogus')).status).toBe(400);
  });

  it('detail adds the benchmark, ranked record, counters and the caller’s trials', async () => {
    const x = (await buyer.get(`/market/${X}`)).body;
    expect(x.benchmark).toEqual({
      status: 'done',
      brain: 'model',
      seeds: GAUNTLET.map(({ mapId, difficulty, hijack }) => ({ mapId, difficulty, hijack })),
      matches: 6,
      wins: 4,
      losses: 2,
      draws: 0,
      // Items delivered, not hijack lines: the rates come from the per-match results.
      deliveries: 30,
      // 2 of 6 matches leaked (3 leaked lines in all); 2 of the 3 hijack matches were manipulated.
      leakRate: 2 / 6,
      manipulationRate: 2 / 3,
      score: expect.closeTo(0.6, 5),
      needsModel: false,
    });
    expect(x.ranked).toEqual({
      matches: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      perMap: [{ mapId: 'copper-hollow', matches: 1, wins: 1, losses: 0, draws: 0 }],
    });
    expect(x.counters).toEqual({
      vs: [{ skillId: Y, version: 1, matches: 1, wins: 1, losses: 0, draws: 0 }],
    });
    expect(x.trials).toEqual({ used: 0, left: 3 });

    const y = (await buyer.get(`/market/${Y}`)).body;
    expect(y.benchmark).toMatchObject({
      status: 'needs_model',
      score: null,
      needsModel: true,
      leakRate: null,
      manipulationRate: null,
    });
    expect(y.ranked).toMatchObject({ matches: 1, wins: 0, losses: 1 });
    const z = (await buyer.get(`/market/${Z}`)).body;
    expect(z.benchmark).toMatchObject({ status: 'queued', score: null, needsModel: false });
    expect(z.ranked).toEqual({ matches: 0, wins: 0, losses: 0, draws: 0, perMap: [] });
    expect(z.counters).toEqual({ vs: [] });
  });
});

describe('trials', () => {
  it('queues a trial with an own agent of a version the caller does not own, at most 3', async () => {
    const [mine] = (await buyer.get('/agents')).body as { id: string }[];
    const [theirs] = (await seller.get('/agents')).body as { id: string }[];

    expect((await buyer.post(`/market/${X}/trial`, { agentId: theirs!.id })).status).toBe(404);
    expect((await buyer.post(`/market/${X}/trial`, { agentId: 'nope' })).status).toBe(400);
    expect((await buyer.post(`/market/${X}/trial`, { agentId: mine!.id, version: 9 })).status).toBe(
      404,
    );
    const own = await seller.post(`/market/${X}/trial`, { agentId: theirs!.id });
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe('skill_owned');
    expect((await h.http().post(`/market/${X}/trial`).send({ agentId: mine!.id })).status).toBe(
      401,
    );

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await buyer.post(`/market/${X}/trial`, { agentId: mine!.id });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ trialId: expect.stringMatching(/^trl_/), status: 'queued' });
      expect(h.benchmarks.jobs.at(-1)).toEqual({ kind: 'trial', trialId: res.body.trialId });
      ids.push(res.body.trialId);
    }
    const capped = await buyer.post(`/market/${X}/trial`, { agentId: mine!.id });
    expect(capped.status).toBe(429);
    expect(capped.body.error).toMatchObject({
      code: 'trial_limit',
      details: { limit: 3, used: 3 },
    });
    expect((await buyer.get(`/market/${X}`)).body.trials).toEqual({ used: 3, left: 0 });

    // An offline trial played nothing, so it gives the slot back.
    await h.repos.proof.finishTrial(ids[0]!, { status: 'needs_model' });
    expect((await buyer.get(`/market/${X}`)).body.trials).toEqual({ used: 2, left: 1 });
    expect((await buyer.post(`/market/${X}/trial`, { agentId: mine!.id })).status).toBe(202);

    const list = (await buyer.get(`/market/${X}/trials`)).body as {
      id: string;
      status: string;
      needsModel: boolean;
    }[];
    expect(list).toHaveLength(4);
    expect(list.find((t) => t.id === ids[0])).toMatchObject({
      status: 'needs_model',
      needsModel: true,
    });
    // Newest first: the fourth, then the first three in reverse.
    expect(list.map((t) => t.id).slice(1)).toEqual([...ids].reverse());
    // Trials are the caller's own.
    expect((await seller.get(`/market/${X}/trials`)).body).toEqual([]);
    expect((await buyer.get(`/market/${X}/trials?version=1`)).body).toHaveLength(4);
    expect((await buyer.get('/market/nope/trials')).status).toBe(404);
  });

  it('a trial that cannot be queued is 503 and marked failed', async () => {
    const [mine] = (await buyer.get('/agents')).body as { id: string }[];
    h.benchmarks.fail = true;
    try {
      const res = await buyer.post(`/market/${Y}/trial`, { agentId: mine!.id });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('queue_unavailable');
    } finally {
      h.benchmarks.fail = false;
    }
    const [t] = (await buyer.get(`/market/${Y}/trials`)).body;
    expect(t).toMatchObject({ status: 'failed', results: { error: 'queue_unavailable' } });
  });
});

describe('GET /v2/matches/live', () => {
  it('lists live matches with handles and crew sizes, the practice bot as Greedy bot', async () => {
    const ranked = await h.repos.v2Matches.create({
      mapId: 'copper-hollow',
      ranked: true,
      teamA: ana.accountId,
      teamB: ben.accountId,
      crews: {
        A: [...crew('agt_s1', 'SecretAgentOne', X), ...crew('agt_s2', 'SecretAgentTwo', X)],
        B: crew('agt_s3', 'SecretAgentThree', Y),
      },
    });
    const practice = await h.repos.v2Matches.create({
      mapId: 'copper-hollow',
      ranked: false,
      practice: true,
      difficulty: 'easy',
      teamA: buyer.accountId,
      teamB: SYSTEM_ACCOUNT_ID,
      crews: { A: crew('agt_p1', 'SecretAgentFour', Z), B: crew('agt_bot', 'Bot', Z) },
    });
    const res = await h.http().get('/v2/matches/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: practice.id,
        mapId: 'copper-hollow',
        difficulty: 'easy',
        ranked: false,
        practice: true,
        startedAt: expect.any(String),
        teams: { A: { handle: 'ecobuyer', size: 1 }, B: { handle: 'Greedy bot', size: 1 } },
      },
      {
        id: ranked.id,
        mapId: 'copper-hollow',
        difficulty: null,
        ranked: true,
        practice: false,
        startedAt: expect.any(String),
        teams: { A: { handle: 'ecoana', size: 2 }, B: { handle: 'ecoben', size: 1 } },
      },
    ]);
    // Crews stay hidden; the system account's handle never shows.
    expect(res.text).not.toContain('SecretAgent');
    expect(res.text).not.toContain('agt_');
    expect(res.text).not.toContain('@skirm');

    // Ended matches drop off; `live` is not read as a match id.
    await h.repos.v2Matches.finish(practice.id, { winner: 'A', reason: 'goal' });
    expect((await h.http().get('/v2/matches/live')).body.map((m: { id: string }) => m.id)).toEqual([
      ranked.id,
    ]);
    await h.repos.v2Matches.finish(ranked.id, { winner: null, reason: 'aborted' });
    expect((await h.http().get('/v2/matches/live')).body).toEqual([]);
    expect((await h.http().get(`/v2/matches/${ranked.id}`)).body).toMatchObject({
      id: ranked.id,
      status: 'void',
    });
  });
});

describe('cosmetics', () => {
  it('lists the catalog, buys with paid credits only and shows ownership on /me', async () => {
    const u = await h.as('ecolook');
    const list = await u.get('/cosmetics');
    expect(list.status).toBe(200);
    expect(list.body.owned).toEqual([]);
    expect(list.body.items).toContainEqual(
      expect.objectContaining({
        id: 'outfit_gold',
        kind: 'outfit',
        index: FREE_OUTFIT_COUNT,
        priceCredits: 100,
        color: OUTFIT_COLORS[FREE_OUTFIT_COUNT],
      }),
    );
    expect((await h.http().get('/cosmetics')).status).toBe(401);

    // The free allowance never pays for a cosmetic.
    const broke = await u.post('/cosmetics/outfit_gold/buy');
    expect(broke.status).toBe(402);
    expect(broke.body.error).toMatchObject({ code: 'insufficient_credits', need: 100, have: 0 });
    expect((await u.post('/cosmetics/no_such_item/buy')).status).toBe(404);

    expect(
      (await u.post('/credits/deposits', { txHash: 'dev:1000000000000000000000000' })).status,
    ).toBe(200);
    const bought = await u.post('/cosmetics/outfit_gold/buy');
    expect(bought.status).toBe(200);
    expect(bought.body).toEqual({ owned: ['outfit_gold'] });
    const credits = (await u.get('/me')).body.credits;
    expect(credits.balance).toBe(900);
    // Buying it again charges nothing.
    expect((await u.post('/cosmetics/outfit_gold/buy')).body).toEqual({ owned: ['outfit_gold'] });
    const me = (await u.get('/me')).body;
    expect(me.credits.balance).toBe(900);
    expect(me.cosmetics).toEqual(['outfit_gold']);
    expect((await u.get('/cosmetics')).body.owned).toEqual(['outfit_gold']);
  });

  it('PATCH /agents/:id refuses a premium look the owner has not bought, before writing anything', async () => {
    const u = await h.as('ecowear');
    const [agent] = (await u.get('/agents')).body as {
      id: string;
      name: string;
      appearance: Record<string, unknown>;
    }[];
    const look = { ...agent!.appearance };

    const refused = await u.patch(`/agents/${agent!.id}`, {
      name: 'Shiny',
      appearance: { ...look, outfit: FREE_OUTFIT_COUNT + 1 },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({
      code: 'cosmetic_not_owned',
      details: { items: ['outfit_obsidian'] },
    });
    const after = (await u.get('/agents')).body.find((a: { id: string }) => a.id === agent!.id);
    expect(after).toMatchObject({ name: agent!.name, appearance: look });

    // Free colours need nothing; a bought one is worn.
    expect(
      (
        await u.patch(`/agents/${agent!.id}`, {
          appearance: { ...look, outfit: FREE_OUTFIT_COUNT - 1 },
        })
      ).status,
    ).toBe(200);
    await h.repos.cosmetics.grant(u.accountId, 'outfit_obsidian');
    const worn = await u.patch(`/agents/${agent!.id}`, {
      appearance: { ...look, outfit: FREE_OUTFIT_COUNT + 1 },
    });
    expect(worn.status).toBe(200);
    expect(worn.body.appearance.outfit).toBe(FREE_OUTFIT_COUNT + 1);
    // Beyond the palette is still a validation error.
    expect(
      (
        await u.patch(`/agents/${agent!.id}`, {
          appearance: { ...look, outfit: OUTFIT_COLORS.length },
        })
      ).status,
    ).toBe(400);
  });
});

describe('seasons', () => {
  it('current season: pool, top standings after a ranked finish, the caller’s row and projected prizes', async () => {
    const cur = await ana.get('/seasons/current');
    expect(cur.status).toBe(200);
    const season = cur.body.season;
    expect(season).toMatchObject({
      number: 1,
      status: 'open',
      poolSource: 'local',
      poolYocto: '0',
    });
    expect(season.splitBps).toEqual([3000, 2000, 1500, 500, 500, 500, 500, 500, 500, 500]);
    expect(Date.parse(season.endsAt) - Date.parse(season.startsAt)).toBe(14 * 86_400_000);

    // Fund it (season 1 is the only season so far).
    await h.db.update(schema.seasons).set({ fundedYocto: '1000000' });
    const body = (await ben.get('/seasons/current')).body;
    expect(body.season.poolYocto).toBe('1000000');
    // The ranked finish in beforeAll counted: win 25, loss 5.
    expect(body.top).toEqual([
      {
        rank: 1,
        account: { id: ana.accountId, handle: 'ecoana' },
        points: 25,
        wins: 1,
        losses: 0,
        draws: 0,
        matches: 1,
        elo: expect.any(Number),
        projectedPrizeYocto: '300000',
      },
      expect.objectContaining({
        rank: 2,
        account: { id: ben.accountId, handle: 'ecoben' },
        points: 5,
        losses: 1,
        projectedPrizeYocto: '200000',
      }),
    ]);
    expect(body.you).toMatchObject({ rank: 2, points: 5 });
    // Signed out: no `you`; without a ranked match: no `you` either.
    expect((await h.http().get('/seasons/current')).body.you).toBeUndefined();
    expect((await buyer.get('/seasons/current')).body.you).toBeUndefined();
  });

  it('standings page, the season list and 404s', async () => {
    const { season } = (await h.http().get('/seasons/current')).body;
    const page = await h.http().get(`/seasons/${season.id}/standings?limit=1&offset=1`);
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(2);
    expect(page.body.rows).toEqual([
      expect.objectContaining({ rank: 2, account: expect.objectContaining({ handle: 'ecoben' }) }),
    ]);
    expect((await h.http().get(`/seasons/${season.id}/standings?limit=0`)).status).toBe(400);
    expect((await h.http().get('/seasons/nope/standings')).status).toBe(404);
    expect((await h.http().get('/seasons/ssn_01JB7Z3K9QX4M2T8V6N5R1C0DE/standings')).status).toBe(
      404,
    );
    const list = await h.http().get('/seasons');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      expect.objectContaining({ id: season.id, number: 1, poolYocto: '1000000' }),
    ]);
  });

  it('a locked season shows its written prizes, which count in earn-back; the next season opens', async () => {
    const { season } = (await h.http().get('/seasons/current')).body;
    const saved = h.clock.now;
    try {
      h.clock.now = Date.parse(season.endsAt) + 120_000;
      await h.repos.seasons.lock(season.id);
      const rows = (await h.http().get(`/seasons/${season.id}/standings`)).body.rows;
      expect(rows.map((r: { projectedPrizeYocto: string }) => r.projectedPrizeYocto)).toEqual([
        '300000',
        '200000',
      ]);
      expect((await ana.get('/me/earn-back')).body.prizesYocto).toBe('300000');
      expect((await ben.get('/me/earn-back')).body.prizesYocto).toBe('200000');
      const next = (await h.http().get('/seasons/current')).body;
      // Opened at max(previous end, now): no season that already ended is ever created.
      expect(next.season).toMatchObject({
        number: 2,
        status: 'open',
        startsAt: new Date(h.clock.now).toISOString(),
      });
      expect(next.top).toEqual([]);
      const all = (await h.http().get('/seasons')).body;
      expect(all.map((s: { number: number; status: string }) => [s.number, s.status])).toEqual([
        [2, 'open'],
        [1, 'locked'],
      ]);
    } finally {
      h.clock.now = saved;
    }
  });
});

describe('GET /v2/matches/recorded', () => {
  it('lists ended ranked matches recorded on NEAR, latest first, without crews', async () => {
    // Last in the file and on its own accounts: these ranked finishes add season standings.
    const rae = await h.as('ecorae');
    const rex = await h.as('ecorex');
    const make = async (ranked: boolean) =>
      h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked, teamA: rae.accountId, teamB: rex.accountId, crews: { A: crew('agt_r1', 'HiddenOne', X), B: crew('agt_r2', 'HiddenTwo', Y) } });
    const older = await make(true);
    await h.repos.v2Matches.finish(older.id, { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 3, B: 1 }, ticks: 80 });
    await h.repos.v2Matches.setRegistry(older.id, 'recorded', 'Tx1');
    h.clock.now += 1000;
    const newer = await make(true);
    await h.repos.v2Matches.finish(newer.id, { winner: 'B', reason: 'goal', decidedBy: 'goal', score: { A: 2, B: 3 }, ticks: 90 });
    await h.repos.v2Matches.setRegistry(newer.id, 'recorded', 'Tx2');
    const pending = await make(true);
    await h.repos.v2Matches.finish(pending.id, { winner: 'A', reason: 'goal', score: { A: 3, B: 0 }, ticks: 70 });
    const casual = await make(false);
    await h.repos.v2Matches.finish(casual.id, { winner: 'A', reason: 'goal', score: { A: 3, B: 0 }, ticks: 70 });

    const res = await h.http().get('/v2/matches/recorded');
    expect(res.status).toBe(200);
    expect(res.body.map((m: { id: string }) => m.id)).toEqual([newer.id, older.id]);
    expect(res.body[0]).toEqual({
      id: newer.id,
      mapId: 'copper-hollow',
      endedAt: expect.any(String),
      winner: 'B',
      score: { A: 2, B: 3 },
      handles: { A: 'ecorae', B: 'ecorex' },
    });
    expect(JSON.stringify(res.body)).not.toContain('Hidden');
  });
});
