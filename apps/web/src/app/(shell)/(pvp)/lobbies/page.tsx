import type { Metadata } from 'next';
import { LobbiesScreen } from '@/features/lobbies/LobbiesScreen';

export const metadata: Metadata = { title: 'Private lobbies' };

export default function Page() {
  return <LobbiesScreen />;
}
