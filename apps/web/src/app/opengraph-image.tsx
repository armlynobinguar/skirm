// The link-preview image (Open Graph; X falls back to it) for every page: logo, pitch, and a small
// flooded board, in the Tactical HUD (B) look. Rendered at build time by next/og; the shared colours,
// fonts and cut panel are in lib/og.tsx.
import { ImageResponse } from 'next/og';
import { FONT, OG, OG_GLOW, OgKick, OgMark, OgPanel, ogFonts } from '@/lib/og';

export const alt = 'skirm: your crew plays the match. You write how.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// A flooded board, its gap sealed: # wall, ~ water, = placed block, A agent.
const MAP = [
  '###############',
  '#~~~~~~~~~~~~~#',
  '#######~#######',
  '#.....#~#.....#',
  '#.....#=#.....#',
  '#.............#',
  '#.............#',
  '#.A...........#',
  '###############',
];
const TILE = 30;
const FILL: Record<string, string> = { '#': OG.tileWall, '~': OG.tileWater, '=': OG.tileBlock };
const BOARD_W = MAP[0]!.length * TILE;
const BOARD_H = MAP.length * TILE;

function Board() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: OG.tileGrid, padding: 1 }}>
      {MAP.map((row, y) => (
        <div key={y} style={{ display: 'flex' }}>
          {row.split('').map((t, x) => (
            <div
              key={x}
              style={{
                width: TILE,
                height: TILE,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: FILL[t] ?? OG.tileFloor,
                border: `1px solid ${OG.tileGrid}`,
              }}
            >
              {t === 'A' ? (
                <div
                  style={{ width: 22, height: 22, borderRadius: 11, background: OG.tileAgent }}
                />
              ) : t === '=' ? (
                <div style={{ width: TILE - 8, height: TILE - 8, border: `3px solid ${OG.you}` }} />
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default async function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        backgroundColor: OG.bg,
        backgroundImage: OG_GLOW,
        padding: '56px 56px 64px',
        gap: 48,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flex: 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <OgMark size={56} />
          <div
            style={{
              display: 'flex',
              fontFamily: FONT.display,
              fontWeight: 800,
              fontSize: 60,
              lineHeight: 1,
              textTransform: 'uppercase',
              color: OG.bone,
            }}
          >
            skirm
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <OgKick>
            <span style={{ color: OG.you }}>Crew</span>
            <span>&nbsp;vs&nbsp;</span>
            <span style={{ color: OG.rival }}>crew</span>
            <span>&nbsp;· prompt skills</span>
          </OgKick>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontFamily: FONT.display,
              fontWeight: 800,
              fontSize: 76,
              lineHeight: 0.92,
              textTransform: 'uppercase',
              color: OG.bone,
            }}
          >
            <span>Your crew plays the match.</span>
            <span style={{ color: OG.you }}>You write how.</span>
          </div>
          <div style={{ display: 'flex', fontSize: 27, lineHeight: 1.35, color: OG.muted }}>
            Write prompt skills, field a crew of AI agents, and race a rival crew to the goal.
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: FONT.mono,
            fontWeight: 500,
            fontSize: 24,
            letterSpacing: 2,
            color: OG.you,
          }}
        >
          playskirm.xyz
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <OgPanel
          w={BOARD_W + 44}
          h={BOARD_H + 100}
          stripe={OG.you}
          style={{ flexDirection: 'column', gap: 18, padding: '26px 20px 20px' }}
        >
          <OgKick>
            <span style={{ color: OG.you }}>Board</span>
            <span>&nbsp;· gap sealed</span>
          </OgKick>
          <Board />
        </OgPanel>
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
    </div>,
    { ...size, fonts: await ogFonts() },
  );
}
