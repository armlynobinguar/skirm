import type { Metadata } from 'next';
import { PvpLobbyScreen } from '@/features/pvp/PvpLobbyScreen';

export const metadata: Metadata = { title: 'PvP lobby' };

export default function Page() {
  return <PvpLobbyScreen />;
}
