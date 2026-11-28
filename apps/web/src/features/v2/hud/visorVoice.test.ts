import { describe, expect, it } from 'vitest';
import type { FrameSkill } from '@skirm/engine/v2';
import { innerVoiceOf, skillVoice, triggerVoice, voicedSkill, type VoiceContext } from './visorVoice';

const ctx: VoiceContext = { team: 'A', item: 'Lamp oil', deliverTo: 'Cage lift', dist: 7 };
const base = { name: 'Wick', team: 'A' as const, items: [], down: false, out: false };

describe('visor inner voice', () => {
  it('speaks the agent’s own inner voice first, then its plan', () => {
    expect(innerVoiceOf({ ...base, thought: 'The middle is open.', plan: 'Take the oil' }, ctx)).toEqual({ kick: 'Inner voice', text: 'The middle is open.' });
    expect(innerVoiceOf({ ...base, plan: 'Take the oil in the west hall' }, ctx)).toEqual({ kick: 'Intent', text: 'Take the oil in the west hall' });
  });

  it('falls back to what it is doing', () => {
    expect(innerVoiceOf({ ...base, items: [{ kind: 'item', origin: 'own' }] }, ctx).text).toBe('Lamp oil in hand. The cage lift is 7 tiles out.');
    expect(innerVoiceOf({ ...base, items: [{ kind: 'item', origin: 'own' }, { kind: 'item', origin: 'drop' }] }, ctx).text).toBe('2 × lamp oil in hand. The cage lift is 7 tiles out.');
    expect(innerVoiceOf(base, ctx).text).toBe('Hands empty. Looking for lamp oil.');
    expect(innerVoiceOf({ ...base, down: true, thought: 'x' }, ctx).text).toMatch(/Swept/);
    expect(innerVoiceOf({ ...base, out: true }, ctx).text).toMatch(/Out of the match/);
  });

  it('keeps a bought skill’s reasons and a rival’s mind private', () => {
    expect(innerVoiceOf({ ...base, planHidden: true }, ctx).text).toMatch(/bought skill/);
    expect(innerVoiceOf({ ...base, team: 'B' }, ctx)).toEqual({ kick: 'Sealed mind', text: 'You hear only what Wick says aloud.' });
    // Practice ships the bot’s mind: then it is shown.
    expect(innerVoiceOf({ ...base, team: 'B', plan: 'Block the lift' }, ctx).text).toBe('Block the lift');
  });
});

describe('the inner voice in the skill’s own words', () => {
  const route: FrameSkill = { name: 'Shortest safe route', trigger: { kind: 'always' }, active: true };
  const choke: FrameSkill = { name: 'Clear the choke first!', trigger: { kind: 'hazard_within', tiles: 3 }, active: true };
  const late: FrameSkill = { name: 'Sprint the last stretch', trigger: { kind: 'time_left_under', seconds: 30 }, active: false };

  it('speaks a skill whose moment has come, ahead of its thought and plan', () => {
    const v = innerVoiceOf({ ...base, skills: [route, choke], thought: 'Going left.', plan: 'Dig' }, ctx);
    expect(v).toEqual({ kick: 'Skill · Clear the choke first!', text: '“Clear the choke first!” A hazard within 3 tiles. This is what it is for.' });
  });

  it('lets an always-on skill’s agent think aloud, tagged with the skill', () => {
    expect(innerVoiceOf({ ...base, skills: [route, late], thought: 'Going left.' }, ctx)).toEqual({ kick: 'Inner voice · Shortest safe route', text: 'Going left.' });
    // With nothing else to say, the skill says it.
    expect(innerVoiceOf({ ...base, skills: [route] }, ctx).text).toBe('“Shortest safe route.” Every step, that is how I play.');
    // Inactive skills stay quiet.
    expect(innerVoiceOf({ ...base, skills: [late] }, ctx).text).toBe('Hands empty. Looking for lamp oil.');
  });

  it('still keeps swept and out first', () => {
    expect(innerVoiceOf({ ...base, down: true, skills: [choke] }, ctx).text).toMatch(/Swept/);
  });

  it('puts every trigger in the first person', () => {
    expect(triggerVoice({ kind: 'hazard_within', tiles: 1 }, ctx)).toBe('A hazard within 1 tile. This is what it is for.');
    expect(triggerVoice({ kind: 'behind_on_score' }, ctx)).toMatch(/behind/);
    expect(triggerVoice({ kind: 'ahead_on_score' }, ctx)).toMatch(/ahead/);
    expect(triggerVoice({ kind: 'rival_near_switch', tiles: 2 }, ctx)).toBe('A rival within 2 tiles of a switch. Not on my watch.');
    expect(triggerVoice({ kind: 'carrying_item' }, ctx)).toBe('Lamp oil in hand. Get it to the cage lift.');
    expect(triggerVoice({ kind: 'time_left_under', seconds: 20 }, ctx)).toBe('Under 20 seconds left. No more waiting.');
    expect(triggerVoice({ kind: 'always' }, ctx)).toBe('');
  });

  it('picks the triggered skill over the always-on one, in skill order', () => {
    expect(voicedSkill([route, choke])).toBe(choke);
    expect(voicedSkill([route])).toBe(route);
    expect(voicedSkill([late])).toBeNull();
    expect(voicedSkill(undefined)).toBeNull();
    expect(skillVoice(route, ctx).kick).toBe('Skill · Shortest safe route');
  });
});
