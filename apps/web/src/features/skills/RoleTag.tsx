'use client';
// Role slots: the roles a skill version is for ("Any role", or "Scout · Hauler"), shown on Exchange
// cards, skill detail, the editor and the equip picker. Public metadata, never prompt text.
import { Badge } from '@skirm/ui';
import { normalizeSkillRoles, skillFitsRole, skillRolesLabel, type SkillRole } from '@skirm/shared';

export function RoleTag({ roles, className }: { roles: readonly SkillRole[] | undefined; className?: string }) {
  const any = normalizeSkillRoles(roles)[0] === 'any';
  const label = skillRolesLabel(roles);
  return (
    <Badge
      tone={any ? 'neutral' : 'you'}
      icon={false}
      className={className}
      data-testid="role-tag"
      title={any ? 'Any agent can equip this skill' : `Only a ${label.replace(/ · /g, ' or ')} can equip this skill`}
    >
      {label}
    </Badge>
  );
}

/** Why an agent of `role` cannot equip the skill, or null when it can. */
export function roleBlockReason(roles: readonly SkillRole[] | undefined, role: string): string | null {
  return skillFitsRole(roles, role) ? null : `For ${skillRolesLabel(roles)} only; this agent is a ${role}`;
}
