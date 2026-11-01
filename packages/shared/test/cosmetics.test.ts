import { describe, expect, it } from 'vitest';
import {
  COSMETICS,
  FREE_HAIR_COUNT,
  FREE_OUTFIT_COUNT,
  HAIR_COLORS,
  OUTFIT_COLORS,
  SKIN_TONES,
  cosmeticById,
  cosmeticColor,
  defaultAppearance,
  premiumItemsIn,
} from '../src/index';

describe('premium cosmetics', () => {
  it('lists every premium palette index once, at 40-100 credits', () => {
    const indices = (kind: 'outfit' | 'hair') =>
      COSMETICS.filter((c) => c.kind === kind)
        .map((c) => c.index)
        .sort((a, b) => a - b);
    const range = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => from + i);
    expect(indices('outfit')).toEqual(range(FREE_OUTFIT_COUNT, OUTFIT_COLORS.length));
    expect(indices('hair')).toEqual(range(FREE_HAIR_COUNT, HAIR_COLORS.length));
    expect(COSMETICS).toHaveLength(5);
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    for (const c of COSMETICS) {
      expect(c.priceCredits).toBeGreaterThanOrEqual(40);
      expect(c.priceCredits).toBeLessThanOrEqual(100);
      expect(cosmeticColor(c)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(SKIN_TONES).toHaveLength(6); // skin tones are never premium
    expect(Object.isFrozen(COSMETICS) && Object.isFrozen(COSMETICS[0])).toBe(true);
  });

  it('finds the premium items a look uses', () => {
    const look = defaultAppearance('agt_1');
    expect(premiumItemsIn(look)).toEqual([]);
    expect(premiumItemsIn({ ...look, outfit: FREE_OUTFIT_COUNT })).toEqual(['outfit_gold']);
    expect(
      premiumItemsIn({ ...look, outfit: FREE_OUTFIT_COUNT + 2, hairColor: FREE_HAIR_COUNT + 1 }),
    ).toEqual(['outfit_neon', 'hair_violet']);
    expect(
      premiumItemsIn({ ...look, outfit: FREE_OUTFIT_COUNT - 1, hairColor: FREE_HAIR_COUNT - 1 }),
    ).toEqual([]);
    expect(cosmeticById('hair_platinum')).toMatchObject({ kind: 'hair', index: FREE_HAIR_COUNT });
    expect(cosmeticById('nope')).toBeUndefined();
  });
});
