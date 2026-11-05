import { describe, expect, it } from 'vitest';
import { DEFAULTS, levelOf, matchXp, normalizeTraits, progressionOf, traitPickError, traitSlots, xpForLevel } from '../src';

describe('match XP', () => {
  it('pays the kind base, the result bonus and delivered items', () => {
    expect(matchXp({ kind: 'casual', outcome: 'loss', delivered: 0 })).toBe(25);
    expect(matchXp({ kind: 'casual', outcome: 'win', delivered: 3 })).toBe(25 + 20 + 6);
    expect(matchXp({ kind: 'ranked', outcome: 'draw', delivered: 1 })).toBe(40 + 10 + 2);
  });

  it('counts at most maxDelivered items and never a negative count', () => {
    expect(matchXp({ kind: 'ranked', outcome: 'loss', delivered: 50 })).toBe(40 + DEFAULTS.progression.xp.maxDelivered * 2);
    expect(matchXp({ kind: 'ranked', outcome: 'loss', delivered: -4 })).toBe(40);
  });

  it('gives practice against the bot nothing', () => {
    expect(matchXp({ kind: 'practice', outcome: 'win', delivered: 8 })).toBe(0);
  });
});

describe('levels', () => {
  it('follows the curve base + step × (L − 1)', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(250);
    expect(xpForLevel(6)).toBe(1000);
  });

  it('reaches a level at its threshold, not one XP before', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(99)).toBe(1);
    expect(levelOf(100)).toBe(2);
    expect(levelOf(249)).toBe(2);
    expect(levelOf(250)).toBe(3);
  });

  it('stops at maxLevel', () => {
    const top = DEFAULTS.progression.maxLevel;
    expect(levelOf(10_000_000)).toBe(top);
    expect(progressionOf(10_000_000, []).nextLevelXp).toBeNull();
  });

  it('earns trait picks at the trait levels', () => {
    expect(traitSlots(2)).toBe(0);
    expect(traitSlots(3)).toBe(1);
    expect(traitSlots(5)).toBe(1);
    expect(traitSlots(6)).toBe(2);
    expect(traitSlots(10)).toBe(DEFAULTS.progression.maxTraits);
  });
});

describe('traits', () => {
  it('normalises to known ids, once each, in catalogue order, capped', () => {
    expect(normalizeTraits(['steady', 'keen', 'keen', 'nope', 3])).toEqual(['keen', 'steady']);
    expect(normalizeTraits(['strong', 'quick', 'calm', 'keen'])).toHaveLength(DEFAULTS.progression.maxTraits);
    expect(normalizeTraits(null)).toEqual([]);
  });

  it('allows a pick only into a free slot and never twice', () => {
    const lvl2 = progressionOf(xpForLevel(2), []);
    expect(traitPickError(lvl2, 'keen')).toMatch(/level 3/);
    const lvl3 = progressionOf(xpForLevel(3), []);
    expect(traitPickError(lvl3, 'keen')).toBeNull();
    const taken = progressionOf(xpForLevel(3), ['keen']);
    expect(traitPickError(taken, 'keen')).toMatch(/already/);
    expect(traitPickError(taken, 'calm')).toMatch(/level 6/);
    const full = progressionOf(xpForLevel(10), ['keen', 'calm']);
    expect(traitPickError(full, 'quick')).toMatch(/at most 2/);
  });
});
