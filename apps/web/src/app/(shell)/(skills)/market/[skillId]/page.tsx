import type { Metadata } from 'next';
import { SkillDetailScreen } from '@/features/skills/SkillDetailScreen';

export const metadata: Metadata = { title: 'Skill detail' };

export default async function Page({ params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params;
  return <SkillDetailScreen skillId={skillId} />;
}
