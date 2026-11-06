import { describe, expect, it } from 'vitest';
import { patternMarks, rigSignature, tagColours } from './cosmetics3d';

describe('3D cosmetics', () => {
  it('lays each skin pattern as a ring of marks, none for solid skins', () => {
    expect(patternMarks(undefined)).toEqual([]);
    expect(patternMarks({ pattern: 'solid' })).toEqual([]);
    expect(patternMarks({ pattern: 'stripes' })).toHaveLength(10);
    expect(patternMarks({ pattern: 'dots' })).toHaveLength(16);
    const chevron = patternMarks({ pattern: 'chevron' });
    expect(chevron).toHaveLength(24);
    expect(chevron[1]!.angle).toBeCloseTo((Math.PI * 2) / 24);
  });

  it('colours the tag from the nameplate, else the dark tag with the crew stripe', () => {
    expect(tagColours(undefined, '#34e0c8')).toEqual({ fg: '#ece8e1', bg: 'rgba(5,8,13,.85)', stripe: '#34e0c8', border: null });
    expect(tagColours({ nameplate: 'plate_gold' }, '#34e0c8')).toMatchObject({ fg: '#1a1200', bg: '#d4a537', border: '#fff1b8' });
  });

  it('changes the signature with anything the figure is built from', () => {
    const a = { role: 'Builder', c: '#e2574c', bone: '#d9a477' };
    const base = rigSignature(a, {});
    expect(rigSignature(a, {})).toBe(base);
    expect(rigSignature(a, { trail: 'trail_spark' })).not.toBe(base);
    expect(rigSignature(a, { skin: 'skin_ember' })).not.toBe(base);
    expect(rigSignature({ ...a, dress: { hair: 'bun', hairColor: '#000', pants: '#111', build: 'slim', headgear: 'cap' } }, {})).not.toBe(base);
  });
});
