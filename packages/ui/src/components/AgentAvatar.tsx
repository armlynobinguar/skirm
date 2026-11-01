import * as React from 'react';
import { agentGlyph } from '../glyphs';
import type { AgentState, Crew } from '../types';
import { cx } from '../util';

export interface AgentAvatarProps {
  size?: number;
  crew?: Crew;
  state?: AgentState;
  /** The agent's name, for screen readers. */
  label?: string;
  className?: string;
}

export function AgentAvatar({ size = 32, crew, state, label, className }: AgentAvatarProps): React.ReactElement {
  const detail = size >= 20 ? 'full' : 'compact';
  const aria = (label || 'Agent') + (crew ? ', crew ' + crew.toUpperCase() : '') + (state === 'lost' ? ', lost' : '');
  return (
    <span
      className={cx('sk-avatar', state === 'acting' && 'is-acting', state === 'lost' && 'is-lost', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={aria}>
        {agentGlyph({ detail, crew, lost: state === 'lost', letter: crew && size >= 28 ? crew.toUpperCase() : null })}
      </svg>
    </span>
  );
}
