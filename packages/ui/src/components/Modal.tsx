'use client';
import * as React from 'react';
import { cx } from '../util';
import { Icon } from './Icon';

export interface ModalProps {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  /** Buttons, primary last. */
  footer?: React.ReactNode;
  onClose?: () => void;
  size?: 'md' | 'lg';
  /** Render in place without a fixed scrim (previews and docs). */
  inline?: boolean;
  /** Element focused on open (default: the dialog itself, so screen readers read the title first). */
  initialFocus?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Escape and a scrim click close it. Focus moves in on open, Tab and Shift+Tab cycle inside the
 * dialog (focus that escapes is pulled back), and focus returns to the opener on close.
 */
export function Modal({ open, title, children, footer, onClose, size = 'md', inline, initialFocus }: ModalProps): React.ReactElement | null {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = 'sk-modal-title-' + React.useId().replace(/:/g, '');
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const initialFocusRef = React.useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  React.useEffect(() => {
    if (!open || inline) return;
    const prev = document.activeElement as HTMLElement | null;
    (initialFocusRef.current?.current ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closeRef.current?.();
        return;
      }
      const dialog = ref.current;
      if (e.key !== 'Tab' || !dialog) return;
      const items = focusables(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (e.shiftKey && (!inside || active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (e: FocusEvent): void => {
      const dialog = ref.current;
      if (dialog && e.target instanceof Node && !dialog.contains(e.target)) dialog.focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [open, inline]);

  if (!open) return null;
  return (
    <div
      className={cx('sk-scrim', inline && 'is-inline')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={cx('sk-modal', size === 'lg' && 'is-lg')}
        role="dialog"
        aria-modal={inline ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
      >
        <div className="sk-modal-head">
          <h2 className="sk-modal-title" id={titleId}>
            {title}
          </h2>
          {onClose ? (
            <button type="button" className="sk-iconbtn" aria-label="Close" onClick={onClose}>
              <Icon name="close" />
            </button>
          ) : null}
        </div>
        <div className="sk-modal-body">{children}</div>
        {footer ? <div className="sk-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
