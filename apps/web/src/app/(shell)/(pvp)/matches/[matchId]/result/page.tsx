import type { Metadata } from 'next';
import { TutorialCoach } from '@/features/onboarding/TutorialCoach';
import { V2ResultScreen } from '@/features/v2/Ended';

export const metadata: Metadata = { title: 'Match result' };

export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return (
    <>
      <V2ResultScreen matchId={matchId} />
      <TutorialCoach matchId={matchId} ended />
    </>
  );
}
