import type { Metadata } from 'next';
import { TutorialScreen } from '@/features/onboarding/TutorialScreen';

export const metadata: Metadata = { title: 'Tutorial' };

export default function Page() {
  return <TutorialScreen />;
}
