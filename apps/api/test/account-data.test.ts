// The privacy policy's choices: export everything (own skill prompts decrypted, own debrief side
// only) and delete the account (confirmed; refused mid-match or with an open listing; sign-in, NEAR
// link, system prompts and rental offers go; paid passes for the agents stay usable).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_SKILL, setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());
afterEach(() => vi.restoreAllMocks());

describe('GET /me/export', () => {
  it("downloads the caller's rows with their own skill prompts and only their side of each debrief", async () => {
    const ana = await h.as('ana_x');
    const ben = await h.as('ben_x');
    const made = await ana.post('/skills', { ...SAMPLE_SKILL, name: 'Dam First', prompt: 'Dam the left channel first.' });
    expect(made.status).toBe(201);
    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId });
    const debrief = (sent: number) => ({ eloDelta: null, mvp: null, goals: [], talk: { sent, overheard: 0 }, credits: { held: 0, used: 0, returned: 0 }, registry: null, agents: [] });
    await h.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal', debriefs: { A: debrief(7), B: debrief(99) } });

    const res = await ana.get('/me/export');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accountId: ana.accountId, account: [expect.objectContaining({ handle: 'ana_x' })] });
    expect(res.body.agents.length).toBeGreaterThan(0);
    expect(res.body.skillPrompts).toEqual([expect.objectContaining({ name: 'Dam First', prompt: 'Dam the left channel first.' })]);
    const match = res.body.matches.find((x: { id: string }) => x.id === m.id);
    expect(match.debriefs).toEqual({ A: expect.objectContaining({ talk: { sent: 7, overheard: 0 } }) });
    expect(JSON.stringify(res.body)).not.toContain('"sent":99');
    // Someone else's export never carries the caller's skill text.
    expect(JSON.stringify((await ben.get('/me/export')).body)).not.toContain('Dam the left channel first.');
    expect((await h.http().get('/me/export')).status).toBe(401);
  });
});

describe('DELETE /me', () => {
  it('needs the handle typed, and refuses a live match or an open listing', async () => {
    const cal = await h.as('cal_x');
    expect((await cal.del('/me', { confirm: 'nope' })).body.error.code).toBe('confirm_mismatch');
    const busy = vi.spyOn(Object.getPrototypeOf(h.repos.agents) as { busyAgents: () => Promise<string[]> }, 'busyAgents').mockResolvedValue(['agt_x']);
    expect((await cal.del('/me', { confirm: 'cal_x' })).body.error.code).toBe('agent_busy');
    busy.mockRestore();
    const listed = vi.spyOn(Object.getPrototypeOf(h.repos.market) as { hasActiveListing: () => Promise<boolean> }, 'hasActiveListing').mockResolvedValue(true);
    expect((await cal.del('/me', { confirm: 'cal_x' })).body.error.code).toBe('listing_active');
    listed.mockRestore();
    expect((await cal.get('/me')).status).toBe(200);
  });

  it('removes the sign-in, NEAR link, system prompts and offers, keeps paid passes usable, and never signs in again', async () => {
    await h.http().post('/auth/session').set('x-dev-user', 'dee_x').send({ nearAccountId: 'dee.testnet' });
    const dee = await h.as('dee_x');
    const eve = await h.as('eve_x');
    const [agent] = (await dee.get('/agents')).body as { id: string }[];
    await dee.patch(`/agents/${agent!.id}`, { systemPrompt: 'Play safe.' });
    const offer = (await dee.put(`/agents/${agent!.id}/rental`, { priceYocto: '1000' })).body.offer;
    expect((await eve.post(`/rentals/${offer.offerId}`, { txHash: 'dev:1000:p1' })).status).toBe(200);

    const res = await dee.del('/me', { confirm: 'dee_x' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    const row = (await h.repos.accounts.get(dee.accountId))!;
    expect(row).toMatchObject({ privyDid: null, nearAccountId: null });
    expect(row.handle).toMatch(/^~deleted-/);
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect((await h.repos.agents.get(agent!.id))!.systemPrompt).toBeNull();
    expect(await h.repos.rentals.offerFor(agent!.id)).toBeUndefined();
    // Eve's paid pass for the agent still works.
    expect(await h.repos.rentals.rentable(eve.accountId, [agent!.id])).toEqual([agent!.id]);
    // The old session is gone; signing in with the old handle makes a brand-new account.
    expect((await dee.get('/me')).status).toBe(401);
    const again = await h.http().post('/auth/session').set('x-dev-user', 'dee_x').send({});
    expect(again.status).toBe(200);
    expect(again.body.account.id).not.toBe(dee.accountId);
  });
});
