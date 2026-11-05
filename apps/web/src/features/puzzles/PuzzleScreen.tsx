'use client';
// /puzzles/:id: one puzzle. The board as it starts, the goal, par and medal thresholds, a crew
// picker (the player's own agents, up to the puzzle's crew size) and the run button. A run plays
// headless on the worker (POST /puzzles/:id/runs), polled until done; the result shows solved or
// not, the score and medal, the key-event timeline and the log hash. The board under it ranks each
// player's best.
import { Button, DisplayHeading } from '@skirm/ui';
import { useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { ApiError } from '@/lib/api/errors';
import type { PuzzleDetail, PuzzleRun } from '@/lib/api/puzzleTypes';
import { useMe } from '@/lib/api/queries';
import type { Me } from '@/lib/api/types';
import { routes } from '@/lib/routes';
import { isOpen, usePuzzle, usePuzzleBoard, usePuzzleRun, useStartPuzzleRun } from './hooks';
import { BoardPreview, Medal, MedalLadder, goalText, scoreRule } from './parts';
import p from './puzzles.module.css';

export function runError(code: string): string {
  switch (code) {
    case 'puzzle_limit':
      return 'You have used this hour’s puzzle runs. Try again later.';
    case 'invalid_crew':
      return 'That crew does not fit this puzzle.';
    case 'forbidden':
      return 'Every agent in the crew must be yours.';
    case 'queue_unavailable':
      return 'Puzzle runs are paused for a moment. Try again shortly.';
    default:
      return 'Could not start the run. Try again in a moment.';
  }
}

const REASON: Record<string, string> = {
  goal: 'Solved',
  time: 'Out of time: the tick cap ran out',
  eliminated: 'The whole crew was removed',
};

export function PuzzleScreen({ puzzleId }: { puzzleId: string }) {
  return (
    <div data-testid="screen-puzzle" className={p.page}>
      <RequireSession>
        <PuzzleData puzzleId={puzzleId} />
      </RequireSession>
    </div>
  );
}

function PuzzleData({ puzzleId }: { puzzleId: string }) {
  const me = useMe();
  const q = usePuzzle(puzzleId);
  if (!me.data || !q.data) {
    const err = me.error ?? q.error;
    if (err) return <ErrorCard error={err} onRetry={() => void (me.isError ? me.refetch() : q.refetch())} />;
    return <Skeleton rows={8} label="Loading the puzzle" />;
  }
  return <Puzzle me={me.data} puzzle={q.data} />;
}

function Puzzle({ me, puzzle }: { me: Me; puzzle: PuzzleDetail }) {
  const [crew, setCrew] = useState<string[]>(() => me.agents.slice(0, 1).map((a) => a.id));
  const [runId, setRunId] = useState<string | null>(() => puzzle.runs[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const start = useStartPuzzleRun(puzzle.id);
  const run = usePuzzleRun(puzzle.id, runId);
  const playing = start.isPending || (!!run.data && isOpen(run.data));

  const toggle = (id: string) =>
    setCrew((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= puzzle.crewSize ? [...c.slice(1), id] : [...c, id]));

  const go = () => {
    setError(null);
    start.mutate(
      { crew: crew.map((agentId) => ({ agentId })) },
      {
        onSuccess: (r) => setRunId(r.id),
        onError: (e) => setError(runError(e instanceof ApiError ? e.code : 'internal')),
      },
    );
  };

  return (
    <>
      <header className={p.head}>
        <span className="sk-kick">
          Puzzle #{puzzle.n} · {goalText(puzzle.goal, puzzle.item)}
        </span>
        <DisplayHeading level={1}>{puzzle.title}</DisplayHeading>
        <p className={p.lede}>{puzzle.briefing}</p>
      </header>
      <div className={p.layout}>
        <div className={p.col}>
          <section className={p.panel} aria-labelledby="puzzle-board-title">
            <h2 id="puzzle-board-title" className={p.h2}>
              The board
            </h2>
            <BoardPreview board={puzzle.board} title={puzzle.title} />
            {puzzle.board.hazards.length ? (
              <p className={p.muted}>
                {puzzle.board.hazards.map((h) => `${h.kind} spreads every ${h.every} ticks for ${h.cap} waves`).join(' · ')}
              </p>
            ) : (
              <p className={p.muted}>No hazards on this board.</p>
            )}
          </section>
          {runId ? <RunResult run={run.data} loading={run.isLoading} /> : null}
          <Leaderboard puzzleId={puzzle.id} meId={me.account.id} />
        </div>
        <section className={p.panel} aria-labelledby="puzzle-run-title" data-testid="puzzle-run-panel">
          <h2 id="puzzle-run-title" className={p.h2}>
            Run it
          </h2>
          <dl className={p.facts}>
            <dt>Goal</dt>
            <dd data-testid="puzzle-goal">{goalText(puzzle.goal, puzzle.item)}</dd>
            <dt>Par</dt>
            <dd data-testid="puzzle-par">{puzzle.par}</dd>
            <dt>Tick cap</dt>
            <dd>{puzzle.cap}</dd>
            <dt>Credits</dt>
            <dd>{puzzle.costCredits ? `Holds up to ${puzzle.costCredits} per agent` : 'None on the offline brain'}</dd>
            <dt>Your best</dt>
            <dd data-testid="puzzle-your-best">
              {puzzle.best ? (
                <>
                  {puzzle.best.score} <Medal medal={puzzle.best.medal} /> · {puzzle.best.solves} solve{puzzle.best.solves === 1 ? '' : 's'}
                </>
              ) : (
                'Not solved yet'
              )}
            </dd>
          </dl>
          <MedalLadder medals={puzzle.medals} />
          <p className={p.muted}>{scoreRule(puzzle)}</p>
          {me.agents.length ? (
            <fieldset className={p.crew} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className={p.muted}>
                Crew: up to {puzzle.crewSize} agent{puzzle.crewSize === 1 ? '' : 's'}, with the skills they carry
              </legend>
              {me.agents.map((a) => (
                <label key={a.id} className={p.crewItem}>
                  <input type="checkbox" checked={crew.includes(a.id)} onChange={() => toggle(a.id)} data-testid={`puzzle-crew-${a.id}`} />
                  <span>
                    {a.name} <span className={p.crewMeta}>{a.role}{a.skills.length ? ` · ${a.skills.map((s) => s.name).join(', ')}` : ''}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className={p.muted}>No agents on this account yet.</p>
          )}
          {error ? (
            <div className="app-banner is-critical" role="alert" data-testid="puzzle-error">
              {error}
            </div>
          ) : null}
          <div className={p.row}>
            <Button variant="primary" onClick={go} loading={playing} disabled={playing || crew.length === 0} data-testid="puzzle-run">
              {playing ? 'Playing…' : puzzle.best ? 'Run again ▸' : 'Run ▸'}
            </Button>
            <ButtonLink href={routes.puzzles()} variant="ghost">
              All puzzles
            </ButtonLink>
          </div>
        </section>
      </div>
    </>
  );
}

function RunResult({ run, loading }: { run: PuzzleRun | undefined; loading: boolean }) {
  if (!run) return loading ? <Skeleton rows={3} label="Loading the run" /> : null;
  const r = run.result;
  return (
    <section className={p.panel} aria-labelledby="puzzle-result-title" aria-live="polite" data-testid="puzzle-result">
      <h2 id="puzzle-result-title" className={p.h2}>
        Last run
      </h2>
      {isOpen(run) ? (
        <p className={p.muted} data-testid="puzzle-result-status">
          {run.status === 'queued' ? 'Queued…' : 'Playing…'}
        </p>
      ) : run.status === 'insufficient_credits' ? (
        <p className={p.muted} data-testid="puzzle-result-status">
          Not enough credits: the run needs {run.shortfall?.need ?? '?'} and you have {run.shortfall?.have ?? 0}.
        </p>
      ) : run.status === 'failed' || !r ? (
        <p className={p.muted} data-testid="puzzle-result-status">
          The run could not be played ({run.error ?? 'error'}). Try again.
        </p>
      ) : (
        <>
          <div className={p.verdict} data-testid="puzzle-result-status">
            <span className={p.verdictBig}>{r.solved ? `Solved in ${r.ticks} ticks` : (REASON[r.reason] ?? 'Not solved')}</span>
            {r.score !== null ? <span>Score {r.score}</span> : null}
            <Medal medal={r.medal} testId="puzzle-result-medal" />
            {r.best ? <span className="sk-kick">New best</span> : null}
          </div>
          <p className={p.muted}>
            {r.delivered} delivered · {r.knockdowns} knock-down{r.knockdowns === 1 ? '' : 's'} · crew {r.crew.map((a) => a.name).join(', ')} · played by the{' '}
            {run.brain === 'greedy' ? 'offline brain' : 'model'}
          </p>
          {r.events.length ? (
            <ol className={p.events} data-testid="puzzle-events" aria-label="Timeline">
              {r.events.map((e, i) => (
                <li key={i} className={p.event} data-side={e.side}>
                  <span className={p.tick}>t{e.tick}</span>
                  <span>{e.text}</span>
                </li>
              ))}
              {r.eventsDropped > 0 ? <li className={p.muted}>…and {r.eventsDropped} more</li> : null}
            </ol>
          ) : (
            <p className={p.muted}>No key events.</p>
          )}
          <span className={p.hash} title="Hash of the run's tick log: the same crew and moves always give the same hash">
            Log hash {r.logHash}
          </span>
        </>
      )}
    </section>
  );
}

function Leaderboard({ puzzleId, meId }: { puzzleId: string; meId: string }) {
  const q = usePuzzleBoard(puzzleId);
  return (
    <section className={p.panel} aria-labelledby="puzzle-lb-title" data-testid="puzzle-leaderboard">
      <h2 id="puzzle-lb-title" className={p.h2}>
        Leaderboard
      </h2>
      {!q.data ? (
        q.error ? (
          <p className={p.muted}>The board is not available right now.</p>
        ) : (
          <Skeleton rows={3} label="Loading the board" />
        )
      ) : q.data.entries.length === 0 ? (
        <p className={p.muted}>Nobody has solved it yet. Be the first.</p>
      ) : (
        <table className={p.board2}>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th className={p.num}>Score</th>
              <th>Medal</th>
            </tr>
          </thead>
          <tbody>
            {q.data.entries.map((e) => (
              <tr key={e.account.id} data-me={e.account.id === meId || undefined}>
                <td className={p.num}>{e.rank}</td>
                <td>{e.account.handle}</td>
                <td className={p.num}>{e.score}</td>
                <td>
                  <Medal medal={e.medal} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
