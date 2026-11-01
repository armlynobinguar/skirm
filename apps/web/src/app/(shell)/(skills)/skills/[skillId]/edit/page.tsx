import type { Metadata } from 'next';
import { SkillEditorScreen } from '@/features/skills/SkillEditorScreen';

export const metadata: Metadata = { title: 'Skill editor' };

export default async function Page({ params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params;
  return <SkillEditorScreen skillId={skillId} />;
}
