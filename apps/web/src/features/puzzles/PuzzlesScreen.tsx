'use client';
// /puzzles: puzzle mode. A grid of small hand-made boards, each solved by the player's own crew in
// as few ticks as possible with no rival on the board. Each card shows the goal, par (the gold
// threshold) and the player's best medal; a card opens the puzzle (/puzzles/:id).
import { DisplayHeading } from '@skirm/ui';
import Link from 'next/link';
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import type { PuzzleList } from '@/lib/api/puzzleTypes';
import { routes } from '@/lib/routes';
import { usePuzzles } from './hooks';
import { Medal, goalText } from './parts';
import p from './puzzles.module.css';

export function PuzzlesScreen() {
  return (
    <div data-testid="screen-puzzles" className={p.page}>
      <RequireSession>
        <PuzzlesData />
      </RequireSession>
    </div>
  );
}

function PuzzlesData() {
  const q = usePuzzles();
  if (!q.data) {
    if (q.error) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} />;
    return <Skeleton rows={6} label="Loading the puzzles" />;
  }
  return <PuzzleGrid list={q.data} />;
}

function PuzzleGrid({ list }: { list: PuzzleList }) {
  const m = list.medals;
  return (
    <>
      <header className={p.head}>
        <span className="sk-kick">Single player · no rival</span>
        <DisplayHeading level={1}>Puzzles</DisplayHeading>
        <p className={p.lede}>
          Small boards with fixed hazards. Bring your crew and its skills, solve the board in as few ticks as you can, and beat par for
          gold. {list.free ? 'Free on the offline brain.' : 'With a model, a run holds credits for your crew like a practice match.'}
        </p>
        <div className={p.tally} data-testid="puzzles-tally">
          <span>
            {m.solved} of {m.total} solved
          </span>
          <span>
            <Medal medal="gold" /> {m.gold}
          </span>
          <span>
            <Medal medal="silver" /> {m.silver}
          </span>
          <span>
            <Medal medal="bronze" /> {m.bronze}
          </span>
          <span>
            {list.limit.left} of {list.limit.perHour} runs left this hour
          </span>
        </div>
      </header>
      <ol className={p.grid} aria-label="Puzzles">
        {list.puzzles.map((z) => (
          <li key={z.id}>
            <Link href={routes.puzzle(z.id)} className={p.card} data-testid={`puzzle-card-${z.id}`}>
              <span className={p.cardTop}>
                <span className={p.cardNo}>#{z.n}</span>
                {z.best ? <Medal medal={z.best.medal} testId={`puzzle-medal-${z.id}`} /> : null}
              </span>
              <h2 className={p.cardTitle}>{z.title}</h2>
              <span className={p.cardGoal}>
                {goalText(z.goal, z.item)} · crew up to {z.crewSize}
              </span>
              <span className={p.cardFoot}>
                <span>Par {z.par}</span>
                <span data-testid={`puzzle-best-${z.id}`}>{z.best ? `Best ${z.best.score}` : 'Unsolved'}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
