// Premium cosmetics: the palette entries appended after the free ones in appearance.ts. Bought
// with paid credits only (never the free allowance); purely visual, like every appearance field.
import {
  FREE_HAIR_COUNT,
  FREE_OUTFIT_COUNT,
  HAIR_COLORS,
  OUTFIT_COLORS,
  type AgentAppearance,
} from './appearance';

export type CosmeticKind = 'outfit' | 'hair';

export interface CosmeticItem {
  id: string;
  kind: CosmeticKind;
  name: string;
  /** Index into OUTFIT_COLORS (kind outfit) or HAIR_COLORS (kind hair); at or above the free count. */
  index: number;
  priceCredits: number;
}

const ITEMS: CosmeticItem[] = [
  {
    id: 'outfit_gold',
    kind: 'outfit',
    name: 'Gold outfit',
    index: FREE_OUTFIT_COUNT,
    priceCredits: 100,
  },
  {
    id: 'outfit_obsidian',
    kind: 'outfit',
    name: 'Obsidian outfit',
    index: FREE_OUTFIT_COUNT + 1,
    priceCredits: 60,
  },
  {
    id: 'outfit_neon',
    kind: 'outfit',
    name: 'Neon outfit',
    index: FREE_OUTFIT_COUNT + 2,
    priceCredits: 80,
  },
  {
    id: 'hair_platinum',
    kind: 'hair',
    name: 'Platinum hair',
    index: FREE_HAIR_COUNT,
    priceCredits: 40,
  },
  {
    id: 'hair_violet',
    kind: 'hair',
    name: 'Violet hair',
    index: FREE_HAIR_COUNT + 1,
    priceCredits: 50,
  },
];

/** One entry per premium palette index. */
export const COSMETICS: readonly Readonly<CosmeticItem>[] = Object.freeze(
  ITEMS.map((c) => Object.freeze(c)),
);

/** The color an item applies (for swatches and previews). */
export function cosmeticColor(item: Readonly<CosmeticItem>): string {
  return (item.kind === 'outfit' ? OUTFIT_COLORS : HAIR_COLORS)[item.index]!;
}

export function cosmeticById(id: string): Readonly<CosmeticItem> | undefined {
  return COSMETICS.find((c) => c.id === id);
}

/** Ids of the premium items a look uses (none for a free look). */
export function premiumItemsIn(
  appearance: Pick<AgentAppearance, 'outfit' | 'hairColor'>,
): string[] {
  return COSMETICS.filter(
    (c) => (c.kind === 'outfit' ? appearance.outfit : appearance.hairColor) === c.index,
  ).map((c) => c.id);
}

// ---------- Equippable cosmetics: agent skins, trails and nameplates ----------
// One item per slot can be equipped on each agent. They change how the agent is drawn in the
// arena only (body palette and pattern, a trail behind it, the style of its name tag), never what
// it does: the engine, the decision engines, scoring and the match log never read them. Bought
// like the palette items above (paid credits only, cosmetics_owned); with NEAR_CONTRACT_COSMETICS
// set they are also minted as NEP-245 multi-tokens (contracts/cosmetics), token id = item id.

