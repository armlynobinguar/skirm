'use client';
import * as React from 'react';
import { DURATION } from '../data';
import type { IconName, Tone } from '../types';
import { cx } from '../util';
import { Icon } from './Icon';
import { TONE_ICON } from './tone';

export interface ToastProps {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  icon?: IconName;
  action?: React.ReactNode;
  onClose?: () => void;
  /**
   * Non-critical toasts call onClose after this many ms (motion.md: `duration-toast`).
   * Critical toasts stay until dismissed. 0 disables auto-dismiss.
   */
  autoDismissMs?: number;
  className?: string;
}

export function Toast({
  tone = 'neutral',
  title,
  children,
  icon,
  action,
  onClose,
  autoDismissMs = DURATION.toast,
  className,
}: ToastProps): React.ReactElement {
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const hasClose = !!onClose;
  React.useEffect(() => {
    if (tone === 'critical' || !hasClose || !autoDismissMs) return;
    const t = setTimeout(() => closeRef.current?.(), autoDismissMs);
    return () => clearTimeout(t);
  }, [tone, hasClose, autoDismissMs]);

  return (
    <div className={cx('sk-toast', 'sk-tone-' + tone, className)} role={tone === 'critical' ? 'alert' : 'status'}>
      <span className="sk-toast-icon">
        <Icon name={icon ?? TONE_ICON[tone]} size={16} />
      </span>
      <div className="sk-toast-body">
        {title ? <div className="sk-toast-title">{title}</div> : null}
        {children ? <div className="sk-toast-text">{children}</div> : null}
      </div>
      {action ? <div className="sk-toast-action">{action}</div> : null}
      {onClose ? (
        <button type="button" className="sk-iconbtn" aria-label="Dismiss" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </div>
  );
}
