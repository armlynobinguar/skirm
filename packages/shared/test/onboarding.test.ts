import { describe, expect, it } from 'vitest';
import {
  FIRST_STEPS,
  SKILL_TEMPLATES,
  TAGS,
  TUTORIAL_STEPS,
  skillTemplateById,
  tutorialStepsIn,
} from '../src';

describe('tutorial steps', () => {
  it('covers crew, roles, talk tiers, skills, hazards, switches, supply drops and the goal', () => {
    const topics = new Set(TUTORIAL_STEPS.map((s) => s.topic));
    for (const t of ['crew', 'roles', 'talk', 'skills', 'hazards', 'switches', 'drops', 'goal'] as const) expect(topics).toContain(t);
  });

  it('runs briefing, lock-in, live, debrief in that order, with unique ids', () => {
    const order = ['brief', 'lockin', 'live', 'ended'];
    const phases = TUTORIAL_STEPS.map((s) => order.indexOf(s.phase));
    expect(phases).toEqual([...phases].sort((a, b) => a - b));
    expect(new Set(TUTORIAL_STEPS.map((s) => s.id)).size).toBe(TUTORIAL_STEPS.length);
    for (const p of order) expect(tutorialStepsIn(p as never).length).toBeGreaterThan(0);
  });

  it('keeps every tip short enough to read in a corner card', () => {
    for (const s of TUTORIAL_STEPS) expect(s.body.length, s.id).toBeLessThanOrEqual(300);
  });

  it('indexes phase steps into the full list', () => {
    for (const { step, index } of tutorialStepsIn('live')) expect(TUTORIAL_STEPS[index]).toBe(step);
  });
});

describe('first steps', () => {
  it('starts with the tutorial and has unique ids', () => {
    expect(FIRST_STEPS[0]!.id).toBe('tutorial');
    expect(new Set(FIRST_STEPS.map((s) => s.id)).size).toBe(FIRST_STEPS.length);
  });
});

describe('skill templates', () => {
  it('fit the skill limits: name, prompt ≤ 1200, reflexes ≤ 400, summary ≤ 140, known tags', () => {
    expect(SKILL_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const t of SKILL_TEMPLATES) {
      expect(t.name, t.id).toMatch(/^[\p{L}\p{N} '-]{3,32}$/u);
      expect(t.prompt.length, t.id).toBeLessThanOrEqual(1200);
      expect(t.reflexes.length, t.id).toBeLessThanOrEqual(400);
      expect(t.summary.length, t.id).toBeLessThanOrEqual(140);
      expect(t.handlesTags.length, t.id).toBeGreaterThan(0);
      for (const tag of t.handlesTags) expect(TAGS).toContain(tag);
      expect(new Set(t.handlesTags).size).toBe(t.handlesTags.length);
    }
    expect(new Set(SKILL_TEMPLATES.map((t) => t.id)).size).toBe(SKILL_TEMPLATES.length);
    expect(new Set(SKILL_TEMPLATES.map((t) => t.name)).size).toBe(SKILL_TEMPLATES.length);
  });

  it('finds a template by id', () => {
    expect(skillTemplateById('flood-plug')?.requiresActions).toEqual(['place_block']);
    expect(skillTemplateById('nope')).toBeUndefined();
  });
});
