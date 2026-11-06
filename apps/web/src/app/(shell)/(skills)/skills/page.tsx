import type { Metadata } from 'next';
import { MySkillsScreen } from '@/features/skills/MySkillsScreen';

export const metadata: Metadata = { title: 'Skills' };

export default function Page() {
  return <MySkillsScreen />;
}
