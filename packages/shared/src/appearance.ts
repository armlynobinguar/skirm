// Agent appearance: how an agent looks on the 3D board. Purely cosmetic; never read by the engine,
// the decision engines or scoring. Colours are picked from fixed palettes by index, so a stored look
// is a handful of small numbers and every combination renders well.
// Premium colours (cosmetics.ts) are appended after the free entries, so stored indices and every
// default look stay the same; renderers index the full palettes and need no change.

export const SKIN_TONES = [
  '#f6d7b8',
  '#eec39a',
  '#d9a477',
  '#b97f55',
  '#8d5a3b',
  '#5e3b26',
] as const;
export const HAIR_COLORS = [
  '#1f1a17',
  '#3b2a1e',
  '#6b4325',
  '#a56b3c',
  '#d9b26b',
  '#c4c4c4',
  '#b8432f',
  '#3d5a8a',
  // Premium (index ≥ FREE_HAIR_COUNT): platinum, violet.
  '#efe9dc',
  '#7b4fc9',
] as const;
export const OUTFIT_COLORS = [
  '#e2574c',
  '#4c8be2',
  '#e2c14c',
  '#4cae6e',
  '#8a5ad6',
  '#e28a3c',
  '#2f9fa8',
  '#5b6474',
  // Premium (index ≥ FREE_OUTFIT_COUNT): gold, obsidian, neon.
  '#d4a537',
  '#23232e',
  '#3ef08a',
] as const;
/** Outfit colours below this index are free; the rest are premium cosmetics. */
export const FREE_OUTFIT_COUNT = 8;
/** Hair colours below this index are free (the last two free ones are dyes); the rest are premium. */
export const FREE_HAIR_COUNT = 8;
export const PANTS_COLORS = [
  '#3b4252',
  '#5a4632',
  '#2e4a3a',
  '#46566e',
  '#6b6b6b',
  '#1f2430',
] as const;

export const HAIR_STYLES = ['short', 'long', 'bun', 'buzz', 'ponytail', 'none'] as const;
export const BUILDS = ['slim', 'regular', 'sturdy'] as const;
/** `role` shows the gear for the agent's unlock (hard hat, headlamp, helmet); the rest override it. */
export const HEADGEAR = ['role', 'none', 'cap', 'bandana', 'beanie'] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type Build = (typeof BUILDS)[number];
export type Headgear = (typeof HEADGEAR)[number];

export interface AgentAppearance {
  /** Index into SKIN_TONES. */
  skin: number;
  hair: HairStyle;
  /** Index into HAIR_COLORS. */
  hairColor: number;
  /** Index into OUTFIT_COLORS. */
  outfit: number;
  /** Index into PANTS_COLORS. */
  pants: number;
  build: Build;
  headgear: Headgear;
}

/** FNV-1a over the id: a stable 32-bit number per agent. */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The look an agent has until its owner changes it: varied, the same every time for an id, and
 * never premium (picks use the free counts, not the palette lengths).
 */
export function defaultAppearance(agentId: string): AgentAppearance {
  const h = hash(agentId);
  const pick = (n: number, shift: number) => (h >>> shift) % n;
  return {
    skin: pick(SKIN_TONES.length, 0),
    hair: HAIR_STYLES[pick(HAIR_STYLES.length - 1, 4)]!, // never bald by default
    hairColor: pick(FREE_HAIR_COUNT - 2, 8), // natural colours by default
    outfit: pick(FREE_OUTFIT_COUNT, 12),
    pants: pick(PANTS_COLORS.length, 16),
    build: BUILDS[pick(BUILDS.length, 20)]!,
    headgear: 'role',
  };
}

const index = (v: unknown, n: number): number | undefined =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : undefined;
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined =>
  (list as readonly unknown[]).includes(v) ? (v as T) : undefined;

/**
 * Whether `raw` is a complete, valid appearance. The api refuses anything else; stored values that
 * fail fall back to the default through `appearanceOr`. Premium indices are
 * valid here (ownership is the api's check), so a bought look renders.
 */
export function isAppearance(raw: unknown): raw is AgentAppearance {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(',');
  return (
    keys === 'build,hair,hairColor,headgear,outfit,pants,skin' &&
    index(r.skin, SKIN_TONES.length) !== undefined &&
    oneOf(r.hair, HAIR_STYLES) !== undefined &&
    index(r.hairColor, HAIR_COLORS.length) !== undefined &&
    index(r.outfit, OUTFIT_COLORS.length) !== undefined &&
    index(r.pants, PANTS_COLORS.length) !== undefined &&
    oneOf(r.build, BUILDS) !== undefined &&
    oneOf(r.headgear, HEADGEAR) !== undefined
  );
}

/** The stored look when it is valid, else the agent's default. */
export function appearanceOr(raw: unknown, agentId: string): AgentAppearance {
  return isAppearance(raw) ? { ...raw } : defaultAppearance(agentId);
}
