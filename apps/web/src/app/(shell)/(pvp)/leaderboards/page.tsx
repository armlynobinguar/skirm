import type { Metadata } from 'next';
import { LeaderboardsScreen } from '@/features/pvp/LeaderboardsScreen';

export const metadata: Metadata = { title: 'Leaderboards' };

export default function Page() {
  return <LeaderboardsScreen />;
}
