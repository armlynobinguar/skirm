// Skill triggers: validated on POST/PUT /skills, stored per version, public on every skill view
// (the Exchange included) while the prompt stays sealed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_SKILL, setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

describe('skill triggers', () => {
  it('a skill without a trigger plays always', async () => {
    const u = await h.as('trig-plain');
    const res = await u.post('/skills', SAMPLE_SKILL);
    expect(res.status).toBe(201);
    expect(res.body.trigger).toEqual({ kind: 'always' });
    expect((await h.repos.skills.get(res.body.id, 1))!.trigger).toBeNull();
  });

  it('stores a trigger per version and shows it to everyone, never the prompt', async () => {
    const u = await h.as('trig-writer');
    const other = await h.as('trig-reader');
    const res = await u.post('/skills', { ...SAMPLE_SKILL, trigger: { kind: 'hazard_within', tiles: 3 } });
    expect(res.status).toBe(201);
    expect(res.body.trigger).toEqual({ kind: 'hazard_within', tiles: 3 });
    const id = res.body.id as string;

    // v2 changes the trigger; v1 keeps its own.
    const v2 = await u.put(`/skills/${id}`, { ...SAMPLE_SKILL, trigger: { kind: 'time_left_under', seconds: 60 } });
    expect(v2.status).toBe(200);
    expect(v2.body).toMatchObject({ version: 2, trigger: { kind: 'time_left_under', seconds: 60 } });
    expect((await u.get(`/skills/${id}?version=1`)).body.trigger).toEqual({ kind: 'hazard_within', tiles: 3 });
    expect((await u.get(`/skills/${id}`)).body).toMatchObject({ trigger: { kind: 'time_left_under', seconds: 60 }, prompt: SAMPLE_SKILL.prompt });

    // Once minted it is on the Exchange with its trigger, and the text stays sealed.
    await h.repos.skills.markMinted(id, 2, `${id}:2`);
    const theirs = await other.get(`/skills/${id}`);
    expect(theirs.body.trigger).toEqual({ kind: 'time_left_under', seconds: 60 });
    expect(theirs.body.prompt).toBeUndefined();
    const market = await other.get('/market');
    const row = (market.body as { skill: { id: string; trigger: unknown } }[]).find((r) => r.skill.id === id);
    expect(row?.skill.trigger).toEqual({ kind: 'time_left_under', seconds: 60 });
    expect(market.text).not.toContain(SAMPLE_SKILL.prompt);
  });

  it('`always` and null store as no trigger', async () => {
    const u = await h.as('trig-always');
    const a = await u.post('/skills', { ...SAMPLE_SKILL, trigger: { kind: 'always' } });
    const b = await u.post('/skills', { ...SAMPLE_SKILL, trigger: null });
    for (const r of [a, b]) {
      expect(r.status).toBe(201);
      expect(r.body.trigger).toEqual({ kind: 'always' });
      expect((await h.repos.skills.get(r.body.id, 1))!.trigger).toBeNull();
    }
  });

  it('refuses free text, unknown kinds, numbers out of range and extra keys', async () => {
    const u = await h.as('trig-bad');
    const bad: unknown[] = [
      'when the rival is close',
      { kind: 'whenever' },
      { kind: 'hazard_within' },
      { kind: 'hazard_within', tiles: 0 },
      { kind: 'hazard_within', tiles: 11 },
      { kind: 'rival_near_switch', tiles: 1.5 },
      { kind: 'time_left_under', seconds: 5 },
      { kind: 'time_left_under', seconds: 301 },
      { kind: 'carrying_item', note: 'secret plan' },
    ];
    for (const trigger of bad) {
      const res = await u.post('/skills', { ...SAMPLE_SKILL, trigger });
      expect(res.status, JSON.stringify(trigger)).toBe(400);
      expect(res.body.error.details.issues[0].path).toMatch(/^trigger/);
      expect(res.text).not.toContain(SAMPLE_SKILL.prompt);
    }
  });
});
