import type { Metadata } from 'next';
import { BenchRunScreen } from '@/features/skills/bench/BenchRunScreen';

export const metadata: Metadata = { title: 'Bench debrief' };

export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <BenchRunScreen runId={runId} />;
}
