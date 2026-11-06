import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/config';
import { AGENT_ROLES, AGENT_ROLE_TEXT, CLASSIC_AGENT_ROLES, NEW_AGENT_ROLES, normalizeSkillRoles, rankedRoleAllowed, rankedRoleRefusal, skillFitsRole, skillRolesLabel } from '../src/skill-roles';

describe('agent roles', () => {
  it('lists the original six first, then Medic, Engineer, Saboteur and Courier, each with its text', () => {
    expect(AGENT_ROLES).toEqual([...CLASSIC_AGENT_ROLES, 'Medic', 'Engineer', 'Saboteur', 'Courier']);
    for (const r of AGENT_ROLES) expect(AGENT_ROLE_TEXT[r].does.length).toBeGreaterThan(10);
  });

  it('keeps ranked on the original six unless DEFAULTS.roles.rankedNewRoles', () => {
    expect(DEFAULTS.roles.rankedNewRoles).toBe(false);
    for (const r of CLASSIC_AGENT_ROLES) expect(rankedRoleAllowed(r)).toBe(true);
    for (const r of NEW_AGENT_ROLES) {
      expect(rankedRoleAllowed(r)).toBe(false);
      expect(rankedRoleAllowed(r, true)).toBe(true);
    }
    expect(rankedRoleAllowed('Wizard', true)).toBe(false);
    expect(rankedRoleRefusal(['Runner', 'Saboteur'])).toBe(
      'Saboteur is not in ranked yet: ranked crews play Builder, Digger, Firefighter, Scout, Runner, Hauler. Play the Saboteur in casual, practice or the campaign.',
    );
    expect(rankedRoleRefusal(['Runner', 'Saboteur'], true)).toBeNull();
  });
});

describe('skill roles', () => {
  it('normalizes to any when empty, missing, holding any, or naming every role', () => {
    expect(normalizeSkillRoles(undefined)).toEqual(['any']);
    expect(normalizeSkillRoles([])).toEqual(['any']);
    expect(normalizeSkillRoles(['Scout', 'any'])).toEqual(['any']);
    expect(normalizeSkillRoles([...AGENT_ROLES])).toEqual(['any']);
  });

  it('keeps a version that named the six original roles off the new four', () => {
    const six = ['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'];
    expect(normalizeSkillRoles(six)).toEqual(six);
    expect(skillFitsRole(six, 'Hauler')).toBe(true);
    for (const r of NEW_AGENT_ROLES) expect(skillFitsRole(six, r)).toBe(false);
    expect(skillFitsRole(['Medic', 'Courier'], 'Courier')).toBe(true);
    expect(skillRolesLabel(['Courier', 'Medic'])).toBe('Medic · Courier');
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
