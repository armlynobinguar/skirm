import { describe, expect, it } from 'vitest';
import { normalizeSkillRoles, skillFitsRole, skillRolesLabel } from '../src/skill-roles';

describe('skill roles', () => {
  it('normalizes to any when empty, missing, holding any, or naming every role', () => {
    expect(normalizeSkillRoles(undefined)).toEqual(['any']);
    expect(normalizeSkillRoles([])).toEqual(['any']);
    expect(normalizeSkillRoles(['Scout', 'any'])).toEqual(['any']);
    expect(normalizeSkillRoles(['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'])).toEqual(['any']);
  });

  it('keeps named roles once each in role order and drops unknown values', () => {
    expect(normalizeSkillRoles(['Hauler', 'Scout', 'Hauler', 'Wizard'])).toEqual(['Scout', 'Hauler']);
  });

  it('fits an agent of a listed role or any skill', () => {
    expect(skillFitsRole(['any'], 'Builder')).toBe(true);
    expect(skillFitsRole(null, 'Builder')).toBe(true);
    expect(skillFitsRole(['Scout', 'Hauler'], 'Hauler')).toBe(true);
    expect(skillFitsRole(['Scout'], 'Hauler')).toBe(false);
  });

  it('labels any and role lists', () => {
    expect(skillRolesLabel(['any'])).toBe('Any role');
    expect(skillRolesLabel(['Hauler', 'Scout'])).toBe('Scout · Hauler');
  });
});
