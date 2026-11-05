import type { Metadata } from 'next';
import { VerifyScreen } from '@/features/verify/VerifyScreen';

export const metadata: Metadata = {
  title: 'Verify a match',
  description: 'Recompute a skirm match log in your browser and compare it with the result recorded on NEAR.',
};

export default function Page() {
  return <VerifyScreen />;
}
