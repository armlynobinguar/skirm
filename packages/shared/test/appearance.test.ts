import { describe, expect, it } from 'vitest';
import {
  BUILDS,
  FREE_HAIR_COUNT,
  FREE_OUTFIT_COUNT,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_COLORS,
  appearanceOr,
  defaultAppearance,
  isAppearance,
  type AgentAppearance,
} from '../src/appearance';

const look: AgentAppearance = {
  skin: 1,
  hair: 'long',
  hairColor: 2,
  outfit: 3,
  pants: 0,
  build: 'slim',
  headgear: 'role',
};

describe('agent appearance', () => {
  it('gives every agent a valid, stable default that varies between agents', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `agt_${i}`);
    const looks = ids.map(defaultAppearance);
    for (const l of looks) expect(isAppearance(l)).toBe(true);
    expect(defaultAppearance('agt_7')).toEqual(defaultAppearance('agt_7'));
    expect(new Set(looks.map((l) => JSON.stringify(l))).size).toBeGreaterThan(30);
    expect(looks.every((l) => l.hair !== 'none' && l.headgear === 'role')).toBe(true);
    expect(new Set(looks.map((l) => l.build))).toEqual(new Set(BUILDS));
  });

  it('accepts only complete looks with values in range', () => {
    expect(isAppearance(look)).toBe(true);
    for (const hair of HAIR_STYLES) expect(isAppearance({ ...look, hair })).toBe(true);
    expect(isAppearance({ ...look, skin: 6 })).toBe(false);
    expect(isAppearance({ ...look, hairColor: -1 })).toBe(false);
    expect(isAppearance({ ...look, outfit: 1.5 })).toBe(false);
    expect(isAppearance({ ...look, build: 'giant' })).toBe(false);
    expect(isAppearance({ ...look, extra: 1 })).toBe(false);
    const { pants: _pants, ...partial } = look;
    expect(isAppearance(partial)).toBe(false);
    expect(isAppearance(null)).toBe(false);
  });

  it('keeps every default look byte-identical after the premium colours were appended', () => {
    // Pinned from defaultAppearance before the palettes grew (8 outfits, 8 hair colours).
    const pinned: [string, AgentAppearance][] = [
      [
        'agt_01JABCDEF',
        {
          skin: 4,
          hair: 'short',
          hairColor: 4,
          outfit: 7,
          pants: 0,
          build: 'slim',
          headgear: 'role',
        },
      ],
      [
        'agt_starter_0',
        {
          skin: 2,
          hair: 'short',
          hairColor: 4,
          outfit: 7,
          pants: 1,
          build: 'regular',
          headgear: 'role',
        },
      ],
      [
        'agt_7',
        {
          skin: 1,
          hair: 'buzz',
          hairColor: 4,
          outfit: 0,
          pants: 5,
          build: 'sturdy',
          headgear: 'role',
        },
      ],
      [
        'bot_mat_1-0',
        {
          skin: 4,
          hair: 'buzz',
          hairColor: 4,
          outfit: 0,
          pants: 2,
          build: 'sturdy',
          headgear: 'role',
        },
      ],
      [
        'agt_ZZZZZZZZZZZZZZZZZZZZZZZZZZ',
        {
          skin: 4,
          hair: 'bun',
          hairColor: 5,
          outfit: 3,
          pants: 2,
          build: 'slim',
          headgear: 'role',
        },
      ],
      [
        'x',
        {
          skin: 3,
          hair: 'buzz',
          hairColor: 0,
          outfit: 5,
          pants: 4,
          build: 'regular',
          headgear: 'role',
        },
      ],
    ];
    for (const [id, l] of pinned)
      expect(JSON.stringify(defaultAppearance(id))).toBe(JSON.stringify(l));
    for (let i = 0; i < 2000; i++) {
      const l = defaultAppearance(`agt_${i}`);
      expect(l.outfit).toBeLessThan(FREE_OUTFIT_COUNT);
      expect(l.hairColor).toBeLessThan(FREE_HAIR_COUNT - 2);
    }
  });

  it('accepts premium indices so a bought look renders, and nothing past the palettes', () => {
    expect([OUTFIT_COLORS.length, HAIR_COLORS.length]).toEqual([
      FREE_OUTFIT_COUNT + 3,
      FREE_HAIR_COUNT + 2,
    ]);
    expect(
      isAppearance({
        ...look,
        outfit: OUTFIT_COLORS.length - 1,
        hairColor: HAIR_COLORS.length - 1,
      }),
    ).toBe(true);
    expect(isAppearance({ ...look, outfit: OUTFIT_COLORS.length })).toBe(false);
    expect(isAppearance({ ...look, hairColor: HAIR_COLORS.length })).toBe(false);
  });

  it('falls back to the default for a stored value that is not valid', () => {
    expect(appearanceOr(look, 'agt_1')).toEqual(look);
    expect(appearanceOr({ skin: 'x' }, 'agt_1')).toEqual(defaultAppearance('agt_1'));
    expect(appearanceOr(null, 'agt_1')).toEqual(defaultAppearance('agt_1'));
  });
});
