import * as React from 'react';
import type { Tag } from '@skirm/shared';
import { TAG_MEANING } from '../data';
import { cx } from '../util';
import { Icon } from './Icon';

export interface TagChipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  tag: Tag;
  count?: number;
  className?: string;
}

/** A mechanic tag exactly as the engine names it; the tooltip carries its meaning. */
export function TagChip({ tag, count, className, ...rest }: TagChipProps): React.ReactElement {
  return (
    <span title={TAG_MEANING[tag]} {...rest} className={cx('sk-chip', 'sk-chip-tag', className)}>
      <Icon name={`tag_${tag}`} size={13} />
      <span>{tag}</span>
      {count !== undefined ? <span className="sk-chip-count">{count}</span> : null}
    </span>
  );
}
