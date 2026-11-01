// v2 role classes (the prototype's ROLE_UNLOCK / ROLE_ICON) and the role an agent's unlocks point to.
import type { Unlock } from '@skirm/shared';
import * as proto from './proto/world';

export type RoleClass = 'Builder' | 'Digger' | 'Firefighter' | 'Scout' | 'Runner' | 'Hauler';

/** The agent's role from its unlocks (first of Builder, Digger, Firefighter; else Scout). */
export function roleTitle(unlocks: readonly Unlock[]): RoleClass {
  if (unlocks.includes('builder')) return 'Builder';
  if (unlocks.includes('digger')) return 'Digger';
  if (unlocks.includes('firefighter')) return 'Firefighter';
  return 'Scout';
}

/** SVG path (30×30 box, stroke-only) of a role's class icon. */
export const ROLE_ICON: Readonly<Record<RoleClass, string>> = proto.ROLE_ICON;
