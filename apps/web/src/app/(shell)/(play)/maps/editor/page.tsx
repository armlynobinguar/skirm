import type { Metadata } from 'next';
import { MapEditorScreen } from '@/features/maps/MapEditorScreen';

export const metadata: Metadata = { title: 'Map editor' };

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  return <MapEditorScreen id={id} />;
}
