import type { Metadata } from 'next';
import { HomeScreen } from '@/features/play/HomeScreen';

export const metadata: Metadata = { title: 'Play' };

export default function Page() {
  return <HomeScreen />;
}
