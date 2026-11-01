import * as React from 'react';
import { V, cx } from '../util';

export interface LogoMarkProps {
  size?: number;
  /** Accessible name; empty string hides the mark from assistive tech. */
  title?: string;
}

/** The mark: two stacked isometric layers, teal (you) over red (the rival). */
export function LogoMark({ size = 32, title = 'skirm' }: LogoMarkProps): React.ReactElement {
  return (
    <svg
      className="sk-logo-mark"
      width={size}
      height={size}
      viewBox="0 0 26 26"
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      <path d="M13 2 24 8 13 14 2 8Z" style={{ fill: V('you') }} />
      <path d="M2 12l11 6 11-6v4l-11 6-11-6Z" style={{ fill: V('rival') }} />
    </svg>
  );
}

export interface LogoProps {
  size?: number;
  markOnly?: boolean;
  className?: string;
}

export function Logo({ size = 32, markOnly, className }: LogoProps): React.ReactElement {
  return (
    <span className={cx('sk-logo', className)}>
      <LogoMark size={size} title={markOnly ? 'skirm' : ''} />
      {markOnly ? null : (
        <span className="sk-logo-word" style={{ fontSize: Math.round(size * 0.9) + 'px' }}>
          skirm
        </span>
      )}
    </span>
  );
}
