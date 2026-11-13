import type { Metadata } from 'next';
import { LeaderboardsScreen } from '@/features/pvp/LeaderboardsScreen';
import { shareMeta } from '@/lib/share-meta';
import { routes } from '@/lib/routes';

export const metadata: Metadata = shareMeta(
  'Leaderboards',
  "The skirm ladders: this season's standings and prize pool, all-time Elo, the best crews on each map and the top skills. Open to everyone, no sign-in.",
  routes.leaderboards(),
);

export default function Page() {
  return <LeaderboardsScreen />;
}
