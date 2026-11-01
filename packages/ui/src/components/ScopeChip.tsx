import * as React from 'react';
import { cx } from '../util';

export interface ScopeChipProps {
  scope: 'MVP' | 'Stretch' | 'Roadmap';
  className?: string;
}

export function ScopeChip({ scope = 'MVP', className }: ScopeChipProps): React.ReactElement {
  return <span className={cx('sk-chip', 'sk-chip-scope', 'is-' + scope.toLowerCase(), className)}>{scope}</span>;
}
