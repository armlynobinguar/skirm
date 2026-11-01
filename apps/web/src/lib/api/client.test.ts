import { describe, expect, it, vi } from 'vitest';
import { createCredentialsStore } from '../auth/credentials';
import { createApiClient } from './client';
import { ApiError } from './errors';

function setup(handle: string | null = 'ada') {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const credentials = createCredentialsStore({ storage: null, initial: handle ? { kind: 'dev', handle } : null });
  const api = createApiClient({ baseUrl: 'http://api.test', credentials, fetch });
  return { api, fetch, credentials };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('api client', () => {
  it('sends x-dev-user and parses JSON', async () => {
    const { api, fetch } = setup();
    fetch.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api.health()).resolves.toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.test/health');
    expect((init!.headers as Record<string, string>)['x-dev-user']).toBe('ada');
  });

  it('reads credentials per request (sign-in without a new client)', async () => {
    const { api, fetch, credentials } = setup(null);
    fetch.mockResolvedValue(json(200, { account: { id: 'a', handle: 'bo', nearAccountId: null }, created: true }));
    credentials.set({ kind: 'dev', handle: 'bo' });
    await api.createSession();
    const [, init] = fetch.mock.calls[0]!;
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>)['x-dev-user']).toBe('bo');
    expect(init!.body).toBe('{}');
  });

  it('sends a bearer token in privy mode', async () => {
    const { api, fetch, credentials } = setup(null);
    credentials.set({ kind: 'privy', token: 'jwt' });
    fetch.mockResolvedValueOnce(json(200, []));
    await api.agents();
    expect((fetch.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toBe('Bearer jwt');
  });

  it('builds query strings and skips empty values', async () => {
    const { api, fetch } = setup();
    fetch.mockImplementation(async () => json(200, []));
    await api.market({ tag: 'liquid', sort: 'price' });
    await api.seasonStandings('ssn_1', { limit: 5 });
    await api.skill('skl_X', undefined);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'http://api.test/market?tag=liquid&sort=price',
      'http://api.test/seasons/ssn_1/standings?limit=5',
      'http://api.test/skills/skl_X',
    ]);
  });

  it('turns the error shape into ApiError with details and extra fields', async () => {
    const { api, fetch } = setup();
    fetch.mockResolvedValueOnce(
      json(402, { error: { code: 'insufficient_credits', message: 'not enough credits', need: 150, have: 80, details: { matchId: 'mat_1' } } }),
    );
    const err = (await api.buyCosmetic('outfit_gold').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(402);
    expect(err.code).toBe('insufficient_credits');
    expect(err.details).toEqual({ matchId: 'mat_1' });
    expect(err.shortfall).toEqual({ need: 150, have: 80 });
  });

  it('maps network failures and non-JSON errors', async () => {
    const { api, fetch } = setup();
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const net = (await api.me().catch((e: unknown) => e)) as ApiError;
    expect(net.code).toBe('network');
    expect(net.isNetwork).toBe(true);
    fetch.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }));
    const bad = (await api.me().catch((e: unknown) => e)) as ApiError;
    expect([bad.status, bad.code]).toEqual([502, 'http_502']);
  });

  it('unlinkNear and myMatches hit their routes', async () => {
    const { api, fetch } = setup();
    fetch.mockImplementation(async () => json(200, []));
    await api.unlinkNear();
    await api.myMatches();
    expect(fetch.mock.calls[0]![0]).toBe('http://api.test/me/near');
    expect(fetch.mock.calls[0]![1]!.method).toBe('DELETE');
    expect(fetch.mock.calls[1]![0]).toBe('http://api.test/me/matches');
    expect(fetch.mock.calls[1]![1]!.method).toBe('GET');
  });

  it('v2 ladder, earn-back, match record and the system prompt hit their routes', async () => {
    const { api, fetch } = setup();
    fetch.mockImplementation(async () => json(200, {}));
    await api.playerLadder(50);
    await api.earnBack();
    await api.v2Match('mat_1');
    await api.patchAgent('agt_1', { systemPrompt: 'Hold the middle.' });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'http://api.test/leaderboards/players?limit=50',
      'http://api.test/me/earn-back',
      'http://api.test/v2/matches/mat_1',
      'http://api.test/agents/agt_1',
    ]);
    expect(fetch.mock.calls[3]![1]!.method).toBe('PATCH');
    expect(fetch.mock.calls[3]![1]!.body).toBe('{"systemPrompt":"Hold the middle."}');
  });

  it('seasons, the v2 live list, trials and cosmetics hit their routes', async () => {
    const { api, fetch } = setup();
    fetch.mockImplementation(async () => json(200, {}));
    await api.currentSeason();
    await api.seasonStandings('ssn_1', { limit: 50, offset: 50 });
    await api.seasons();
    await api.v2LiveMatches();
    await api.startTrial('skl_X', { agentId: 'agt_1', version: 2 });
    await api.trials('skl_X', 2);
    await api.cosmetics();
    await api.buyCosmetic('outfit_gold');
    expect(fetch.mock.calls.map((c) => [c[1]!.method, c[0]])).toEqual([
      ['GET', 'http://api.test/seasons/current'],
      ['GET', 'http://api.test/seasons/ssn_1/standings?limit=50&offset=50'],
      ['GET', 'http://api.test/seasons'],
      ['GET', 'http://api.test/v2/matches/live'],
      ['POST', 'http://api.test/market/skl_X/trial'],
      ['GET', 'http://api.test/market/skl_X/trials?version=2'],
      ['GET', 'http://api.test/cosmetics'],
      ['POST', 'http://api.test/cosmetics/outfit_gold/buy'],
    ]);
    expect(fetch.mock.calls[4]![1]!.body).toBe('{"agentId":"agt_1","version":2}');
  });

  it('keeps the 429 trial limit and the 402 cosmetic shortfall readable', async () => {
    const { api, fetch } = setup();
    fetch.mockResolvedValueOnce(json(429, { error: { code: 'trial_limit', message: 'at most 3 trials per skill version' } }));
    const limit = (await api.startTrial('skl_X', { agentId: 'agt_1' }).catch((e: unknown) => e)) as ApiError;
    expect([limit.status, limit.code]).toEqual([429, 'trial_limit']);
    fetch.mockResolvedValueOnce(json(402, { error: { code: 'insufficient_credits', message: 'not enough paid credits', need: 100, have: 20 } }));
    const short = (await api.buyCosmetic('outfit_gold').catch((e: unknown) => e)) as ApiError;
    expect(short.shortfall).toEqual({ need: 100, have: 20 });
  });
});
