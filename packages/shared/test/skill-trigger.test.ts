import { describe, expect, it } from 'vitest';
import {
  ALWAYS_TRIGGER,
  SKILL_TRIGGER_KINDS,
  defaultSkillTrigger,
  describeSkillTrigger,
  parseSkillTrigger,
  skillTriggerOf,
  storedSkillTrigger,
} from '../src';

describe('skill triggers', () => {
  it('reads null and undefined as always', () => {
    expect(parseSkillTrigger(null)).toEqual(ALWAYS_TRIGGER);
    expect(parseSkillTrigger(undefined)).toEqual(ALWAYS_TRIGGER);
  });

  it('accepts every kind at its default', () => {
    for (const k of SKILL_TRIGGER_KINDS) expect(parseSkillTrigger(defaultSkillTrigger(k))).toEqual(defaultSkillTrigger(k));
  });

  it('accepts numbers in range and refuses the rest', () => {
    expect(parseSkillTrigger({ kind: 'hazard_within', tiles: 2 })).toEqual({ kind: 'hazard_within', tiles: 2 });
    expect(parseSkillTrigger({ kind: 'time_left_under', seconds: 30 })).toEqual({ kind: 'time_left_under', seconds: 30 });
    expect(parseSkillTrigger({ kind: 'hazard_within', tiles: 0 })).toBeNull();
    expect(parseSkillTrigger({ kind: 'hazard_within', tiles: 11 })).toBeNull();
    expect(parseSkillTrigger({ kind: 'hazard_within', tiles: 2.5 })).toBeNull();
    expect(parseSkillTrigger({ kind: 'hazard_within' })).toBeNull();
    expect(parseSkillTrigger({ kind: 'time_left_under', seconds: 5 })).toBeNull();
    expect(parseSkillTrigger({ kind: 'rival_near_switch', seconds: 30 })).toBeNull();
  });

  it('refuses free text, unknown kinds and extra keys', () => {
    expect(parseSkillTrigger('when the rival is close')).toBeNull();
    expect(parseSkillTrigger({ kind: 'when_i_feel_like_it' })).toBeNull();
    expect(parseSkillTrigger({ kind: 'always', text: 'secret' })).toBeNull();
    expect(parseSkillTrigger({ kind: 'hazard_within', tiles: 2, note: 'x' })).toBeNull();
    expect(parseSkillTrigger([])).toBeNull();
  });

  it('stores always as null and reads anything unreadable as always', () => {
    expect(storedSkillTrigger(ALWAYS_TRIGGER)).toBeNull();
    expect(storedSkillTrigger(undefined)).toBeNull();
    expect(storedSkillTrigger({ kind: 'carrying_item' })).toEqual({ kind: 'carrying_item' });
    expect(skillTriggerOf({ kind: 'nope' })).toEqual(ALWAYS_TRIGGER);
  });

  it('describes triggers in words', () => {
    expect(describeSkillTrigger(null)).toBe('Always');
    expect(describeSkillTrigger({ kind: 'hazard_within', tiles: 1 })).toBe('A hazard within 1 tile');
    expect(describeSkillTrigger({ kind: 'rival_near_switch', tiles: 3 })).toBe('A rival within 3 tiles of a switch');
    expect(describeSkillTrigger({ kind: 'time_left_under', seconds: 60 })).toBe('Under 60 s left');
  });
});
