import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FogScreen } from '@/features/zama/fog/FogScreen';
import { shareMeta } from '@/lib/share-meta';
import { routes } from '@/lib/routes';
import { zamaConfig } from '@/lib/zama/config';

export const metadata: Metadata = shareMeta(
  'Fog Skirm',
  'A two-player hidden-information duel played fully on chain: traps, scouts and the seed vial stay encrypted with Zama FHEVM on Sepolia.',
  routes.fog(),
);

export default function Page() {
  // Zama features are off unless NEXT_PUBLIC_ZAMA_ENABLED is set at build time.
  if (!zamaConfig.enabled) notFound();
  return <FogScreen />;
}
