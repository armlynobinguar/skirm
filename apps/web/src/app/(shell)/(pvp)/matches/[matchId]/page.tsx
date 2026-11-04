import type { Metadata } from 'next';
import { TutorialCoach } from '@/features/onboarding/TutorialCoach';
import { V2MatchScreen } from '@/features/v2/V2MatchScreen';

export const metadata: Metadata = { title: 'Live match' };

export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return (
    <>
      <V2MatchScreen matchId={matchId} />
      <TutorialCoach matchId={matchId} />
    </>
  );
}
