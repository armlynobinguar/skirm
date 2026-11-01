// GET /ops/stats: off without OPS_TOKEN, bearer token required, totals over players, credits, v2
// matches and the daily model spend from Redis.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opsTokenMatches, v2BrainKind } from '../src/controllers/ops.controller';
import { setup, type Harness } from './helpers';

const TOKEN = 'ops-token-for-tests-0123456789abcdef';
const crewStats = (costUsd: number, charged: number) => ({ timeouts: 0, errors: 0, illegal: 0, refusedSays: 0, costUsd, charged });

describe('GET /ops/stats without OPS_TOKEN', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setup();
  });
  afterAll(() => h.close());

  it('answers 404 like an unknown route', async () => {
    const res = await h.http().get('/ops/stats').set('authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('GET /ops/stats', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setup({ config: { OPS_TOKEN: TOKEN, COST_ALERT_DAILY_USD: 10 } });
  });
  afterAll(() => h.close());

  it('refuses a missing or wrong token, and a player session does not count', async () => {
    expect((await h.http().get('/ops/stats')).status).toBe(401);
    expect((await h.http().get('/ops/stats').set('authorization', 'Bearer nope')).status).toBe(401);
    const ada = await h.as('ada');
    const res = await ada.get('/ops/stats');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('sums players, credits, matches and model spend', async () => {
    const ada = await h.as('ada');
    const bo = await h.as('bo');
    await h.repos.ledger.topUp({ accountId: ada.accountId, credits: 500, receipt: 'dev:ops-1' });
    const ended = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ada.accountId, teamB: bo.accountId });
    await h.repos.v2Matches.finish(ended.id, {
      winner: 'A',
      reason: 'goal',
      stats: { A: crewStats(0.125, 30), B: crewStats(0.075, 20) },
    });
    await h.repos.v2Matches.create({ mapId: 'saltmarsh-weir', ranked: false, teamA: bo.accountId, teamB: ada.accountId });
    const today = new Date().toISOString().slice(0, 10);
    h.costs.totals[today] = 0.42;

    const res = await h.http().get('/ops/stats').set('authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.engine).toBe('greedy');
    expect(s.players).toMatchObject({ total: 2, new1d: 2, new7d: 2, withNear: 0 });
    expect(s.credits).toMatchObject({ balance: 500, held: 0, fundedAccounts: 1, creditsPerNear: 1000 });
    expect(s.credits.flow30d).toContainEqual({ type: 'topup', source: 'paid', rows: 1, credits: 500 });
    expect(s.matches).toMatchObject({ live: 1, last1d: 2, last7d: 2, last30d: 2, void30d: 0, charged30d: 50 });
    expect(s.matches.costUsd30d).toBeCloseTo(0.2, 9);
    expect(s.matches.daily).toEqual([{ day: today, matches: 2, costUsd: expect.closeTo(0.2, 9), charged: 50 }]);
    expect(s.ai.dailyBudgetUsd).toBe(10);
    expect(s.ai.spend).toHaveLength(3);
    expect(s.ai.spend[0]).toEqual({ day: today, usd: 0.42 });
    expect(s.ai.spend[1].usd).toBe(0);
    // Totals only: no handle or account id leaks into the payload.
    expect(JSON.stringify(s)).not.toContain(ada.accountId);
    expect(JSON.stringify(s)).not.toContain('"ada"');
  });
});

describe('v2BrainKind', () => {
  it('reports haiku with an OpenRouter key unless V2_BRAIN=greedy', () => {
    expect(v2BrainKind({})).toBe('greedy');
    expect(v2BrainKind({ OPENROUTER_API_KEY: 'sk-or-1' })).toBe('haiku');
    expect(v2BrainKind({ OPENROUTER_API_KEY: 'sk-or-1', V2_BRAIN: 'greedy' })).toBe('greedy');
    expect(v2BrainKind({ V2_BRAIN: 'haiku' })).toBe('greedy');
  });

  it('GET /ops/stats reports the brain the config would build', async () => {
    const h = await setup({ config: { OPS_TOKEN: TOKEN, OPENROUTER_API_KEY: 'sk-or-1' } });
    try {
      const res = await h.http().get('/ops/stats').set('authorization', `Bearer ${TOKEN}`);
      expect(res.body.engine).toBe('haiku');
      h.deps.config.V2_BRAIN = 'greedy';
      expect((await h.http().get('/ops/stats').set('authorization', `Bearer ${TOKEN}`)).body.engine).toBe('greedy');
    } finally {
      await h.close();
    }
  });
});

describe('opsTokenMatches', () => {
  it('takes only an exact bearer token', () => {
    expect(opsTokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(opsTokenMatches(`bearer  ${TOKEN} `, TOKEN)).toBe(true);
    expect(opsTokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(opsTokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(opsTokenMatches(undefined, TOKEN)).toBe(false);
  });
});
