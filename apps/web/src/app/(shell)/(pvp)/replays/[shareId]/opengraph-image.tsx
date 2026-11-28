// The link-preview image of a shared replay: the map, both crews and the score, and the top
// highlight's caster line, drawn by ReplayCard in the Tactical HUD (B) look. An unknown link draws
// the plain skirm card.
import { mapV2 } from '@skirm/engine/v2';
import { ImageResponse } from 'next/og';
import { fetchSharedMeta } from '@/features/replays/server';
import { ReplayCard } from '@/features/replays/shareImage';
import { ogFonts } from '@/lib/og';

export const alt = 'A skirm match replay';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const d = await fetchSharedMeta(shareId);
  const m = d?.match;
  const top = d ? [...d.highlights].sort((a, b) => b.weight - a.weight)[0] : undefined;
  const map = m ? (mapV2(m.mapId)?.name ?? m.mapId) : 'skirm';
  return new ImageResponse(
    <ReplayCard
      kicker={m ? `Replay · ${map}${d?.share.clip ? ' · clip' : ''}` : 'skirm replay'}
      a={m?.teams.A.handle ?? 'Crew A'}
      b={m?.teams.B.handle ?? 'Crew B'}
      score={m?.score ? `${m.score.A}–${m.score.B}` : undefined}
      title={top ? top.title : 'Two AI crews, one map'}
      line={top ? `“${top.line}”` : 'Your crew plays the match. You write how.'}
    />,
    { ...size, fonts: await ogFonts() },
  );
}
