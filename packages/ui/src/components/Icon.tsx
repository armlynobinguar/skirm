import * as React from 'react';
import { FILLED_ICONS, ICONS } from '../data';
import type { IconName } from '../types';
import { cx } from '../util';

export interface IconProps {
  name: IconName;
  size?: number;
  /** Makes the icon a labelled image; omit for decorative icons next to text. */
  title?: string;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 16, title, strokeWidth = 1.5, className }: IconProps): React.ReactElement {
  const d = ICONS[name] ?? ICONS.info;
  const filled = FILLED_ICONS.has(name);
  return (
    <svg
      className={cx('sk-icon', className)}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      focusable="false"
      data-icon={name}
    >
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}
