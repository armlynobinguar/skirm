import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OG, cut2Points, ogFonts } from './og';

// The link-preview images can't read CSS variables, so lib/og.tsx copies the token values.
// Each OG key and the token it copies:
const TOKEN: Record<keyof typeof OG, string> = {
  bg: '--bg',
  panel: '--panel-solid',
  lineStrong: '--line-strong',
  bone: '--bone',
  muted: '--muted',
  you: '--you',
  rival: '--rival',
  amber: '--amber',
  tileFloor: '--tile-floor',
  tileGrid: '--tile-grid',
  tileWall: '--tile-wall',
  tileWater: '--tile-water',
  tileBlock: '--tile-block',
  tileAgent: '--tile-agent',
  tileAgentMark: '--tile-agent-mark',
};

const css = readFileSync(join(__dirname, '../../../../packages/ui/src/styles/tokens.css'), 'utf8');
function token(name: string): string | undefined {
  return new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(css)?.[1]?.trim();
}

describe('share image colours', () => {
  it.each(Object.entries(TOKEN))('OG.%s matches %s in tokens.css', (key, name) => {
    expect(OG[key as keyof typeof OG]).toBe(token(name));
  });
});

describe('cut2Points', () => {
  it('cuts the top right and bottom left corners, like --clip-cut2', () => {
    expect(cut2Points(200, 100)).toBe('0,0 186,0 200,14 200,100 14,100 0,86');
    expect(cut2Points(40, 30, 10)).toBe('0,0 30,0 40,10 40,30 10,30 0,20');
  });
});

describe('ogFonts', () => {
  it('loads the display, body and mono faces from public/fonts/og', async () => {
    const fonts = await ogFonts();
    expect(fonts.map((f) => `${f.name} ${f.weight}`)).toEqual([
      'Saira Condensed 800',
      'Barlow 400',
      'Barlow 600',
      'JetBrains Mono 500',
    ]);
    for (const f of fonts) expect(f.data.byteLength).toBeGreaterThan(1000);
  });
});
