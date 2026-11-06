import { describe, expect, it } from 'vitest';
import {
  COSMETICS,
  COSMETIC_SLOTS,
  EQUIP_COSMETICS,
  FREE_HAIR_COUNT,
  FREE_OUTFIT_COUNT,
  HAIR_COLORS,
  OUTFIT_COLORS,
  SKIN_TONES,
  cosmeticById,
  cleanCosmetics,
  cosmeticColor,
  cosmeticExtra,
  defaultAppearance,
  equipCosmeticById,
  isCosmeticSlot,
  premiumItemsIn,
  shopItemById,
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

describe('equippable cosmetics (skins, trails, nameplates)', () => {
  it('has unique ids that never clash with the palette items, valid colours and slots', () => {
    const ids = EQUIP_COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(cosmeticById(id)).toBeUndefined();
    for (const slot of COSMETIC_SLOTS)
      expect(EQUIP_COSMETICS.some((c) => c.kind === slot)).toBe(true);
    const hex = /^#[0-9a-f]{6}$/;
    for (const c of EQUIP_COSMETICS) {
      // NEP-245 token ids on the cosmetics contract: 1-64 of a-z, 0-9, _.
      expect(c.id).toMatch(/^[a-z0-9_]{1,64}$/);
      expect(c.priceCredits).toBeGreaterThan(0);
      const colours =
        c.kind === 'skin' ? [c.body, c.accent] : c.kind === 'trail' ? [c.color] : [c.fg, c.bg, c.border];
      for (const col of colours) expect(col).toMatch(hex);
    }
    expect(Object.isFrozen(EQUIP_COSMETICS) && Object.isFrozen(EQUIP_COSMETICS[0])).toBe(true);
  });

  it('finds any shop item and cleans stored equipment', () => {
    expect(shopItemById('outfit_gold')).toMatchObject({ kind: 'outfit' });
    expect(shopItemById('skin_ember')).toMatchObject({ kind: 'skin' });
    expect(shopItemById('nope')).toBeUndefined();
    expect(equipCosmeticById('trail_spark')?.kind).toBe('trail');
    expect(isCosmeticSlot('nameplate')).toBe(true);
    expect(isCosmeticSlot('hat')).toBe(false);
    expect(
      cleanCosmetics({ skin: 'skin_ember', trail: 'skin_glacier', nameplate: 'nope', hat: 'x' }),
    ).toEqual({ skin: 'skin_ember' });
    expect(cleanCosmetics(null)).toEqual({});
  });

  it('builds the NEP-245 extra without the price', () => {
    expect(cosmeticExtra(equipCosmeticById('plate_gold')!)).toEqual({
      schema: 'skirm.cosmetic/v0',
      kind: 'nameplate',
      fg: '#1a1200',
      bg: '#d4a537',
      border: '#fff1b8',
    });
  });
});
