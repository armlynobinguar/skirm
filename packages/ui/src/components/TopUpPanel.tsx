'use client';
import * as React from 'react';
import { cx, fmt } from '../util';
import { Badge } from './Badge';
import { Button } from './Button';

export interface TopUpPack {
  near: number;
}

export interface TopUpPanelProps {
  /** Default 1, 5, 10 NEAR. */
  packs?: TopUpPack[];
  /** Rate from the backend (default 1000, a proposed placeholder: never hard-code it in an app). */
  creditsPerNear?: number;
  defaultIndex?: number;
  network?: string;
  onConfirm?: (pack: TopUpPack) => void;
  /** Waiting for the wallet. */
  pending?: boolean;
  className?: string;
}

const DEFAULT_PACKS: TopUpPack[] = [{ near: 1 }, { near: 5 }, { near: 10 }];

export function TopUpPanel({ packs = DEFAULT_PACKS, creditsPerNear = 1000, defaultIndex = 1, network, onConfirm, pending, className }: TopUpPanelProps): React.ReactElement {
  const [sel, setSel] = React.useState(defaultIndex);
  const p = packs[sel] ?? packs[0] ?? { near: 0 };
  return (
    <div className={cx('sk-card', 'sk-topup', className)}>
      <div className="sk-topup-head">
        <h3 className="sk-topup-title">Top up credits</h3>
        {network ? <Badge>{network}</Badge> : null}
      </div>
      <div className="sk-topup-packs" role="radiogroup" aria-label="Amount">
        {packs.map((pk, i) => {
          const on = i === sel;
          return (
            <button key={i} type="button" role="radio" aria-checked={on} className={cx('sk-pack', on && 'is-on')} onClick={() => setSel(i)}>
              <span className="sk-pack-near">{pk.near + ' NEAR'}</span>
              <span className="sk-pack-credits">{fmt(pk.near * creditsPerNear) + ' credits'}</span>
            </button>
          );
        })}
      </div>
      <p className="sk-topup-note">
        1 credit pays for one agent step. A match holds agents × step limit up front; unused credits come back when it ends.
      </p>
      <Button variant="primary" block icon="wallet" onClick={() => onConfirm?.(p)} loading={pending}>
        {pending ? 'Waiting for wallet' : 'Top up ' + p.near + ' NEAR'}
      </Button>
    </div>
  );
}
