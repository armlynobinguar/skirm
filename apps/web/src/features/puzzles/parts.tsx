'use client';
// Pieces the puzzle screens share: medal badges, goal text and the board preview.
import type { PuzzleDetail, PuzzleGoal, PuzzleMedal, PuzzleView } from '@/lib/api/puzzleTypes';
import p from './puzzles.module.css';

export const MEDAL_LABEL: Record<PuzzleMedal, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const MEDALS: PuzzleMedal[] = ['gold', 'silver', 'bronze'];

export function Medal({ medal, testId }: { medal: PuzzleMedal | null; testId?: string }) {
  if (!medal) return null;
  return (
    <span className={p.medal} data-medal={medal} data-testid={testId}>
      {MEDAL_LABEL[medal]}
    </span>
  );
}

/** "Deliver 2 Water jug", "Reach the marked tile", "Hold out 40 ticks". */
export function goalText(goal: PuzzleGoal, item: string): string {
  if (goal.kind === 'deliver') return `Deliver ${goal.count} ${item}`;
  if (goal.kind === 'reach') return 'Reach the marked tile';
  return `Hold out ${goal.ticks} ticks`;
}

/** How a puzzle is scored, one line. */
export function scoreRule(v: Pick<PuzzleView, 'goal'>): string {
  return v.goal.kind === 'survive'
    ? 'Score: the ticks held, plus 4 per knock-down, less 5 per item delivered. Lower is better.'
    : 'Score: the tick you solve it on. Lower is better.';
}

/** "Gold ≤ 17 · Silver ≤ 20 · Bronze ≤ 26". */
export function MedalLadder({ medals }: { medals: PuzzleView['medals'] }) {
  return (
    <ul className={p.ladder} aria-label="Medal thresholds">
      {MEDALS.map((m) => (
        <li key={m}>
          <Medal medal={m} /> ≤ {medals[m]}
        </li>
      ))}
    </ul>
  );
}

const TILE: Record<string, { cls: string; label: string }> = {
  '#': { cls: 'wall', label: 'wall' },
  '.': { cls: 'floor', label: 'floor' },
  ',': { cls: 'grass', label: 'grass' },
  T: { cls: 'tree', label: 'tree' },
  d: { cls: 'dirt', label: 'rubble' },
  '~': { cls: 'water', label: 'water' },
  L: { cls: 'lava', label: 'lava' },
  '^': { cls: 'fire', label: 'fire' },
  '*': { cls: 'item', label: 'item' },
  E: { cls: 'exit', label: 'delivery point' },
  c: { cls: 'crate', label: 'crate' },
  B: { cls: 'block', label: 'block' },
  X: { cls: 'goal', label: 'goal tile' },
  '1': { cls: 'start', label: 'start' },
  '2': { cls: 'start', label: 'start' },
  '3': { cls: 'start', label: 'start' },
};

const GLYPH: Record<string, string> = { '*': '◆', E: '⇥', X: '★', '1': '1', '2': '2', '3': '3', '^': '▲', L: '≈', '~': '≈', d: '░' };

/** The board as a grid of tiles, the way the puzzle starts. */
export function BoardPreview({ board, title }: { board: PuzzleDetail['board']; title: string }) {
  return (
    <figure className={p.boardWrap}>
      <div
        className={p.board}
        role="img"
        aria-label={`${title}: ${board.w} by ${board.h} board`}
        style={{ gridTemplateColumns: `repeat(${board.w}, minmax(0, 1fr))` }}
        data-testid="puzzle-board"
      >
        {board.layout.flatMap((row, y) =>
          [...row].map((ch, x) => {
            const t = TILE[ch] ?? TILE['.']!;
            return (
              <span key={`${x},${y}`} className={p.tile} data-tile={t.cls} title={t.label}>
                {GLYPH[ch] ?? ''}
              </span>
            );
          }),
        )}
      </div>
      <figcaption className={p.legend}>
        <span data-tile="start">1 start</span> <span data-tile="item">◆ item</span> <span data-tile="exit">⇥ delivery</span>{' '}
        <span data-tile="goal">★ goal tile</span> <span data-tile="dirt">░ rubble</span> <span data-tile="water">≈ water</span>{' '}
        <span data-tile="fire">▲ fire</span> <span data-tile="lava">≈ lava</span>
      </figcaption>
    </figure>
  );
}
