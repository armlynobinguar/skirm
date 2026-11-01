import type { Unlock } from '@skirm/shared';
import type { UnlockLike, UnlockName } from './types';

export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(' ');
}

/** Whole number with thousands separators; "–" when missing. */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return Math.round(n).toLocaleString('en-US');
}

/** var(--token) */
export const V = (name: string): string => `var(--${name})`;

const UNLOCK_DISPLAY: Record<Unlock, UnlockName> = {
  builder: 'Builder',
  digger: 'Digger',
  firefighter: 'Firefighter',
};

/** Accepts the engine id (`builder`) or the display name (`Builder`). */
export function unlockName(u: UnlockLike): UnlockName {
  return (UNLOCK_DISPLAY as Record<string, UnlockName>)[u] ?? (u as UnlockName);
}
