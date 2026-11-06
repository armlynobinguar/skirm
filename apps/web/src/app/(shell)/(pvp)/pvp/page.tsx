import type { Metadata } from 'next';
import { PvpLobbyScreen } from '@/features/pvp/PvpLobbyScreen';

export const metadata: Metadata = { title: 'PvP' };

export default function Page() {
  return <PvpLobbyScreen />;
}
