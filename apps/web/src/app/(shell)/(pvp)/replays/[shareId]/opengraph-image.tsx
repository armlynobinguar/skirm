// The link-preview image of a shared replay: the map, both crews and the score, and the top
// highlight's caster line. Colours are the dark tokens (as in app/opengraph-image.tsx), written out
// because the renderer has no CSS variables. An unknown link draws the plain skirm card.
import { mapV2 } from '@skirm/engine/v2';
import { ImageResponse } from 'next/og';
import { fetchSharedMeta } from '@/features/replays/server';

export const alt = 'A skirm match replay';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const C = { bg: '#05080d', ink: '#ece8e1', muted: '#93a4b1', you: '#34e0c8', rival: '#ff6b5b', amber: '#f2b84b', line: '#2a3330' };

export default async function Image({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const d = await fetchSharedMeta(shareId);
  const m = d?.match;
  const top = d ? [...d.highlights].sort((a, b) => b.weight - a.weight)[0] : undefined;
  const a = m?.teams.A.handle ?? 'Crew A';
  const b = m?.teams.B.handle ?? 'Crew B';
  const map = m ? (mapV2(m.mapId)?.name ?? m.mapId) : 'skirm';
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: C.bg, padding: 64 }}>
      <div style={{ display: 'flex', fontSize: 30, color: C.muted, letterSpacing: 2, textTransform: 'uppercase' }}>
        {m ? `Replay · ${map}${d?.share.clip ? ' · clip' : ''}` : 'skirm replay'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, color: C.you }}>{a}</div>
        <div style={{ display: 'flex', fontSize: 120, fontWeight: 800, color: C.ink }}>{m?.score ? `${m.score.A}–${m.score.B}` : 'vs'}</div>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, color: C.rival }}>{b}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderLeft: `6px solid ${C.amber}`, paddingLeft: 24 }}>
        <div style={{ display: 'flex', fontSize: 30, color: C.amber, textTransform: 'uppercase' }}>{top ? top.title : 'Two AI crews, one map'}</div>
        <div style={{ display: 'flex', fontSize: 40, color: C.ink }}>{top ? `“${top.line}”` : 'Your crew plays the match. You write how.'}</div>
      </div>
      <div style={{ display: 'flex', fontSize: 26, color: C.you }}>playskirm.xyz</div>
    </div>,
    size,
  );
}
