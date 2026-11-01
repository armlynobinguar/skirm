import * as React from 'react';
import type { Tone } from '../types';
import { cx } from '../util';

export interface MeterProps {
  value: number;
  max: number;
  tone?: Tone | null;
  label?: string;
}

/** A thin progress bar that eases its width in duration-step. */
export function Meter({ value, max, tone, label }: MeterProps): React.ReactElement {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span
      className={cx('sk-meter', tone && 'sk-tone-' + tone)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <span className="sk-meter-fill" style={{ width: pct * 100 + '%' }} />
    </span>
  );
}
