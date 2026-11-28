// The link-preview card of a shared replay (app/(shell)/(pvp)/replays/[shareId]/opengraph-image.tsx):
// both crews in cut panels with the score between them, and the top highlight's caster line, in the
// Tactical HUD (B) look. Only Satori-safe styles (flexbox, no CSS variables); see lib/og.tsx.
import { FONT, OG, OG_GLOW, OgKick, OgMark, OgPanel } from '@/lib/og';

export interface ReplayCardProps {
  /** "Replay · Map name · clip", or the plain kicker for an unknown link. */
  kicker: string;
  a: string;
  b: string;
  /** "3–1", or undefined before a score exists ("vs" is drawn). */
  score?: string;
  title: string;
  line: string;
}

const CREW_W = 420;
const CREW_H = 168;

function Crew({ side, name }: { side: 'A' | 'B'; name: string }) {
  const color = side === 'A' ? OG.you : OG.rival;
  return (
    <OgPanel
      w={CREW_W}
      h={CREW_H}
      stripe={color}
      style={{ flexDirection: 'column', justifyContent: 'center', gap: 10, padding: '20px 28px' }}
    >
      <OgKick color={color}>{side === 'A' ? 'Crew A' : 'Crew B'}</OgKick>
      <div
        style={{
          display: 'block',
          fontFamily: FONT.display,
          fontWeight: 800,
          fontSize: name.length > 14 ? 44 : 62,
          lineHeight: 1,
          textTransform: 'uppercase',
          color: OG.bone,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          maxWidth: CREW_W - 56,
        }}
      >
        {name}
      </div>
    </OgPanel>
  );
}

export function ReplayCard({ kicker, a, b, score, title, line }: ReplayCardProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        backgroundColor: OG.bg,
        backgroundImage: OG_GLOW,
        padding: '48px 56px 60px',
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <OgMark size={44} />
          <div
            style={{
              display: 'flex',
              fontFamily: FONT.display,
              fontWeight: 800,
              fontSize: 46,
              lineHeight: 1,
              textTransform: 'uppercase',
              color: OG.bone,
            }}
          >
            skirm
          </div>
        </div>
        <OgKick>{kicker}</OgKick>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Crew side="A" name={a} />
        <div
          style={{
            display: 'flex',
            fontFamily: FONT.display,
            fontWeight: 800,
            fontSize: score ? 132 : 96,
            lineHeight: 1,
            color: score ? OG.bone : OG.amber,
            textTransform: 'uppercase',
          }}
        >
          {score ?? 'vs'}
        </div>
        <Crew side="B" name={b} />
      </div>
      <OgPanel
        w={1088}
        h={150}
        style={{
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 10,
          padding: '18px 28px 18px 34px',
        }}
      >
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: 0,
            top: 14,
            bottom: 14,
            width: 4,
            background: OG.amber,
          }}
        />
        <OgKick color={OG.amber}>{title}</OgKick>
        <div
          style={{
            display: 'block',
            fontSize: 34,
            lineHeight: 1.3,
            fontWeight: 600,
            color: OG.bone,
            lineClamp: 2,
          }}
        >
          {line}
        </div>
      </OgPanel>
      <div
        style={{
          display: 'flex',
          fontFamily: FONT.mono,
          fontWeight: 500,
          fontSize: 22,
          letterSpacing: 2,
          color: OG.you,
        }}
      >
        playskirm.xyz
      </div>
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 10,
          backgroundImage: `repeating-linear-gradient(-45deg, ${OG.amber} 0 8px, transparent 8px 16px)`,
        }}
      />
    </div>
  );
}
