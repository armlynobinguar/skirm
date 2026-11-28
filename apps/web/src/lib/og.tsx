// Shared pieces of the link-preview images (app/opengraph-image.tsx and the shared replay's), drawn
// in the Tactical HUD (B) look: two-corner cut panels, the app's three typefaces, the dark tokens.
// next/og renders with Satori, which has no CSS variables or calc(), so the token values are written
// out here (og.test.ts checks them against @skirm/ui tokens.css) and each cut is an SVG polygon.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CSSProperties, ReactNode } from 'react';

/** Values of the @skirm/ui tokens of the same name. */
export const OG = {
  bg: '#07090d',
  panel: '#0c141d',
  lineStrong: 'rgba(140, 175, 200, 0.38)',
  bone: '#ece8e1',
  muted: '#93a4b1',
  you: '#34e0c8',
  rival: '#ff4655',
  amber: '#ffb547',
  tileFloor: '#1c2321',
  tileGrid: '#2a3330',
  tileWall: '#5a625d',
  tileWater: '#3b8fe8',
  tileBlock: '#a3aca7',
  tileAgent: '#f4efe2',
  tileAgentMark: '#121614',
} as const;

/** The teal glow behind every screen (the --glow token). */
export const OG_GLOW =
  'radial-gradient(ellipse 70% 60% at 72% 18%, rgba(52, 224, 200, .11), transparent 70%), radial-gradient(ellipse 50% 50% at 10% 100%, rgba(52, 224, 200, .05), transparent 70%)';

export const FONT = { display: 'Saira Condensed', sans: 'Barlow', mono: 'JetBrains Mono' } as const;

// Latin subsets (Fontsource, SIL Open Font License) of the typefaces in tokens.css, kept in public/
// so the standalone server ships them; its working directory is apps/web, like `next dev`'s.
const FONT_FILES = [
  { name: FONT.display, file: 'saira-condensed-latin-800-normal.woff', weight: 800 },
  { name: FONT.sans, file: 'barlow-latin-400-normal.woff', weight: 400 },
  { name: FONT.sans, file: 'barlow-latin-600-normal.woff', weight: 600 },
  { name: FONT.mono, file: 'jetbrains-mono-latin-500-normal.woff', weight: 500 },
] as const;

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 800; style: 'normal' };
let fonts: Promise<OgFont[]> | undefined;

/** The fonts option for ImageResponse, read once. */
export function ogFonts(): Promise<OgFont[]> {
  fonts ??= Promise.all(
    FONT_FILES.map(async ({ name, file, weight }) => {
      const buf = await readFile(join(process.cwd(), 'public', 'fonts', 'og', file));
      const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      return { name, data, weight, style: 'normal' as const };
    }),
  );
  return fonts;
}

/** The logo mark, as app/icon.svg draws it. */
export function OgMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect width={24} height={24} fill={OG.tileFloor} />
      <path d="M1 6V1h5M18 1h5v5" stroke={OG.you} strokeWidth={1.5} fill="none" />
      <circle cx={12} cy={13} r={8} fill={OG.tileAgent} />
      <path
        d="M8.4 10.4 10.8 12.8 8.4 15.2M12.6 15.6h3.6"
        stroke={OG.tileAgentMark}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** The mono kicker line above a heading (.sk-kick). */
export function OgKick({ children, color = OG.muted }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        fontFamily: FONT.mono,
        fontWeight: 500,
        fontSize: 22,
        letterSpacing: 5,
        textTransform: 'uppercase',
        color,
      }}
    >
      {children}
    </div>
  );
}

/** The corners of a w by h box cut at the top right and bottom left, as SVG polygon points. */
export function cut2Points(w: number, h: number, c = 14): string {
  return `0,0 ${w - c},0 ${w},${c} ${w},${h} ${c},${h} 0,${h - c}`;
}

/**
 * A cut panel (.sk-panel): the solid panel colour, a 1px line around it, and an optional 4px top
 * stripe (.is-you / .is-rival). Satori's clip-path doesn't clip children, so the shape is an SVG
 * drawn behind the content.
 */
export function OgPanel({
  w,
  h,
  stripe,
  children,
  style,
}: {
  w: number;
  h: number;
  stripe?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const c = 14;
  return (
    <div style={{ display: 'flex', position: 'relative', width: w, height: h, ...style }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <polygon
          points={cut2Points(w - 1, h - 1, c)}
          transform="translate(.5 .5)"
          fill={OG.panel}
          stroke={OG.lineStrong}
          strokeWidth={1}
        />
        {stripe ? <polygon points={`0,0 ${w - c},0 ${w - c + 4},4 0,4`} fill={stripe} /> : null}
      </svg>
      {children}
    </div>
  );
}
