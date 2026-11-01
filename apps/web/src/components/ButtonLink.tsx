// A next/link styled as an @skirm/ui Button (never nest <button> inside <a>).
import { Icon, cx, type IconName } from '@skirm/ui';
import Link from 'next/link';
import type { ComponentProps } from 'react';

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  block?: boolean;
}

export function ButtonLink({ variant = 'secondary', size = 'md', icon, block, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link
      {...rest}
      className={cx('sk-btn', 'sk-btn-' + variant, 'sk-btn-' + size, block && 'sk-btn-block', className as string | undefined)}
    >
      {icon ? <Icon name={icon} size={size === 'lg' ? 18 : 16} /> : null}
      <span>{children}</span>
    </Link>
  );
}
