import type { Metadata } from 'next';
import { BenchScreen } from '@/features/skills/bench/BenchScreen';

export const metadata: Metadata = { title: 'Test bench' };

export default function Page() {
  return <BenchScreen />;
}
