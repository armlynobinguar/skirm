// /skills*: create, version, read-back (creator only) and mint.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FLOOD_WARDEN, SAMPLE_SKILL, setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

const SECRETS = [SAMPLE_SKILL.prompt, SAMPLE_SKILL.reflexes, 'SECRET-PROMPT', 'SECRET-REFLEX'];
const leaks = (text: string) => SECRETS.some((s) => text.includes(s));

describe('skills', () => {
  it('POST /skills stores a draft version 1 and never echoes the text', async () => {
    const u = await h.as('writer');
    const res = await u.post('/skills', SAMPLE_SKILL);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      schema: 'skirm.skill/v0',
      version: 1,
      name: 'Gap Sealer',
      status: 'Draft',
      creator: 'writer',
      requires_actions: ['place_block'],
      handles_tags: ['spreads', 'liquid'],
      royalty_bps: 500,
    });
    expect(res.body.id).toMatch(/^skl_/);
    expect(res.body.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(leaks(res.text)).toBe(false);
  });

  it('rejects invalid bodies without echoing the prompt', async () => {
    const u = await h.as('writer');
    const res = await u.post('/skills', {
      ...SAMPLE_SKILL,
      prompt: SAMPLE_SKILL.prompt.repeat(20),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0].path).toBe('prompt');
    expect(leaks(res.text)).toBe(false);
    const tags = await u.post('/skills', { ...SAMPLE_SKILL, handles_tags: [] });
    expect(tags.status).toBe(400);
    expect(leaks(tags.text)).toBe(false);
  });

  it('GET /skills/:id returns prompt and reflexes to the creator only', async () => {
    const u = await h.as('writer');
    const other = await h.as('reader');
    const created = (await u.post('/skills', SAMPLE_SKILL)).body;
    const mine = await u.get(`/skills/${created.id}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({
      prompt: SAMPLE_SKILL.prompt,
      reflexes: SAMPLE_SKILL.reflexes,
    });
    expect(mine.body.requiredUnlocks).toEqual(['builder']);
    // A draft is invisible to others; once minted it is public but still without the text.
    expect((await other.get(`/skills/${created.id}`)).status).toBe(404);
    await h.repos.skills.markMinted(created.id, 1, `${created.id}:1`);
    const theirs = await other.get(`/skills/${created.id}`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.status).toBe('Minted');
    expect(theirs.body.prompt).toBeUndefined();
    expect(leaks(theirs.text)).toBe(false);
  });

  it('nobody reads Flood Warden text, holders included', async () => {
    const u = await h.as('holder');
    const res = await u.get(`/skills/${FLOOD_WARDEN.id}`);
    expect(res.status).toBe(200);
    // Account-bound and never minted: shown as Starter, not Draft (S07 status chip).
    expect(res.body).toMatchObject({ name: 'Flood Warden', accountBound: true, status: 'Starter' });
    expect(res.body.prompt).toBeUndefined();
    expect(res.body.reflexes).toBeUndefined();
    expect(res.text).not.toContain('Before any task');
  });

  it('PUT /skills/:id makes the next version; only the creator may', async () => {
    const u = await h.as('editor');
    const other = await h.as('meddler');
    const created = (await u.post('/skills', SAMPLE_SKILL)).body;
    const v2 = await u.put(`/skills/${created.id}`, {
      ...SAMPLE_SKILL,
      name: 'Gap Sealer Two',
      prompt: 'v2 text',
    });
    expect(v2.status).toBe(200);
    expect(v2.body).toMatchObject({
      id: created.id,
      version: 2,
      name: 'Gap Sealer Two',
      status: 'Draft',
    });
    expect((await u.get(`/skills/${created.id}?version=1`)).body).toMatchObject({
      version: 1,
      prompt: SAMPLE_SKILL.prompt,
    });
    expect((await u.get(`/skills/${created.id}`)).body).toMatchObject({
      version: 2,
      prompt: 'v2 text',
    });
    const denied = await other.put(`/skills/${created.id}`, SAMPLE_SKILL);
    expect(denied.status).toBe(403);
    expect(leaks(denied.text)).toBe(false);
    expect((await u.put('/skills/skl_01JB7Z3K9QX4M2T8V6N5R1C0DF', SAMPLE_SKILL)).status).toBe(404);
    expect((await u.put(`/skills/${FLOOD_WARDEN.id}`, SAMPLE_SKILL)).status).toBe(403);
  });

  it('GET /skills lists written and owned tabs', async () => {
    const u = await h.as('tabs');
    const created = (await u.post('/skills', SAMPLE_SKILL)).body;
    const written = await u.get('/skills?tab=written');
    expect(written.body.map((s: { id: string }) => s.id)).toEqual([created.id]);
    const owned = await u.get('/skills?tab=owned');
    expect(owned.body.map((s: { id: string }) => s.id).sort()).toEqual(
      [created.id, FLOOD_WARDEN.id].sort(),
    );
    expect(leaks(written.text + owned.text)).toBe(false);
    expect((await u.get('/skills?tab=bogus')).status).toBe(400);
  });

  it("POST /skills/:id/mint mints the creator's draft once; account-bound skills never", async () => {
    const u = await h.as('minter');
    const other = await h.as('peeker');
    const created = (await u.post('/skills', SAMPLE_SKILL)).body;
    expect((await other.post(`/skills/${created.id}/mint`)).status).toBe(404);
    const mint = await u.post(`/skills/${created.id}/mint`);
    expect(mint.status).toBe(200);
    expect(mint.body).toEqual({
      tokenId: `${created.id}:1`,
      status: 'pending',
      benchmark: { status: 'queued' },
    });
    expect(h.minter.minted[0]).toMatchObject({ id: created.id, version: 1, creator: 'minter' });
    expect(JSON.stringify(h.minter.minted)).not.toContain('SECRET');
    expect((await u.get(`/skills/${created.id}`)).body.status).toBe('Minted');
    // Idempotent.
    expect((await u.post(`/skills/${created.id}/mint`)).body).toMatchObject({ status: 'minted' });

    const bound = await u.post(`/skills/${FLOOD_WARDEN.id}/mint`);
    expect(bound.status).toBe(403);
  });

  it('mint queues the hidden benchmark, then mints', async () => {
    const u = await h.as('benchmint');
    const created = (await u.post('/skills', SAMPLE_SKILL)).body;
    const before = h.benchmarks.jobs.length;
    const mint = await u.post(`/skills/${created.id}/mint`);
    expect(mint.status).toBe(200);
    expect(mint.body).toEqual({
      tokenId: `${created.id}:1`,
      status: 'pending',
      benchmark: { status: 'queued' },
    });
    expect(h.benchmarks.jobs.slice(before)).toEqual([
      { kind: 'mint', skillId: created.id, version: 1 },
    ]);
    expect((await h.repos.proof.benchmark(created.id, 1))?.status).toBe('queued');
    // A repeat answers with the benchmark as it stands and queues nothing more.
    await h.repos.proof.markNeedsModel(created.id, 1);
    expect((await u.post(`/skills/${created.id}/mint`)).body).toEqual({
      tokenId: `${created.id}:1`,
      status: 'minted',
      benchmark: { status: 'needs_model' },
    });
    expect(h.benchmarks.jobs.length).toBe(before + 1);
  });

  it('mint is refused (503) and stays a draft when the benchmark cannot be queued', async () => {
    const u = await h.as('benchdown');
    const created = (await u.post('/skills', SAMPLE_SKILL)).body;
    const minted = h.minter.minted.length;
    h.benchmarks.fail = true;
    try {
      const res = await u.post(`/skills/${created.id}/mint`);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('queue_unavailable');
    } finally {
      h.benchmarks.fail = false;
    }
    expect(h.minter.minted.length).toBe(minted);
    expect((await u.get(`/skills/${created.id}`)).body.status).toBe('Draft');
    // The claim was released: the retry mints.
    expect((await u.post(`/skills/${created.id}/mint`)).status).toBe(200);
    expect(h.benchmarks.jobs.at(-1)).toEqual({ kind: 'mint', skillId: created.id, version: 1 });
  });
});
