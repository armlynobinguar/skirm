import type { Metadata } from 'next';
import { TournamentsScreen } from '@/features/lobbies/TournamentsScreen';

export const metadata: Metadata = { title: 'Tournaments' };

export default function Page() {
  return <TournamentsScreen />;
}
