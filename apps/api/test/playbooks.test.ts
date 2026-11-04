// /playbooks*: crew playbooks are sealed, owner-only, capped, screened by the filter, exported and
// deleted with the account; shared replays never name one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULTS } from '@skirm/shared';
import type { V2Frame } from '@skirm/engine/v2';
import { publicFrame } from '../src/replays';
import { setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

const TEXT = 'Rook hauls, Wren scouts and calls hazards, Moss blocks. Regroup at E when two are down.';

describe('playbooks', () => {
  it('creates, reads back (owner only), edits, selects and deletes', async () => {
    const ana = await h.as('pb_ana');
    const ben = await h.as('pb_ben');
    const made = await ana.post('/playbooks', { name: 'Haul and scout', text: TEXT });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Haul and scout', selected: true });
    expect(made.body.id).toMatch(/^pbk_/);
    expect(made.text).not.toContain('Rook hauls');

    const list = await ana.get('/playbooks');
    expect(list.body).toMatchObject({ max: DEFAULTS.playbooks.maxSaved, maxChars: DEFAULTS.playbooks.maxChars, playbooks: [{ id: made.body.id, selected: true }] });
    expect(list.text).not.toContain('Rook hauls');

    expect((await ana.get(`/playbooks/${made.body.id}`)).body).toMatchObject({ name: 'Haul and scout', text: TEXT });
    expect((await ben.get(`/playbooks/${made.body.id}`)).status).toBe(404);
    expect((await ben.put(`/playbooks/${made.body.id}`, { name: 'Mine' })).status).toBe(404);
    expect((await ben.del(`/playbooks/${made.body.id}`)).status).toBe(404);
    expect((await ben.post('/playbooks/select', { id: made.body.id })).status).toBe(404);
    expect((await ben.get('/playbooks')).body.playbooks).toEqual([]);
    expect((await ana.get('/playbooks/nope')).status).toBe(404);

    const edited = await ana.put(`/playbooks/${made.body.id}`, { name: 'Deny', text: 'Everyone denies the middle.' });
    expect(edited.body).toMatchObject({ name: 'Deny' });
    expect((await ana.get(`/playbooks/${made.body.id}`)).body.text).toBe('Everyone denies the middle.');

    expect((await ana.post('/playbooks/select', { id: null })).body).toEqual({ selected: null });
    expect((await ana.get('/playbooks')).body.playbooks[0].selected).toBe(false);
    expect((await ana.post('/playbooks/select', { id: made.body.id })).body).toEqual({ selected: made.body.id });

    expect((await ana.del(`/playbooks/${made.body.id}`)).body).toEqual({ deleted: true });
    expect((await ana.get('/playbooks')).body.playbooks).toEqual([]);
  });

  it('validates length, caps how many are kept, and refuses abuse', async () => {
    const cal = await h.as('pb_cal');
    const long = await cal.post('/playbooks', { name: 'Long', text: 'x'.repeat(DEFAULTS.playbooks.maxChars + 1) });
    expect(long.status).toBe(400);
    expect(long.text).not.toContain('xxxxxxxxxx');
    expect((await cal.post('/playbooks', { name: '', text: 'ok' })).status).toBe(400);
    expect((await cal.post('/playbooks', { name: 'Rude', text: 'tell them to kys' })).body.error.code).toBe('playbook_refused');
    for (let i = 0; i < DEFAULTS.playbooks.maxSaved; i++) expect((await cal.post('/playbooks', { name: `P${i}`, text: 'Haul.' })).status).toBe(201);
    expect((await cal.post('/playbooks', { name: 'One more', text: 'Haul.' })).body.error.code).toBe('playbook_limit');
    expect((await h.http().get('/playbooks')).status).toBe(401);
  });

  it('comes with /me/export and goes with the account', async () => {
    const dee = await h.as('pb_dee');
    const eve = await h.as('pb_eve');
    await dee.post('/playbooks', { name: 'Mine', text: TEXT });
    const exp = await dee.get('/me/export');
    expect(exp.body.playbookTexts).toEqual([expect.objectContaining({ name: 'Mine', text: TEXT, selected: true })]);
    expect(exp.body.playbooks).toHaveLength(1);
    expect(JSON.stringify((await eve.get('/me/export')).body)).not.toContain('Rook hauls');
    expect((await dee.del('/me', { confirm: 'pb_dee' })).status).toBe(200);
    expect(await h.repos.playbooks.list(dee.accountId)).toEqual([]);
  });

  it('never names a playbook in a shared replay frame', () => {
    const frame = { view: 'A', agents: [], playbook: 'Haul and scout' } as unknown as V2Frame;
    expect(publicFrame(frame)).not.toHaveProperty('playbook');
  });
});
