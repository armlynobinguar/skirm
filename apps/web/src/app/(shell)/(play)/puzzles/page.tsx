import type { Metadata } from 'next';
import { PuzzlesScreen } from '@/features/puzzles/PuzzlesScreen';

export const metadata: Metadata = { title: 'Puzzles' };

export default function Page() {
  return <PuzzlesScreen />;
}
