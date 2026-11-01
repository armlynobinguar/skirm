import type { Metadata } from 'next';
import { V2CrewScreen } from '@/features/play/CrewBuilderScreenV2';

export const metadata: Metadata = { title: 'Crew builder' };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ mapId: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { mapId } = await params;
  const { d } = await searchParams;
  return <V2CrewScreen mapId={mapId} difficulty={d} />;
}
