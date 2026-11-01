import * as React from 'react';
import { UNLOCKS } from '../data';
import type { AgentState, Crew, UnlockLike } from '../types';
import { cx, fmt, unlockName } from '../util';
import { AgentAvatar } from './AgentAvatar';
import { Icon } from './Icon';

export interface AgentSummary {
  name: string;
  crew?: Crew;
  state?: AgentState;
  unlocks?: UnlockLike[];
  skills?: number;
  elo?: number;
}

export interface AgentChipProps {
  agent: AgentSummary;
  className?: string;
}

export function AgentChip({ agent: a, className }: AgentChipProps): React.ReactElement {
  return (
    <div className={cx('sk-agentchip', className)}>
      <AgentAvatar size={28} crew={a.crew} state={a.state} label={a.name} />
      <div className="sk-agentchip-text">
        <div className="sk-agentchip-name">{a.name}</div>
        <div className="sk-agentchip-meta">
          {(a.unlocks ?? []).map((u) => {
            const n = unlockName(u);
            return <Icon key={n} name={UNLOCKS[n].icon} size={12} title={n} />;
          })}
          {a.skills !== undefined ? <span>{a.skills + (a.skills === 1 ? ' skill' : ' skills')}</span> : null}
          {a.elo !== undefined ? <span className="sk-mono">{'Elo ' + fmt(a.elo)}</span> : null}
        </div>
      </div>
    </div>
  );
}
