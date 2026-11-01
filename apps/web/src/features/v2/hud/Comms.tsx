'use client';
// The comms feed (the prototype's flushLog): newest first, filtered All / Team / Say / heard / Mind.
// Rival team talk reaches it only when your agents overheard it (amber ear); your own team talk a
// rival overheard carries the ear and who heard it. Plan changes are the Mind lines.
import { Segmented, type SegmentedOption } from '@skirm/ui';
import type { Team } from '@skirm/engine/v2';
import type { CSSProperties } from 'react';
import type { V2CommsLine } from '../v2Store';
import c from './hud.module.css';
import { clock, feedTag, inFilter, type FeedFilter, type FeedTag } from './model';
import { Ear } from './parts';

/** Most lines the feed shows (the prototype keeps 70). */
const SHOWN = 70;

const LABEL: Record<Exclude<FeedTag, 'heard'>, string> = { team: 'Team', rteam: 'Team', say: 'Say', verb: 'Verb', arena: 'Arena', mind: 'Plan' };

const FILTERS: SegmentedOption<FeedFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'team', label: 'Team' },
  { value: 'say', label: 'Say' },
  {
    value: 'heard',
    label: (
      <span role="img" aria-label="Overheard" title="Overheard">
        <Ear />
      </span>
    ),
  },
  { value: 'mind', label: 'Mind' },
];

export function Comms({ lines, team, filter, onFilter, tickMs }: { lines: V2CommsLine[]; team: Team; filter: FeedFilter; onFilter: (f: FeedFilter) => void; tickMs: number }) {
  const shown: V2CommsLine[] = [];
  for (let i = lines.length - 1; i >= 0 && shown.length < SHOWN; i--) if (inFilter(lines[i]!, team, filter)) shown.push(lines[i]!);
  // Keys that stay with a line as new ones arrive (so only new lines animate in).
  const seen = new Map<string, number>();
  const keyOf = (l: V2CommsLine) => {
    const k = `${l.tick}|${l.from}|${l.channel}|${l.text}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `${k}|${n}`;
  };
  return (
    <section className={c.comms} aria-label="Comms">
      <div className={c.commsHd}>
        <span className="sk-kick">
          <b>Comms</b> · live
        </span>
        <Segmented label="Filter comms" options={FILTERS} value={filter} onChange={onFilter} className={c.filter} data-testid="v2-comms-filter" />
      </div>
      <ol className={c.feed} data-testid="v2-comms" aria-live="polite">
        {shown.length === 0 ? (
          <li className={c.msg} style={{ '--c': 'var(--line-strong)' } as CSSProperties}>
            <span className={c.tx}>{lines.length ? 'Nothing on this channel yet.' : 'Nobody has spoken yet.'}</span>
          </li>
        ) : null}
        {shown.map((l) => {
          const tag = feedTag(l, team);
          const colour = tag === 'arena' ? 'var(--amber)' : l.team === team ? 'var(--you)' : 'var(--rival)';
          const heardBy = l.overheardBy?.length ? l.overheardBy.join(', ') : null;
          return (
            <li key={keyOf(l)} className={c.msg} data-tag={tag} style={{ '--c': colour } as CSSProperties}>
              <span className={c.tk}>{clock((l.tick * tickMs) / 1000)}</span>
              <span className={c.who}>
                <b>{l.fromName}</b>
                <span className={c.ch} data-tag={tag}>
                  {tag === 'heard' ? (
                    <span role="img" aria-label="Overheard">
                      <Ear />
                    </span>
                  ) : (
                    LABEL[tag]
                  )}
                </span>
              </span>
              <span className={c.tx}>{l.text}</span>
              {heardBy ? (
                <span className={c.note} title={`Overheard by ${heardBy}`}>
                  <Ear />
                  {heardBy}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
