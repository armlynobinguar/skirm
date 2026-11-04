import type { Metadata } from 'next';
import { LobbyScreen } from '@/features/lobbies/LobbyScreen';

export const metadata: Metadata = { title: 'Lobby' };

export default async function Page({ params }: { params: Promise<{ lobbyId: string }> }) {
  const { lobbyId } = await params;
  return <LobbyScreen lobbyId={lobbyId} />;
}
