import type { Metadata } from 'next';
import { TournamentScreen } from '@/features/lobbies/TournamentScreen';

export const metadata: Metadata = { title: 'Tournament' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TournamentScreen id={id} />;
}
