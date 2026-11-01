'use client';
import * as React from 'react';
import type { IconName } from '../types';
import { cx } from '../util';
import { Icon } from './Icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  /** Three squares lighting in tick order; disables the button and keeps its width. */
  loading?: boolean;
  block?: boolean;
}

function TickDots(): React.ReactElement {
  return (
    <span className="sk-tickdots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading,
  block,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): React.ReactElement {
  const iconSize = size === 'lg' ? 18 : 16;
  return (
    <button
      type={type}
      {...rest}
      className={cx('sk-btn', 'sk-btn-' + variant, 'sk-btn-' + size, block && 'sk-btn-block', loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
    >
      {loading ? <TickDots /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children !== undefined && children !== null && children !== false ? <span>{children}</span> : null}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  );
}
