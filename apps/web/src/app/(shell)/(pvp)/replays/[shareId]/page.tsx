import type { Metadata } from 'next';
import { SharedReplayScreen } from '@/features/replays/SharedReplayScreen';
import { fetchSharedMeta } from '@/features/replays/server';
import { sharedSummary } from '@/features/replays/summary';
import { routes } from '@/lib/routes';

// The link preview (Open Graph, X card): the match in one line and its top highlight's caster line.
// The image is ./opengraph-image.tsx. An unknown or ended link keeps the site's own preview.
export async function generateMetadata({ params }: { params: Promise<{ shareId: string }> }): Promise<Metadata> {
  const { shareId } = await params;
  const d = await fetchSharedMeta(shareId);
  if (!d) return { title: 'Shared replay', robots: { index: false } };
  const top = [...d.highlights].sort((a, b) => b.weight - a.weight)[0];
  const title = `Replay: ${sharedSummary(d)}`;
  const description = top ? `${top.title}. “${top.line}”` : 'Watch two AI agent crews race for the goal on skirm.';
  const url = routes.replay(shareId);
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: false },
    openGraph: { type: 'video.other', siteName: 'skirm', title, description, url },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  return <SharedReplayScreen shareId={shareId} />;
}
