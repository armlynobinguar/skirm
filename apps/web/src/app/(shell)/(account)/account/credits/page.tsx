import type { Metadata } from 'next';
import { CreditsScreen } from '@/features/account/CreditsScreen';

export const metadata: Metadata = { title: 'Credits' };

export default function Page() {
  return <CreditsScreen />;
}
