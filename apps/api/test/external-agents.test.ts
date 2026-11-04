// Bring your own agent over REST: register (secret shown once), bind, rotate, test-ping (signed,
// SSRF-checked), delete; and the pull api a program plays through with its token.
import { DEFAULT_PRACTICE, MAPS_V2, botCrew, createMatch, observe } from '@skirm/engine/v2';
import {
  EXTERNAL_CONTRACT,
  ExternalHttpError,
  MemoryExternalTurnStore,
  verifyExternalSignature,
  type ExternalTurn,
  type SafePostOptions,
} from '@skirm/server';
import { afterEach, describe, expect, it } from 'vitest';
import { bucketOf } from '../src/rate-limit';
import { setup, type Harness } from './helpers';

function aTurn(externalAgentId: string, over: Partial<ExternalTurn> = {}): ExternalTurn {
  const map = MAPS_V2.find((m) => m.id === DEFAULT_PRACTICE.mapId)!;
  const o = observe(createMatch(map, { A: botCrew(1, 'a'), B: botCrew(1, 'b') }), 'a-1');
  return {
    contract: EXTERNAL_CONTRACT,
    type: 'turn',
    turnId: `mat_1.${o.tick}.a-1`,
    externalAgentId,
    matchId: 'mat_1',
    tick: o.tick,
    agentId: 'a-1',
    deadlineMs: 1200,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    observation: o,
    context: { canSpeak: true, plan: null, recent: [], command: null },
    ...over,
  };
}

