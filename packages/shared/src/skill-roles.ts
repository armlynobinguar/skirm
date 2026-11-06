// Agent roles and role-specific skill slots: each skill version says which agent roles may equip
// it, or `any`. Public metadata (never part of the hidden prompt). The API refuses an equip, or a
// role change, that leaves an agent carrying a skill for another role; realtime skips such a skill
// at lock-in.
import { DEFAULTS } from './config';

/** The six roles every match before the new roles was played with (ranked plays only these by default). */
export const CLASSIC_AGENT_ROLES = ['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'] as const;
/** Roles added later: casual, practice, lobbies, campaign and puzzles; ranked only with DEFAULTS.roles.rankedNewRoles. */
export const NEW_AGENT_ROLES = ['Medic', 'Engineer', 'Saboteur', 'Courier'] as const;
/** The v2 agent roles (the engine's Role; @skirm/db V2_ROLES), the original six first. */
export const AGENT_ROLES = [...CLASSIC_AGENT_ROLES, ...NEW_AGENT_ROLES] as const;
export type AgentRoleName = (typeof AGENT_ROLES)[number];

export const isAgentRole = (v: unknown): v is AgentRoleName => (AGENT_ROLES as readonly unknown[]).includes(v);

/** Whether an agent of `role` may play ranked (the original six always; the new four only when DEFAULTS.roles.rankedNewRoles is on). */
export function rankedRoleAllowed(role: string, rankedNewRoles: boolean = DEFAULTS.roles.rankedNewRoles): boolean {
  return (CLASSIC_AGENT_ROLES as readonly string[]).includes(role) || (rankedNewRoles && (NEW_AGENT_ROLES as readonly string[]).includes(role));
}

/** The refusal for a ranked crew that fields a role ranked does not take yet, or null when every role may play ranked. */
export function rankedRoleRefusal(roles: readonly string[], rankedNewRoles: boolean = DEFAULTS.roles.rankedNewRoles): string | null {
  const bad = roles.find((r) => !rankedRoleAllowed(r, rankedNewRoles));
  return bad ? `${bad} is not in ranked yet: ranked crews play ${CLASSIC_AGENT_ROLES.join(', ')}. Play the ${bad} in casual, practice or the campaign.` : null;
}

/** What each role does, in the words the crew pickers and docs use (engine match.ts has the exact rules). */
export const AGENT_ROLE_TEXT: Readonly<Record<AgentRoleName, { blurb: string; does: string }>> = {
  Builder: { blurb: 'Places blocks', does: 'Places blocks to wall off hazards and rivals (add_solid verbs).' },
  Digger: { blurb: 'Clears rubble', does: 'Clears rubble, blocks, crates and trees, and digs dirt in one move (remove_solid verbs).' },
  Firefighter: { blurb: 'Puts out fire', does: 'Puts out fire next to it (extinguish verbs).' },
  Scout: { blurb: 'Repels rivals', does: 'Stuns rivals within 2 tiles (area_repel verbs).' },
  Runner: { blurb: 'Carries 2', does: 'Takes and delivers; carries 2 items.' },
  Hauler: { blurb: 'Carries 3', does: 'Takes and delivers; carries 3 items.' },
  Medic: { blurb: 'Revives crewmates', does: 'Tends a knocked-down or stunned crewmate next to it: 2 ticks off a knock-down, a stun cleared. Every 5 ticks.' },
  Engineer: { blurb: 'Valves and bridges', does: 'Works valves from 2 tiles away and lays 2 bridges of its own over water.' },
  Saboteur: { blurb: 'Plants decoys', does: 'Plants up to 2 decoy items that look real to rivals; a rival who grabs one loses a turn. Each uses one of the crew’s bluffs.' },
  Courier: { blurb: 'Fast, carries 1', does: 'Moves 2 tiles per step on open ground; carries only 1 item.' },
};

/** A skill for every role. Versions written before roles existed are `any`. */
export const SKILL_ROLE_ANY = 'any';
export type SkillRole = AgentRoleName | typeof SKILL_ROLE_ANY;
export const SKILL_ROLES: readonly SkillRole[] = [...AGENT_ROLES, SKILL_ROLE_ANY];
export const DEFAULT_SKILL_ROLES: readonly SkillRole[] = [SKILL_ROLE_ANY];

export const isSkillRole = (v: unknown): v is SkillRole => (SKILL_ROLES as readonly unknown[]).includes(v);

/**
 * The stored form: `['any']` when the list is empty, holds `any`, or names every role; otherwise
 * the named roles once each, in AGENT_ROLES order. Unknown values are dropped. A version that named
 * the six original roles before the new ones existed keeps that list: it does not fit the new four.
 */
export function normalizeSkillRoles(list: readonly unknown[] | null | undefined): SkillRole[] {
  const set = new Set((list ?? []).filter(isSkillRole));
  if (set.size === 0 || set.has(SKILL_ROLE_ANY)) return [SKILL_ROLE_ANY];
  const roles = AGENT_ROLES.filter((r) => set.has(r));
  return roles.length === AGENT_ROLES.length ? [SKILL_ROLE_ANY] : roles;
}

/** Whether an agent of `role` may equip a skill version declaring `roles` (missing roles = any). */
export function skillFitsRole(roles: readonly unknown[] | null | undefined, role: string): boolean {
  const norm = normalizeSkillRoles(roles);
  return norm[0] === SKILL_ROLE_ANY || (norm as readonly string[]).includes(role);
}

/** "Any role", or the roles joined ("Scout · Hauler"). */
export function skillRolesLabel(roles: readonly unknown[] | null | undefined): string {
  const norm = normalizeSkillRoles(roles);
  return norm[0] === SKILL_ROLE_ANY ? 'Any role' : norm.join(' · ');
}
