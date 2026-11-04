// GET /ops/stats: off without OPS_TOKEN, bearer token required, totals over players, credits, v2
// matches and the daily model spend from Redis.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opsTokenMatches, v2Engine } from '../src/controllers/ops.controller';
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
    expect(s.model).toBeNull();
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

describe('v2Engine', () => {
  it('reports the model and its id with a model key unless V2_BRAIN=greedy', () => {
    expect(v2Engine({})).toEqual({ engine: 'greedy', model: null });
    expect(v2Engine({ OPENROUTER_API_KEY: 'sk-or-1' })).toEqual({ engine: 'model', model: 'anthropic/claude-haiku-5.5' });
    expect(v2Engine({ LLM_API_KEY: 'sk-1', LLM_MODEL: 'gpt-5-mini' })).toEqual({ engine: 'model', model: 'gpt-5-mini' });
    expect(v2Engine({ OPENROUTER_API_KEY: 'sk-or-1', V2_BRAIN: 'greedy' }).engine).toBe('greedy');
    expect(v2Engine({ V2_BRAIN: 'haiku' }).engine).toBe('greedy');
  });

  it('GET /ops/stats and /ops/talk-rates report the brain the config would build', async () => {
    const h = await setup({ config: { OPS_TOKEN: TOKEN, LLM_API_KEY: 'sk-1', LLM_MODEL: 'llama-3.3-70b' } });
    try {
      const res = await h.http().get('/ops/stats').set('authorization', `Bearer ${TOKEN}`);
      expect(res.body).toMatchObject({ engine: 'model', model: 'llama-3.3-70b' });
      const rates = await h.http().get('/ops/talk-rates').set('authorization', `Bearer ${TOKEN}`);
      expect(rates.body).toMatchObject({ engine: 'model', model: 'llama-3.3-70b' });
      h.deps.config.V2_BRAIN = 'greedy';
      expect((await h.http().get('/ops/stats').set('authorization', `Bearer ${TOKEN}`)).body).toMatchObject({ engine: 'greedy', model: null });
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

describe('GET /ops/talk-rates', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setup({ config: { OPS_TOKEN: TOKEN } });
  });
  afterAll(() => h.close());

  const crew = (tiers: string[]) => tiers.map((tier, i) => ({ id: `agt_${i}`, name: `A${i}`, role: 'Runner', vision: 3, comms: 3, tier }));
  const stats = (costUsd: number) => ({ timeouts: 0, errors: 0, illegal: 0, refusedSays: 0, costUsd, charged: 0 });

  it('measures model spend per agent-tick for single-tier crews and suggests rates', async () => {
    expect((await h.http().get('/ops/talk-rates')).status).toBe(401);
    const ana = await h.as('ana');
    const ben = await h.as('ben');
    const play = async (ranked: boolean, A: string[], B: string[], cost: { A: number; B: number }) => {
      const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked, teamA: ana.accountId, teamB: ben.accountId, crews: { A: crew(A), B: crew(B) } });
      await h.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'time', ticks: 100, stats: { A: stats(cost.A), B: stats(cost.B) } });
    };
    // Standard (ranked counts as Standard whatever the record says) and Open crews; a mixed crew and a
    // greedy crew (no spend) are left out.
    await play(true, ['open', 'open'], ['standard'], { A: 0.032, B: 0.016 });
    await play(false, ['open'], ['open', 'standard'], { A: 0.06, B: 0.5 });
    await play(false, ['quiet'], ['standard'], { A: 0, B: 0 });
    const res = await h.http().get('/ops/talk-rates').set('authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ days: 30, margin: 1.25, creditUsd: 0.001 });
    // Standard: 300 agent-ticks, 0.048 USD → 0.00016 a tick → 20 per 100.
    expect(res.body.tiers.standard).toMatchObject({ crews: 2, agentTicks: 300, suggestedRatePer100: 20, currentRatePer100: 20, enough: false });
    expect(res.body.tiers.open).toMatchObject({ crews: 1, agentTicks: 100, suggestedRatePer100: 75 });
    expect(res.body.tiers.quiet).toMatchObject({ crews: 0, suggestedRatePer100: null });
  });
});