describe('external agents', () => {
  let h: Harness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it('registers one with a secret and token shown once, lists it without them, and binds it to an own agent', async () => {
    h = await setup();
    const u = await h.as('maker');
    const agents = (await u.get('/agents')).body as { id: string }[];
    const res = await u.post('/external-agents', { name: 'My bot', agentId: agents[0]!.id, webhookUrl: 'https://agent.example.com/hook' });
    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^sks_/);
    expect(res.body.token).toBe(`${res.body.externalAgent.id}.${res.body.secret}`);
    expect(res.body.externalAgent).toMatchObject({ name: 'My bot', agentId: agents[0]!.id, mode: 'webhook', calls: 0, misses: 0 });
    const list = await u.get('/external-agents');
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(res.body.secret);
    // The secret is sealed at rest.
    const row = await h.repos.externalAgents.get(res.body.externalAgent.id);
    expect(Buffer.from(row!.secretCiphertext).toString('utf8')).not.toContain(res.body.secret);
    // One external agent per agent; another player's agent is not found.
    expect((await u.post('/external-agents', { name: 'Twin', agentId: agents[0]!.id })).body.error.code).toBe('agent_bound');
    const other = await h.as('other');
    const theirs = (await other.get('/agents')).body as { id: string }[];
    expect((await u.post('/external-agents', { name: 'Thief', agentId: theirs[0]!.id })).status).toBe(404);
    // A pull agent has no webhook.
    const pull = await u.post('/external-agents', { name: 'Puller' });
    expect(pull.body.externalAgent).toMatchObject({ mode: 'pull', agentId: null, webhookUrl: null });
  });

  it('refuses webhook URLs that are not https to a public host', async () => {
    h = await setup();
    const u = await h.as('maker');
    for (const url of ['http://agent.example.com/hook', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://localhost/x', 'https://[::1]/x', 'https://u:p@agent.example.com/']) {
      const r = await u.post('/external-agents', { name: 'x', webhookUrl: url });
      expect(r.status, url).toBe(422);
      expect(r.body.error.code, url).toBe('invalid_webhook');
    }
  });

  it('caps the number per player', async () => {
    h = await setup();
    const u = await h.as('maker');
    for (let i = 0; i < 5; i++) expect((await u.post('/external-agents', { name: `bot ${i}` })).status).toBe(201);
    expect((await u.post('/external-agents', { name: 'one too many' })).body.error.code).toBe('external_limit');
  });

  it('updates, rotates (the old token stops working) and deletes', async () => {
    const turns = new MemoryExternalTurnStore();
    h = await setup({ deps: { externalTurns: turns } });
    const u = await h.as('maker');
    const agents = (await u.get('/agents')).body as { id: string }[];
    const created = (await u.post('/external-agents', { name: 'Bot' })).body;
    const id = created.externalAgent.id as string;
    const patched = await u.patch(`/external-agents/${id}`, { name: 'Renamed', agentId: agents[1]!.id });
    expect(patched.body).toMatchObject({ name: 'Renamed', agentId: agents[1]!.id });
    expect((await h.http().get('/agent/v1/me').set('authorization', `Bearer ${created.token}`)).status).toBe(200);
    const rotated = (await u.post(`/external-agents/${id}/rotate`)).body;
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.externalAgent.rotatedAt).not.toBeNull();
    expect((await h.http().get('/agent/v1/me').set('authorization', `Bearer ${created.token}`)).body.error.code).toBe('invalid_agent_token');
    expect((await h.http().get('/agent/v1/me').set('authorization', `Bearer ${rotated.token}`)).status).toBe(200);
    // Another player cannot touch it.
    const other = await h.as('other');
    expect((await other.post(`/external-agents/${id}/rotate`)).status).toBe(404);
    expect((await other.del(`/external-agents/${id}`)).status).toBe(404);
    expect((await u.del(`/external-agents/${id}`)).body).toEqual({ deleted: true });
    expect((await u.get('/external-agents')).body).toEqual([]);
  });

  it('test-pings a webhook with a signed ping and reports failures without throwing', async () => {
    const sent: { url: string; body: string; opts: SafePostOptions }[] = [];
    let fail: ExternalHttpError | null = null;
    h = await setup({
      deps: {
        externalPost: async (url, body, opts) => {
          sent.push({ url, body, opts });
          if (fail) throw fail;
          return { status: 204, body: '', latencyMs: 12 };
        },
      },
    });
    const u = await h.as('maker');
    const created = (await u.post('/external-agents', { name: 'Hook', webhookUrl: 'https://agent.example.com/hook' })).body;
    const r = await u.post(`/external-agents/${created.externalAgent.id}/ping`);
    expect(r.body).toEqual({ ok: true, mode: 'webhook', status: 204, latencyMs: 12 });
    const ping = JSON.parse(sent[0]!.body);
    expect(ping).toMatchObject({ contract: 'skirm.agent/v1', type: 'ping', externalAgentId: created.externalAgent.id });
    expect(verifyExternalSignature(created.secret, sent[0]!.opts.headers!['x-skirm-signature'], sent[0]!.body)).toBe(true);
    fail = new ExternalHttpError('blocked_address', 'the webhook resolves to a private or reserved address');
    expect((await u.post(`/external-agents/${created.externalAgent.id}/ping`)).body).toMatchObject({ ok: false, error: 'blocked_address' });
    // A pull agent's ping says whether it has been seen.
    const pull = (await u.post('/external-agents', { name: 'Pull' })).body;
    expect((await u.post(`/external-agents/${pull.externalAgent.id}/ping`)).body).toEqual({ ok: false, mode: 'pull', lastSeenAt: null });
    expect(bucketOf('POST', `/external-agents/${pull.externalAgent.id}/ping`)).toBe('strict');
  });

  it('the pull api: a token reads the open turn and answers it once with a legal action', async () => {
    const turns = new MemoryExternalTurnStore();
    h = await setup({ deps: { externalTurns: turns } });
    const u = await h.as('puller');
    const agents = (await u.get('/agents')).body as { id: string; name: string }[];
    const created = (await u.post('/external-agents', { name: 'Pull', agentId: agents[0]!.id })).body;
    const id = created.externalAgent.id as string;
    const auth = { authorization: `Bearer ${created.token}` };
    const get = (p: string) => h!.http().get(p).set(auth);
    const post = (p: string, b: object) => h!.http().post(p).set(auth).send(b);

    expect((await h.http().get('/agent/v1/turn')).body.error.code).toBe('invalid_agent_token');
    expect((await get('/agent/v1/me')).body).toMatchObject({ contract: 'skirm.agent/v1', externalAgent: { id }, account: { handle: 'puller' }, agent: { id: agents[0]!.id } });
    expect((await get('/agent/v1/turn')).body).toEqual({ contract: 'skirm.agent/v1', turn: null });

    const t = aTurn(id);
    await turns.publish(t, 60_000);
    const got = (await get('/agent/v1/turn?waitMs=500')).body.turn as ExternalTurn;
    expect(got.turnId).toBe(t.turnId);
    expect(got.observation.legal).toEqual(t.observation.legal);
    // A long poll past an answered turn waits and returns nothing.
    expect((await get(`/agent/v1/turn?waitMs=150&after=${encodeURIComponent(t.turnId)}`)).body.turn).toBeNull();

    expect((await post('/agent/v1/action', { turnId: t.turnId, action: { type: 'move', dir: 'Q' } })).body.error.code).toBe('invalid_action');
    expect((await post('/agent/v1/action', { turnId: 'other', action: { type: 'wait' } })).body.error.code).toBe('stale_turn');
    const move = t.observation.legal.find((a) => a.type === 'move')!;
    const ok = await post('/agent/v1/action', { turnId: t.turnId, action: move, say: { channel: 'team', text: 'going' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ accepted: true, action: move });
    expect(await turns.reply(t.turnId)).toEqual({ action: move, say: { channel: 'team', text: 'going' } });
    expect((await post('/agent/v1/action', { turnId: t.turnId, action: { type: 'wait' } })).body.error.code).toBe('already_answered');
    expect((await h.repos.externalAgents.get(id))!.lastSeenAt).not.toBeNull();

    // Past the deadline the greedy brain played it.
    const late = aTurn(id, { turnId: 'late', expiresAt: new Date(Date.now() - 1000).toISOString() });
    await turns.publish(late, 60_000);
    expect((await post('/agent/v1/action', { turnId: 'late', action: { type: 'wait' } })).body.error.code).toBe('too_late');

    expect((await get('/agent/v1/matches')).body).toEqual({ matches: [] });
  });

  it('answers 503 on the turn routes without a relay', async () => {
    h = await setup();
    const u = await h.as('norelay');
    const created = (await u.post('/external-agents', { name: 'Pull' })).body;
    const r = await h.http().get('/agent/v1/turn').set('authorization', `Bearer ${created.token}`);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('relay_unavailable');
  });
});
