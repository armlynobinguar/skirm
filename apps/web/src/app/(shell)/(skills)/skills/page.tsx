import type { Metadata } from 'next';
import { MySkillsScreen } from '@/features/skills/MySkillsScreen';

export const metadata: Metadata = { title: 'My skills' };

export default function Page() {
  return <MySkillsScreen />;
}
