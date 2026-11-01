'use client';
import * as React from 'react';
import type { IconName } from '../types';
import { cx } from '../util';
import { Icon } from './Icon';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: IconName;
  disabled?: boolean;
  /** data-testid of this tab's button. */
  testId?: string;
}

export interface TabsProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue' | 'children'> {
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  /** Accessible name of the tab list. */
  label?: string;
  className?: string;
}

/** Roving tab index: arrows, Home and End move between enabled tabs. */
export function Tabs({
  tabs,
  value: valueProp,
  defaultValue,
  onChange,
  label,
  className,
  onKeyDown: onKeyDownProp,
  ...rest
}: TabsProps): React.ReactElement {
  const [inner, setInner] = React.useState<string | undefined>(defaultValue ?? tabs.find((t) => !t.disabled)?.id);
  const value = valueProp !== undefined ? valueProp : inner;
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string): void => {
    if (valueProp === undefined) setInner(id);
    onChange?.(id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    onKeyDownProp?.(e);
    if (e.defaultPrevented) return;
    const enabled = tabs.filter((t) => !t.disabled);
    if (!enabled.length) return;
    const i = enabled.findIndex((t) => t.id === value);
    let n: number;
    switch (e.key) {
      case 'ArrowRight':
        n = i + 1;
        break;
      case 'ArrowLeft':
        n = i - 1;
        break;
      case 'Home':
        n = 0;
        break;
      case 'End':
        n = enabled.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    n = (n + enabled.length) % enabled.length;
    const next = enabled[n]!;
    select(next.id);
    refs.current[next.id]?.focus();
  };

  return (
    <div {...rest} className={cx('sk-tabs', className)} role="tablist" aria-label={label ?? rest['aria-label']} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const sel = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={sel}
            tabIndex={sel ? 0 : -1}
            className={cx('sk-tab', sel && 'is-selected')}
            onClick={() => select(t.id)}
            disabled={t.disabled}
            data-testid={t.testId}
          >
            {t.icon ? <Icon name={t.icon} size={14} /> : null}
            <span>{t.label}</span>
            {t.count !== undefined ? <span className="sk-tab-count">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
