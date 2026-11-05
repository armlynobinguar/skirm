import type { Metadata } from 'next';
import { PuzzleScreen } from '@/features/puzzles/PuzzleScreen';

export const metadata: Metadata = { title: 'Puzzle' };

export default async function Page({ params }: { params: Promise<{ puzzleId: string }> }) {
  const { puzzleId } = await params;
  return <PuzzleScreen puzzleId={puzzleId} />;
}
