'use client';
// Pieces the bench screens share: a run's verdict, its key events, its debrief and the prompt diff.
import { Badge } from '@skirm/ui';
import { DIFF_MODS, MAPS_V2, type Difficulty } from '@skirm/engine/v2';
import type { BenchRun, BenchRunResult, DiffPart } from '@/lib/api/types';
import b from './bench.module.css';

export const mapName = (id: string) => MAPS_V2.find((m) => m.id === id)?.name ?? id;
export const diffName = (d: string) => DIFF_MODS[d as Difficulty]?.name ?? d;
export const seedLabel = (r: Pick<BenchRun, 'mapId' | 'difficulty'>) => `${mapName(r.mapId)} · ${diffName(r.difficulty)}`;

const OUTCOME: Record<BenchRunResult['outcome'], { label: string; tone: 'good' | 'critical' | 'neutral' }> = {
  win: { label: 'Win', tone: 'good' },
  loss: { label: 'Loss', tone: 'critical' },
  draw: { label: 'Draw', tone: 'neutral' },
};

/** The run's state or verdict as a badge. */
export function RunStatus({ run }: { run: BenchRun }) {
  if (run.status === 'done' && run.result) {
    const o = OUTCOME[run.result.outcome];
    return (
      <Badge tone={o.tone} data-testid={`bench-outcome-${run.id}`}>
        {o.label}
      </Badge>
    );
  }
  const label =
    run.status === 'queued'
      ? 'Queued'
      : run.status === 'running'
        ? 'Playing'
        : run.status === 'insufficient_credits'
          ? 'Needs credits'
          : 'Failed';
  const tone = run.status === 'failed' || run.status === 'insufficient_credits' ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} icon={false} data-testid={`bench-outcome-${run.id}`}>
      {label}
    </Badge>
  );
}

/** Score, ticks and how it ended, one line. */
export function scoreLine(r: BenchRunResult): string {
  return `${r.score.you}–${r.score.bot} · ${r.ticks} ticks · ${r.reason}`;
}

export function EventList({ result, testId }: { result: BenchRunResult; testId?: string }) {
  if (result.events.length === 0) return <p className="sk-muted">No key events: nobody delivered, fell or pulled a switch.</p>;
  return (
    <ol className={b.events} data-testid={testId}>
      {result.events.map((e, i) => (
        <li key={i} className={b.event} data-side={e.side}>
          <span className={b.tick}>t{e.tick}</span>
          <span>{e.text}</span>
        </li>
      ))}
      {result.eventsDropped > 0 ? <li className="sk-muted">…and {result.eventsDropped} more</li> : null}
    </ol>
  );
}

export function Debrief({ result }: { result: BenchRunResult }) {
  const d = result.debrief;
  return (
    <div className={b.debrief} data-testid="bench-debrief">
      <dl className={b.stats}>
        <div>
          <dt>Score</dt>
          <dd>
            {result.score.you}–{result.score.bot}
          </dd>
        </div>
        <div>
          <dt>Ticks</dt>
          <dd>{result.ticks}</dd>
        </div>
        <div>
          <dt>Verbs</dt>
          <dd>{d.verbs}</dd>
        </div>
        <div>
          <dt>Steals</dt>
          <dd>{d.steals}</dd>
        </div>
        <div>
          <dt>Lines said</dt>
          <dd>{result.talk.says}</dd>
        </div>
        <div>
          <dt>Lines blocked</dt>
          <dd data-testid="bench-blocked">{result.talk.leaks + result.talk.abuse}</dd>
        </div>
      </dl>
      {result.talk.leaks > 0 ? (
        <p className="app-banner is-warning" role="note">
          The speech filter blocked {result.talk.leaks} line{result.talk.leaks === 1 ? '' : 's'} that quoted your skill.
          Rivals never heard them, but a prompt that recites itself wastes turns.
        </p>
      ) : null}
      {d.goals.length ? (
        <ul className={b.goals}>
          {d.goals.map((g) => (
            <li key={g.title}>
              <Badge tone={g.met ? 'good' : 'neutral'} icon={false}>
                {g.met ? 'Met' : 'Missed'}
              </Badge>{' '}
              {g.title}
              {g.progress ? <span className="sk-muted"> · {g.progress}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A word diff of two prompts: removed text struck through, added text marked. */
export function PromptDiff({ parts }: { parts: DiffPart[] }) {
  return (
    <pre className={b.diff} data-testid="bench-diff">
      {parts.map((p, i) =>
        p.op === 'same' ? (
          <span key={i}>{p.text}</span>
        ) : p.op === 'del' ? (
          <del key={i} className={b.del}>
            {p.text}
          </del>
        ) : (
          <ins key={i} className={b.ins}>
            {p.text}
          </ins>
        ),
      )}
    </pre>
  );
}
