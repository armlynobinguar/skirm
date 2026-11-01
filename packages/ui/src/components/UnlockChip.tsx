import * as React from 'react';
import { UNLOCKS } from '../data';
import type { IconName, UnlockLike } from '../types';
import { cx, unlockName } from '../util';
import { Icon } from './Icon';

export interface UnlockChipProps {
  /** `Builder` / `builder`, `Digger` / `digger`, `Firefighter` / `firefighter`. */
  unlock: UnlockLike;
  state?: 'owned' | 'needed' | 'missing';
  className?: string;
}

export function UnlockChip({ unlock, state = 'owned', className }: UnlockChipProps): React.ReactElement {
  const name = unlockName(unlock);
  const u = UNLOCKS[name] ?? UNLOCKS.Builder;
  const lead: IconName = state === 'missing' ? 'warning' : state === 'owned' ? u.icon : 'lock';
  return (
    <span className={cx('sk-chip', 'sk-chip-unlock', 'is-' + state, className)} title={name + ' unlocks ' + u.action}>
      <Icon name={lead} size={13} />
      <span>{name}</span>
      {state === 'missing' ? (
        <span className="sk-chip-note">not on map</span>
      ) : state === 'needed' ? (
        <span className="sk-chip-note">needed</span>
      ) : null}
    </span>
  );
}