export const COSMETIC_SLOTS = ['skin', 'trail', 'nameplate'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export const SKIN_PATTERNS = ['solid', 'stripes', 'chevron', 'dots'] as const;
export type SkinPattern = (typeof SKIN_PATTERNS)[number];
export const TRAIL_STYLES = ['dots', 'sparks', 'ribbon'] as const;
export type TrailStyle = (typeof TRAIL_STYLES)[number];

interface EquipBase {
  id: string;
  name: string;
  /** One line for the shop. */
  blurb: string;
  priceCredits: number;
}
/** An agent skin: the body colour, a second colour and the pattern it is laid in. */
export interface SkinCosmetic extends EquipBase {
  kind: 'skin';
  body: string;
  accent: string;
  pattern: SkinPattern;
}
/** A trail left on the tiles an agent just walked. */
export interface TrailCosmetic extends EquipBase {
  kind: 'trail';
  color: string;
  style: TrailStyle;
}
/** A name tag style: text, plate and border colours. */
export interface NameplateCosmetic extends EquipBase {
  kind: 'nameplate';
  fg: string;
  bg: string;
  border: string;
}
export type EquipCosmetic = SkinCosmetic | TrailCosmetic | NameplateCosmetic;

/** Equipped item ids per slot (absent: the default look for that slot). */
export type AgentCosmetics = Partial<Record<CosmeticSlot, string>>;

const EQUIP: EquipCosmetic[] = [
  {
    id: 'skin_ember',
    kind: 'skin',
    name: 'Ember skin',
    blurb: 'Hot orange with gold stripes.',
    priceCredits: 90,
    body: '#ff6a3d',
    accent: '#ffd166',
    pattern: 'stripes',
  },
  {
    id: 'skin_glacier',
    kind: 'skin',
    name: 'Glacier skin',
    blurb: 'Ice blue with white chevrons.',
    priceCredits: 90,
    body: '#6cc4ff',
    accent: '#eaf7ff',
    pattern: 'chevron',
  },
  {
    id: 'skin_toxic',
    kind: 'skin',
    name: 'Toxic skin',
    blurb: 'Acid green with dark spots.',
    priceCredits: 110,
    body: '#9cff3e',
    accent: '#1d2b12',
    pattern: 'dots',
  },
  {
    id: 'trail_spark',
    kind: 'trail',
    name: 'Spark trail',
    blurb: 'Gold sparks on every step.',
    priceCredits: 70,
    color: '#ffd166',
    style: 'sparks',
  },
  {
    id: 'trail_ripple',
    kind: 'trail',
    name: 'Ripple trail',
    blurb: 'Cyan footprints that fade.',
    priceCredits: 60,
    color: '#5ad7ff',
    style: 'dots',
  },
  {
    id: 'trail_comet',
    kind: 'trail',
    name: 'Comet trail',
    blurb: 'A violet ribbon behind the agent.',
    priceCredits: 100,
    color: '#b28bff',
    style: 'ribbon',
  },
  {
    id: 'plate_gold',
    kind: 'nameplate',
    name: 'Gold nameplate',
    blurb: 'Dark text on a gold plate.',
    priceCredits: 80,
    fg: '#1a1200',
    bg: '#d4a537',
    border: '#fff1b8',
  },
  {
    id: 'plate_holo',
    kind: 'nameplate',
    name: 'Holo nameplate',
    blurb: 'Cyan glow on deep blue.',
    priceCredits: 70,
    fg: '#e8fbff',
    bg: '#12324a',
    border: '#5ad7ff',
  },
];

/** Equippable items (skins, trails, nameplates), one shop entry each. */
export const EQUIP_COSMETICS: readonly Readonly<EquipCosmetic>[] = Object.freeze(
  EQUIP.map((c) => Object.freeze(c)),
);

export function equipCosmeticById(id: string): Readonly<EquipCosmetic> | undefined {
  return EQUIP_COSMETICS.find((c) => c.id === id);
}

/** Any shop item, palette or equippable: what the purchase flow prices and grants. */
export function shopItemById(
  id: string,
): Readonly<CosmeticItem> | Readonly<EquipCosmetic> | undefined {
  return cosmeticById(id) ?? equipCosmeticById(id);
}

export function isCosmeticSlot(v: unknown): v is CosmeticSlot {
  return (COSMETIC_SLOTS as readonly unknown[]).includes(v);
}

/** Stored equipment cleaned for rendering: known item ids in the slot they belong to, nothing else. */
export function cleanCosmetics(raw: unknown): AgentCosmetics {
  const out: AgentCosmetics = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const slot of COSMETIC_SLOTS) {
    const id = (raw as Record<string, unknown>)[slot];
    if (typeof id === 'string' && equipCosmeticById(id)?.kind === slot) out[slot] = id;
  }
  return out;
}

/** NEP-245 metadata `extra` for an item: the schema, its kind and its look (no price). */
export function cosmeticExtra(item: Readonly<EquipCosmetic>): Record<string, unknown> {
  const look: Record<string, unknown> = { ...item };
  for (const k of ['id', 'name', 'blurb', 'priceCredits']) delete look[k];
  return { schema: 'skirm.cosmetic/v0', ...look };
}
