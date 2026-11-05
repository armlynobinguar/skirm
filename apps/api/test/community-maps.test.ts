// /community-maps*: drafts are their author's alone, publishing validates, screens names, balance-
// checks and caps per day, and published maps are public and fixed for good.
import { blankCommunityMap, type MapDefV2 } from '@skirm/engine/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMMUNITY_PUBLISH_PER_DAY } from '../src/controllers/community-maps.controller';
import { bucketOf } from '../src/rate-limit';
import { setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

const good = (): MapDefV2 => blankCommunityMap(31, 13);

describe('community maps', () => {
  it('saves drafts that only their author reads, edits and deletes', async () => {
    const ana = await h.as('cm_ana');
    const ben = await h.as('cm_ben');
    const made = await ana.post('/community-maps', { name: 'Ana Yard', theme: 'copper-hollow', map: good() });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Ana Yard', status: 'draft', author: 'cm_ana', plays: 0 });
    const id = made.body.id as string;

    expect((await ana.get(`/community-maps/${id}`)).status).toBe(200);
    expect((await ben.get(`/community-maps/${id}`)).status).toBe(404);
    expect((await h.http().get(`/community-maps/${id}`)).status).toBe(404);
    expect((await ben.put(`/community-maps/${id}`, { name: 'Mine' })).status).toBe(404);
    expect((await ben.del(`/community-maps/${id}`)).status).toBe(404);
    expect((await ben.post(`/community-maps/${id}/publish`)).status).toBe(404);
    expect((await ben.get('/community-maps/mine')).body.maps).toEqual([]);
    expect((await h.http().post('/community-maps').send({ name: 'x', map: good() })).status).toBe(401);

    expect((await ana.put(`/community-maps/${id}`, { name: 'Ana Yard 2' })).body.name).toBe('Ana Yard 2');
    expect((await ana.get('/community-maps/mine')).body.maps.map((m: { id: string }) => m.id)).toEqual([id]);
    expect((await ana.post('/community-maps', { name: 'x', map: { rows: 'x'.repeat(40_000) } })).status).toBe(400);
    expect((await ana.del(`/community-maps/${id}`)).body).toEqual({ deleted: true });
    expect((await ana.get(`/community-maps/${id}`)).status).toBe(404);
  });

  it('test-plays a draft: issues for a broken map, a balance report for a valid one', async () => {
    const cal = await h.as('cm_cal');
    const broken = { ...good(), exit: [3, 3] };
    const bad = await cal.post('/community-maps/test-play', { map: broken });
    expect(bad.status).toBe(200);
    expect(bad.body.valid).toBe(false);
    expect(bad.body.issues.length).toBeGreaterThan(0);
    const ok = await cal.post('/community-maps/test-play', { map: good() });
    expect(ok.body).toMatchObject({ valid: true, balance: { ok: true } });
    expect(ok.body.balance.runs.length).toBeGreaterThan(1);
    expect(bucketOf('POST', '/community-maps/test-play')).toBe('strict');
    expect(bucketOf('POST', '/community-maps/cmp_x/publish')).toBe('strict');
  });

  it('publishes a valid, balanced map with a clean name, once, and lists it', async () => {
    const dee = await h.as('cm_dee');
    const eve = await h.as('cm_eve');
    // Invalid: refused with the issues.
    const broken = (await dee.post('/community-maps', { name: 'Broken', map: { ...good(), goal: 9 } })).body.id;
    const r1 = await dee.post(`/community-maps/${broken}/publish`);
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('map_invalid');
    expect(r1.body.error.details.issues[0].message).toContain('the goal needs 9 items');

    // Valid but unplayable: the items are walled in, so nobody ever scores (the balance check).
    const shut = good();
    shut.rows = shut.rows.map((r, y) =>
      [...r].map((c, x) => (((x === 2 || x === 4 || x === 26 || x === 28) && y >= 5 && y <= 7) || ((x === 3 || x === 27) && (y === 5 || y === 7)) ? '#' : c)).join(''),
    );
    const walled = (await dee.post('/community-maps', { name: 'Walled', map: shut })).body.id;
    const r2 = await dee.post(`/community-maps/${walled}/publish`);
    expect(r2.status).toBe(422);
    expect(r2.body.error.code).toBe('map_unbalanced');
    expect(r2.body.error.details.problems[0]).toContain('nobody delivered');

    // Abusive name: refused by the filter.
    const rude = (await dee.post('/community-maps', { name: 'kys arena', map: good() })).body.id;
    expect((await dee.post(`/community-maps/${rude}/publish`)).body.error.code).toBe('map_refused');

    const id = (await dee.post('/community-maps', { name: 'Dee Docks', theme: 'blackout-harbor', map: { ...good(), name: 'whatever' } })).body.id;
    const pub = await dee.post(`/community-maps/${id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ status: 'published', name: 'Dee Docks', map: { id, name: 'Dee Docks', label: 'Community' }, balance: { ok: true } });
    expect((await dee.post(`/community-maps/${id}/publish`)).status).toBe(409);
    expect((await dee.put(`/community-maps/${id}`, { name: 'Changed' })).body.error.code).toBe('map_published');
    expect((await dee.del(`/community-maps/${id}`)).status).toBe(409);

    // Public: anyone reads and browses it; a signed-in player likes it.
    expect((await h.http().get(`/community-maps/${id}`)).body.name).toBe('Dee Docks');
    const list = await h.http().get('/community-maps?sort=popular');
    expect(list.body.maps.map((m: { id: string }) => m.id)).toContain(id);
    expect((await h.http().get('/community-maps?sort=nope')).status).toBe(400);
    expect((await eve.post(`/community-maps/${id}/like`)).body).toEqual({ likes: 1, liked: true });
    expect((await eve.get('/community-maps')).body.maps.find((m: { id: string }) => m.id === id).liked).toBe(true);
    expect((await eve.del(`/community-maps/${id}/like`)).body).toEqual({ likes: 0, liked: false });

    // The same name again (any case) is taken.
    const twin = (await eve.post('/community-maps', { name: 'dee docks', map: good() })).body.id;
    expect((await eve.post(`/community-maps/${twin}/publish`)).body.error.code).toBe('name_taken');
  });

  it('caps publishing per day', async () => {
    const fay = await h.as('cm_fay');
    for (let i = 0; i < COMMUNITY_PUBLISH_PER_DAY; i++) {
      const id = (await fay.post('/community-maps', { name: `Fay ${i}`, map: good() })).body.id;
      expect((await fay.post(`/community-maps/${id}/publish`)).status).toBe(200);
    }
    const id = (await fay.post('/community-maps', { name: 'Fay more', map: good() })).body.id;
    const r = await fay.post(`/community-maps/${id}/publish`);
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('publish_limit');
  });
});
