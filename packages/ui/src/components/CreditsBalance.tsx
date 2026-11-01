'use client';
import * as React from 'react';
import { cx, fmt } from '../util';
import { Button } from './Button';
import { Icon } from './Icon';

export interface CreditsBalanceProps {
  balance: number;
  /** Shows "Low balance" below this (set it to the cheapest hold on screen). */
  lowAt?: number;
  onTopUp?: () => void;
  className?: string;
}

export function CreditsBalance({ balance, lowAt, onTopUp, className }: CreditsBalanceProps): React.ReactElement {
  const low = lowAt !== undefined && balance < lowAt;
  return (
    <div className={cx('sk-credits', low && 'is-low', className)}>
      <span className="sk-credits-icon">
        <Icon name="credits" size={16} />
      </span>
      <div className="sk-credits-text">
        <div className="sk-credits-num">
          {fmt(balance)}
          <span className="sk-credits-unit"> credits</span>
        </div>
        {low ? (
          <div className="sk-credits-free sk-text-warning">Low balance</div>
        ) : null}
      </div>
      {onTopUp ? (
        <Button size="sm" icon="plus" onClick={onTopUp}>
          Top up
        </Button>
      ) : null}
    </div>
  );
}
