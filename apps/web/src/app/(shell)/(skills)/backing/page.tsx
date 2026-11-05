import type { Metadata } from 'next';
import { BackingScreen } from '@/features/backing/BackingScreen';

export const metadata: Metadata = { title: 'Back a writer' };

export default function Page() {
  return <BackingScreen />;
}
