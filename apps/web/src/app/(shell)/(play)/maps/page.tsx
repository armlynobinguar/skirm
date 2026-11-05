import type { Metadata } from 'next';
import { AtlasScreen } from '@/features/play/AtlasScreen';

export const metadata: Metadata = { title: 'Map atlas' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <AtlasScreen tab={tab === 'community' ? 'community' : 'official'} />;
}
