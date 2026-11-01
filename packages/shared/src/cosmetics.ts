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
