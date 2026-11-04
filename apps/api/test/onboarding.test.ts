// /onboarding: tutorial progress per account, the home checklist read from the player's own rows,
// and starter templates copied into drafts.
import { SYSTEM_ACCOUNT_ID } from '@skirm/db';
import { SKILL_TEMPLATES, TUTORIAL_STEPS } from '@skirm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skillBody } from '../src/validation';
import { setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let ana: UserClient;
let ben: UserClient;

beforeAll(async () => {
  h = await setup();
  ana = await h.as('ana');
  ben = await h.as('ben');
});
afterAll(() => h.close());

const items = (body: { checklist: { items: { id: string; done: boolean }[] } }) =>
  Object.fromEntries(body.checklist.items.map((i) => [i.id, i.done]));

describe('GET /onboarding', () => {
  it('a new player has seen nothing and gets the checklist', async () => {
    const res = await ana.get('/onboarding');
    expect(res.status).toBe(200);
    expect(res.body.tutorial).toMatchObject({
      status: 'new',
      step: 0,
      steps: TUTORIAL_STEPS.length,
      match: { mapId: 'copper-hollow', difficulty: 'easy', crewSize: 1 },
      completedAt: null,
      skippedAt: null,
    });
    expect(items(res.body)).toEqual({ tutorial: false, practice: false, skill: false, equip: false, pvp: false });
    expect(res.body.checklist).toMatchObject({ done: false, dismissed: false });
    expect(res.body.showChecklist).toBe(true);
  });

  it('needs a session', async () => {
    expect((await h.http().get('/onboarding')).status).toBe(401);
    expect((await h.http().get('/onboarding/templates')).status).toBe(401);
  });
});

describe('PUT /onboarding/tutorial', () => {
  it('records tips seen; the step only grows and is kept per account', async () => {
    expect((await ana.put('/onboarding/tutorial', { step: 3 })).body.tutorial).toMatchObject({ status: 'in_progress', step: 3 });
    // A stale tab sending an older step does not move it back.
    expect((await ana.put('/onboarding/tutorial', { step: 1 })).body.tutorial.step).toBe(3);
    expect((await ana.get('/onboarding')).body.tutorial.step).toBe(3);
    expect((await ben.get('/onboarding')).body.tutorial).toMatchObject({ status: 'new', step: 0 });
  });

  it('refuses a step past the last tip and an empty body', async () => {
    expect((await ana.put('/onboarding/tutorial', { step: TUTORIAL_STEPS.length + 1 })).status).toBe(400);
    expect((await ana.put('/onboarding/tutorial', { step: -1 })).status).toBe(400);
    expect((await ana.put('/onboarding/tutorial', {})).status).toBe(400);
    expect((await ana.put('/onboarding/tutorial', { status: 'later' })).status).toBe(400);
  });

  it('skip, restart, then finish: a finished tutorial ticks the checklist', async () => {
    const skipped = (await ben.put('/onboarding/tutorial', { status: 'skipped' })).body;
    expect(skipped.tutorial.status).toBe('skipped');
    expect(skipped.tutorial.skippedAt).not.toBeNull();
    expect(items(skipped).tutorial).toBe(true);

    const again = (await ben.put('/onboarding/tutorial', { status: 'restart' })).body;
    expect(again.tutorial).toMatchObject({ status: 'new', step: 0, skippedAt: null });
    expect(items(again).tutorial).toBe(false);

    const done = (await ben.put('/onboarding/tutorial', { step: 4, status: 'done' })).body;
    expect(done.tutorial).toMatchObject({ status: 'done', step: TUTORIAL_STEPS.length });
    expect(items(done).tutorial).toBe(true);
    const first = done.tutorial.completedAt;
    // Finishing twice keeps the first time; a restart after finishing keeps it finished.
    h.clock.now += 60_000;
    expect((await ben.put('/onboarding/tutorial', { status: 'done' })).body.tutorial.completedAt).toBe(first);
    expect((await ben.put('/onboarding/tutorial', { status: 'restart' })).body.tutorial).toMatchObject({ status: 'done', step: 0 });
  });
});

describe('the checklist', () => {
  it('reads practice, skills, equipping and pvp from the player’s own rows', async () => {
    const cat = await h.as('cat');
    const dan = await h.as('dan');

    // A live practice match does not count; an ended one does.
    const practice = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, practice: true, difficulty: 'easy', teamA: cat.accountId, teamB: SYSTEM_ACCOUNT_ID });
    expect(items((await cat.get('/onboarding')).body).practice).toBe(false);
    await h.repos.v2Matches.finish(practice.id, { winner: 'A', reason: 'goal', score: { A: 3, B: 1 }, ticks: 80 });
    expect(items((await cat.get('/onboarding')).body).practice).toBe(true);

    // Copying a template writes a skill; equipping it ticks equip. The starter skill does not count.
    const lead = (await cat.get('/agents')).body[0];
    expect(lead.skills.length).toBeGreaterThan(0);
    expect(items((await cat.get('/onboarding')).body)).toMatchObject({ skill: false, equip: false });
    const copy = await cat.post('/onboarding/templates/steady-hauler/copy');
    expect(copy.status).toBe(201);
    expect(items((await cat.get('/onboarding')).body)).toMatchObject({ skill: true, equip: false });
    expect((await cat.patch(`/agents/${lead.id}`, { skills: [{ id: copy.body.id, version: 1 }] })).status).toBe(200);
    expect(items((await cat.get('/onboarding')).body).equip).toBe(true);

    // A casual match against another player, either side; a void one does not count.
    const voided = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: dan.accountId, teamB: cat.accountId });
    await h.repos.v2Matches.finish(voided.id, { winner: null, reason: 'declined' });
    expect(items((await cat.get('/onboarding')).body).pvp).toBe(false);
    const casual = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: dan.accountId, teamB: cat.accountId });
    await h.repos.v2Matches.finish(casual.id, { winner: 'draw', reason: 'time', score: { A: 1, B: 1 }, ticks: 150 });
    const all = (await cat.get('/onboarding')).body;
    expect(items(all).pvp).toBe(true);
    expect(items(all).tutorial).toBe(false);

    await cat.put('/onboarding/tutorial', { status: 'done' });
    const finished = (await cat.get('/onboarding')).body;
    expect(finished.checklist.done).toBe(true);
    expect(finished.showChecklist).toBe(false);
  });

  it('can be dismissed for good', async () => {
    const eve = await h.as('eve');
    const res = await eve.post('/onboarding/checklist/dismiss');
    expect(res.status).toBe(200);
    expect(res.body.checklist.dismissed).toBe(true);
    expect(res.body.showChecklist).toBe(false);
    expect((await eve.get('/onboarding')).body.showChecklist).toBe(false);
    // The tutorial is still there to play.
    expect(res.body.tutorial.status).toBe('new');
  });
});

