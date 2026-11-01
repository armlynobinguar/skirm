import type { Metadata } from 'next';
import { SkillEditorScreen } from '@/features/skills/SkillEditorScreen';

export const metadata: Metadata = { title: 'New skill' };

export default function Page() {
  return <SkillEditorScreen skillId={null} />;
}
