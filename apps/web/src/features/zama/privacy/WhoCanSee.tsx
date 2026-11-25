// The one way the Zama screens mark a confidential value: SealBadge (🔒 sealed, ✅ open, with words) and
// "Who can see this?", which lists who can read what. Presentational only, no chain code.
import type { ReactNode } from 'react';
import { VISIBILITY, type VisibilityRow, type VisibilityTopic } from './visibility';
import s from './privacy.module.css';

export function SealBadge({ state, children, testId }: { state: 'sealed' | 'open'; children: ReactNode; testId?: string }) {
  return (
    <span className={`${s.badge} ${state === 'open' ? s.open : s.sealed}`} data-state={state} data-testid={testId}>
      {state === 'open' ? '✅' : '🔒'} {children}
    </span>
  );
}

export function WhoCanSee({ topic }: { topic: VisibilityTopic }) {
  const rows: readonly VisibilityRow[] = VISIBILITY[topic];
  return (
    <details className={s.who} data-testid={`zama-who-${topic}`}>
      <summary>Who can see this?</summary>
      <dl className={s.rows}>
        {rows.map((r) => (
          <div key={r.value}>
            <dt>
              <span aria-hidden="true">{r.state === 'open' ? '✅' : '🔒'}</span> {r.value}
            </dt>
            <dd>{r.who}</dd>
          </div>
        ))}
      </dl>
      <p className={s.key}>🔒 stays private · ✅ becomes or is public</p>
    </details>
  );
}
