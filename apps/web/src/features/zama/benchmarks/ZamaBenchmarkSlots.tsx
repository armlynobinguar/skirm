'use client';
// Mounts the benchmark seeds badge only when NEXT_PUBLIC_ZAMA_ENABLED is on and the benchmark's
// seeds were drawn on chain. The skill page's panel (ethers, ABI) is code-split and its loader only
// exists with the flag on; the Exchange card chip is presentational. Off, nothing renders.
import dynamic from 'next/dynamic';
import type { OnchainBenchmark } from '@skirm/shared';
import { zamaConfig } from '@/lib/zama/config';
import type { BenchmarkSeedsPanelProps } from './BenchmarkSeedsPanel';
import { SeedsBadge } from './SeedsBadge';

const BenchmarkSeedsPanel = zamaConfig.enabled ? dynamic(() => import('./BenchmarkSeedsPanel').then((m) => m.BenchmarkSeedsPanel), { ssr: false }) : null;

/** The skill page's seeds record and "Verify benchmark" (nothing for keyed-hash seeds). */
export function ZamaBenchmarkSeedsSlot(props: Omit<BenchmarkSeedsPanelProps, 'onchain'> & { onchain: BenchmarkSeedsPanelProps['onchain'] | null | undefined }) {
  if (!BenchmarkSeedsPanel || !zamaConfig.enabled || !props.onchain) return null;
  return <BenchmarkSeedsPanel {...props} onchain={props.onchain} />;
}

/** The Exchange card's compact badge (nothing for keyed-hash seeds). */
export function ZamaBenchmarkSeedsChip({ status }: { status: OnchainBenchmark['status'] | null | undefined }) {
  if (!zamaConfig.enabled || !status) return null;
  return <SeedsBadge status={status} />;
}