describe('starter skill templates', () => {
  it('lists every template with its full text', async () => {
    const res = await ana.get('/onboarding/templates');
    expect(res.status).toBe(200);
    expect(res.body.map((t: { id: string }) => t.id)).toEqual(SKILL_TEMPLATES.map((t) => t.id));
    expect(res.body[0]).toMatchObject({ name: 'Steady Hauler', prompt: expect.any(String), reflexes: expect.any(String) });
  });

  it('every template is a valid skill body', () => {
    for (const t of SKILL_TEMPLATES) {
      const r = skillBody.safeParse({
        name: t.name,
        summary: t.summary,
        prompt: t.prompt,
        reflexes: t.reflexes,
        requires_actions: t.requiresActions,
        handles_tags: t.handlesTags,
      });
      expect(r.success, `${t.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it('copies a template into a draft of the caller’s, prompt sealed and read back only by them', async () => {
    const t = SKILL_TEMPLATES.find((x) => x.id === 'flood-plug')!;
    const res = await ana.post('/onboarding/templates/flood-plug/copy');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: t.name, version: 1, status: 'Draft', requires_actions: ['place_block'], handles_tags: t.handlesTags });
    expect(res.body).not.toHaveProperty('prompt');
    const mine = await ana.get(`/skills/${res.body.id}`);
    expect(mine.body).toMatchObject({ prompt: t.prompt, reflexes: t.reflexes });
    expect((await ana.get('/skills')).body.map((s: { id: string }) => s.id)).toContain(res.body.id);
    // The draft is the caller's own: anyone else gets 404.
    expect((await ben.get(`/skills/${res.body.id}`)).status).toBe(404);
    // Copying again makes another draft.
    const again = await ana.post('/onboarding/templates/flood-plug/copy');
    expect(again.body.id).not.toBe(res.body.id);
  });

  it('404s an unknown template', async () => {
    expect((await ana.post('/onboarding/templates/nope/copy')).status).toBe(404);
  });
});

describe('GET /me/export', () => {
  it('includes the onboarding row', async () => {
    const res = await ana.get('/me/export');
    expect(res.body.onboarding).toEqual([expect.objectContaining({ accountId: ana.accountId, tutorialStep: 3 })]);
  });
});
