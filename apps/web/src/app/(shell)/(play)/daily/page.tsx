import type { Metadata } from 'next';
import { DailyScreen } from '@/features/daily/DailyScreen';

export const metadata: Metadata = { title: 'Daily challenge' };

export default function Page() {
  return <DailyScreen />;
}
