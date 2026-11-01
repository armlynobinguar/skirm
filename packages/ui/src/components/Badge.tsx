import * as React from 'react';
import type { IconName, Tone } from '../types';
import { cx } from '../util';
import { Icon } from './Icon';
import { TONE_ICON } from './tone';

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone?: Tone | 'you';
  /** An Icon name, or false for none. Tone badges show their tone icon by default. */
  icon?: IconName | false;
  solid?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/** Extra props (data-testid, aria-*, title, …) go to the outer span. */
export function Badge({ tone = 'neutral', icon, solid, children, className, ...rest }: BadgeProps): React.ReactElement {
  const shown: IconName | null =
    icon === false ? null : icon ? icon : tone !== 'neutral' && tone !== 'you' ? TONE_ICON[tone] : null;
  return (
    <span {...rest} className={cx('sk-badge', 'sk-tone-' + tone, solid && 'is-solid', className)}>
      {shown ? <Icon name={shown} size={12} strokeWidth={2} /> : null}
      <span>{children}</span>
    </span>
  );
}
