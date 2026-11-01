import type { Metadata } from 'next';
import { AtlasScreen } from '@/features/play/AtlasScreen';

export const metadata: Metadata = { title: 'Map atlas' };

export default function Page() {
  return <AtlasScreen />;
}
