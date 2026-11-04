// Role-specific skill slots: each skill version says which agent roles may equip it, or `any`.
// Public metadata (never part of the hidden prompt). The API refuses an equip, or a role change,
// that leaves an agent carrying a skill for another role; realtime skips such a skill at lock-in.

/** The v2 agent roles (the engine's Role; @skirm/db V2_ROLES). */
export const AGENT_ROLES = ['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'] as const;
export type AgentRoleName = (typeof AGENT_ROLES)[number];

/** A skill for every role. Versions written before roles existed are `any`. */
export const SKILL_ROLE_ANY = 'any';
export type SkillRole = AgentRoleName | typeof SKILL_ROLE_ANY;
export const SKILL_ROLES: readonly SkillRole[] = [...AGENT_ROLES, SKILL_ROLE_ANY];
export const DEFAULT_SKILL_ROLES: readonly SkillRole[] = [SKILL_ROLE_ANY];

export const isSkillRole = (v: unknown): v is SkillRole => (SKILL_ROLES as readonly unknown[]).includes(v);

/**
 * The stored form: `['any']` when the list is empty, holds `any`, or names every role; otherwise
 * the named roles once each, in AGENT_ROLES order. Unknown values are dropped.
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
