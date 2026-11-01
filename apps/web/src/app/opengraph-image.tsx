// The link-preview image (Open Graph; X falls back to it) for every page: logo, pitch, and a small
// flooded board. Rendered at build time by next/og; colours are the dark tokens
// (@skirm/ui tokens.css), written out because the renderer has no CSS variables.
import { ImageResponse } from 'next/og';

export const alt = 'skirm: your crew plays the match. You write how.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const C = {
  bg: '#05080d',
  ink: '#ece8e1',
  muted: '#93a4b1',
  floor: '#1c2321',
  grid: '#2a3330',
  wall: '#5a625d',
  water: '#3b8fe8',
  block: '#a3aca7',
  agent: '#f4efe2',
  agentMark: '#121614',
  mark: '#34e0c8',
};

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
const TILE = 32;
const FILL: Record<string, string> = { '#': C.wall, '~': C.water, '=': C.block };

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect width={24} height={24} rx={3} fill={C.floor} />
      <path d="M1 6V1h5M18 1h5v5" stroke={C.mark} strokeWidth={1.5} fill="none" />
      <circle cx={12} cy={13} r={8} fill={C.agent} />
      <path
        d="M8.4 10.4 10.8 12.8 8.4 15.2M12.6 15.6h3.6"
        stroke={C.agentMark}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: C.bg,
        padding: 64,
        gap: 56,
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
          <Mark size={64} />
          <div style={{ fontSize: 56, fontWeight: 700, color: C.ink, letterSpacing: -1 }}>
            skirm
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 54,
              fontWeight: 700,
              color: C.ink,
              lineHeight: 1.08,
              letterSpacing: -1.5,
            }}
          >
            Your crew plays the match. You write how.
          </div>
          <div style={{ fontSize: 28, color: C.muted, lineHeight: 1.35 }}>
            Write prompt skills, field a crew of AI agents, and race a rival crew to the goal.
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: C.mark }}>playskirm.xyz</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: `2px solid ${C.grid}`,
            borderRadius: 8,
          }}
        >
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
                    background: FILL[t] ?? C.floor,
                    border: `1px solid ${C.bg}`,
                  }}
                >
                  {t === 'A' ? (
                    <div style={{ width: 24, height: 24, borderRadius: 12, background: C.agent }} />
                  ) : t === '=' ? (
                    <div
                      style={{ width: TILE - 6, height: TILE - 6, border: `3px solid ${C.mark}` }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    size,
  );
}
