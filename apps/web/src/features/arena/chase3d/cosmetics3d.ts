// What an agent wears, in the 3D chase cam: the same equipped cosmetics the 2D board draws
// (../cosmetics.ts), as plain numbers the scene turns into meshes. The skin's pattern is a ring of
// marks at the agent's feet, the trail a few fading marks on the tiles it just walked, and the
// nameplate the colours of its name tag. The look the figure is built from (role, colours, dress)
// and every equipped item go into one signature: when it changes mid-match the scene rebuilds that figure.
import type { AgentCosmetics, NameplateCosmetic, SkinCosmetic } from '@skirm/shared';
import type { Dress } from '@skirm/ui';
import { plateOf, skinOf } from '../cosmetics';

/** What a figure is built from; a different signature means a rebuilt rig. */
export function rigSignature(
  a: { role?: string; c?: string; bone?: string; dress?: Dress },
  worn: AgentCosmetics | undefined,
): string {
  const d = a.dress;
  return [
    a.role ?? '',
    a.c ?? '',
    a.bone ?? '',
    d ? `${d.hair}/${d.hairColor}/${d.pants}/${d.build}/${d.headgear}` : '',
    worn?.skin ?? '',
    worn?.trail ?? '',
    worn?.nameplate ?? '',
  ].join('|');
}

/** One mark of a skin's pattern ring: its angle round the agent, and its size along and across the ring. */
export interface RingMark {
  angle: number;
  along: number;
  across: number;
}

/** Radius of the pattern ring (tile units), just outside the crew ring. */
export const PATTERN_R = 0.48;

/**
 * The marks of a skin's pattern ring: stripes are long dashes, dots small squares, chevrons a
 * closed run of short marks. Solid skins (and no skin) draw none.
 */
export function patternMarks(skin: Pick<SkinCosmetic, 'pattern'> | undefined): RingMark[] {
  if (!skin || skin.pattern === 'solid') return [];
  const n = skin.pattern === 'stripes' ? 10 : skin.pattern === 'dots' ? 16 : 24;
  const arc = (Math.PI * 2 * PATTERN_R) / n;
  const along = skin.pattern === 'stripes' ? arc * 0.6 : skin.pattern === 'dots' ? 0.045 : arc * 0.95;
  const across = skin.pattern === 'dots' ? 0.045 : 0.035;
  return Array.from({ length: n }, (_, i) => ({ angle: (i / n) * Math.PI * 2, along, across }));
}

/** The name tag colours: the plate's when it wears one, else the default dark tag with a crew stripe. */
export function tagColours(
  worn: AgentCosmetics | undefined,
  crew: string,
): { fg: string; bg: string; stripe: string; border: string | null } {
  const plate: Readonly<NameplateCosmetic> | undefined = plateOf(worn);
  return plate
    ? { fg: plate.fg, bg: plate.bg, stripe: plate.border, border: plate.border }
    : { fg: '#ece8e1', bg: 'rgba(5,8,13,.85)', stripe: crew, border: null };
}

export { skinOf };
