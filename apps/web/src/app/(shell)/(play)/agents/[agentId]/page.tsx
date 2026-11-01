import type { Metadata } from 'next';
import { AgentEditorScreen } from '@/features/agents/AgentEditorScreen';

export const metadata: Metadata = { title: 'Agent' };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ map?: string; d?: string }>;
}) {
  const { agentId } = await params;
  const { map, d } = await searchParams;
  return <AgentEditorScreen agentId={agentId} mapId={map} difficulty={d} />;
}
