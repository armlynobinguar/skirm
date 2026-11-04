import type { Metadata } from 'next';
import { JoinLobbyScreen } from '@/features/lobbies/JoinLobbyScreen';

export const metadata: Metadata = { title: 'Join a lobby' };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinLobbyScreen code={code} />;
}
