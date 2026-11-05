'use client';
// Puzzle mode on home: a plain link to /puzzles (no data, so home makes no extra call).
import Link from 'next/link';
import { routes } from '@/lib/routes';
import p from './puzzles.module.css';

export function PuzzlesStrip() {
  return (
    <aside className={p.strip} aria-labelledby="puzzles-strip-title" data-testid="puzzles-strip">
      <span className={p.stripText}>
        <span className="sk-kick">Single player · no rival</span>
        <span id="puzzles-strip-title" className={p.stripTitle}>
          Puzzles
        </span>
        <span className={p.stripSub}>Fixed boards, fewest ticks wins. Beat par for gold.</span>
      </span>
      <Link href={routes.puzzles()} className={p.stripGo} data-testid="puzzles-strip-go">
        Open ▸
      </Link>
    </aside>
  );
}
