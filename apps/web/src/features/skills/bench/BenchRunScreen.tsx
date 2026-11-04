'use client';
// A bench run's debrief (/skills/bench/[runId]): verdict, score, the engine's crew debrief, the
// key events, the log hash, and the prompt that played when it is the caller's own text.
import Link from 'next/link';
import { RequireSession } from '@/components/shell/RequireSession';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { ButtonLink } from '@/components/ButtonLink';
import { routes } from '@/lib/routes';
import s from '../skills.module.css';
import b from './bench.module.css';
import { useBenchRun } from './hooks';
import { Debrief, EventList, RunStatus, scoreLine, seedLabel } from './parts';

export function BenchRunScreen({ runId }: { runId: string }) {
  return (
    <RequireSession>
      <BenchRun runId={runId} />
    </RequireSession>
  );
}

function BenchRun({ runId }: { runId: string }) {
  const q = useBenchRun(runId);
  return (
    <div className={s.page} data-testid="screen-bench-run">
      <QueryView query={q} loading={<Skeleton rows={8} label="Loading the run" />}>
        {(r) => (
          <>
            <section className={s.head}>
              <div className={s.headText}>
                <div className={s.crumbs}>
                  <Link href={routes.skills()}>My skills</Link> / <Link href={routes.skillBench(r.skillId, r.version)}>Test bench</Link> / Debrief
                </div>
                <h1 className="app-h1">
                  {r.skillName ?? 'Skill'} v{r.version} <RunStatus run={r} />
                </h1>
                <p className={s.lede}>
                  {seedLabel(r)} against the greedy bot{r.result ? ` · ${scoreLine(r.result)}` : ''}
                  {r.brain === 'greedy' ? ' · offline greedy brain' : r.brain ? ` · ${r.brain}` : ''}
                </p>
              </div>
              <ButtonLink
                href={`${routes.skillBench(r.skillId, r.version)}&map=${encodeURIComponent(r.mapId)}&d=${r.difficulty}`}
                icon="play"
                data-testid="bench-run-again"
              >
                Run this seed again
              </ButtonLink>
            </section>
            {r.status === 'insufficient_credits' ? (
              <p className="app-banner is-warning" role="note">
                Not played: the run needed {r.shortfall?.need ?? '?'} credits and you had {r.shortfall?.have ?? 0}.{' '}
                <Link href={routes.credits()}>Top up</Link>
              </p>
            ) : r.status === 'failed' ? (
              <p className="app-banner is-critical" role="note">
                The run failed ({r.error ?? 'error'}). Run it again.
              </p>
            ) : !r.result ? (
              <Skeleton rows={4} label="Playing" />
            ) : (
              <div className={s.columns}>
                <section className={`${s.panel} ${s.main}`} aria-label="Debrief">
                  <h2 className={s.h2}>Debrief</h2>
                  <Debrief result={r.result} />
                  <h2 className={s.h2}>Key events</h2>
                  <EventList result={r.result} testId="bench-events" />
                  <p className={`${s.note} ${s.mono}`}>Log hash {r.result.logHash}</p>
                </section>
                <section className={`${s.panel} ${s.aside}`} aria-label="Prompt">
                  <h2 className={s.h2}>Prompt that played{r.edited ? ' (edited)' : ''}</h2>
                  {r.promptHidden ? (
                    <p className="sk-muted">Hidden: you hold this version but did not write it.</p>
                  ) : (
                    <pre className={b.diff} data-testid="bench-run-prompt">
                      {r.prompt}
                      {r.reflexes ? `\n\n${r.reflexes}` : ''}
                    </pre>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </QueryView>
    </div>
  );
}
