import type { Metadata } from 'next';
import { VerifyScreen } from '@/features/verify/VerifyScreen';
import { shareMeta } from '@/lib/share-meta';
import { routes } from '@/lib/routes';

export const metadata: Metadata = shareMeta(
  'Verify a match',
  'Recompute a skirm match log in your browser and compare it with the result recorded on NEAR.',
  routes.verify(),
);

export default function Page() {
  return <VerifyScreen />;
}
