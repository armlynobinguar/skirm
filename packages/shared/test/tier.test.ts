import { describe, expect, it } from 'vitest';
import { DEFAULTS, RANKED_TIERS, decayFloorElo, decayedElo, kFactor, playerTier, tierOf } from '../src/index';

describe('ranked tiers', () => {
  it('six tiers from Bronze to Master, floors rising', () => {
    expect(RANKED_TIERS.map((t) => t.name)).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master']);
    for (let i = 1; i < RANKED_TIERS.length; i++) expect(RANKED_TIERS[i]!.min).toBeGreaterThan(RANKED_TIERS[i - 1]!.min);
    expect(RANKED_TIERS[0]!.min).toBeLessThanOrEqual(DEFAULTS.elo.floor);
  });

  it('maps Elo to a tier at the thresholds', () => {
    expect(tierOf(100)).toEqual({ name: 'Bronze', min: 0, next: 'Silver', nextAt: 1100 });
    expect(tierOf(1099).name).toBe('Bronze');
    expect(tierOf(1100).name).toBe('Silver');
    expect(tierOf(DEFAULTS.elo.start).name).toBe('Silver');
    expect(tierOf(1300).name).toBe('Gold');
    expect(tierOf(1500).name).toBe('Platinum');
    expect(tierOf(1700).name).toBe('Diamond');
    expect(tierOf(2600)).toEqual({ name: 'Master', min: 1900, next: null, nextAt: null });
  });

  it('hides the tier until the placement matches are played', () => {
    expect(playerTier(1400, 0)).toEqual({ tier: null, placementsPlayed: 0, placementMatches: 5, nextAt: null });
    expect(playerTier(1400, 4).tier).toBeNull();
    expect(playerTier(1400, 5)).toEqual({ tier: 'Gold', placementsPlayed: 5, placementMatches: 5, nextAt: 1500 });
    expect(playerTier(1400, 40).placementsPlayed).toBe(5);
  });

  it('placement matches play with the larger K', () => {
    expect(kFactor(0)).toBe(DEFAULTS.elo.kPlacement);
    expect(kFactor(4)).toBe(48);
    expect(kFactor(5)).toBe(32);
    expect(kFactor(20)).toBe(16);
  });
});

describe('Elo decay', () => {
  it('applies from Diamond up, never below the tier floor', () => {
    expect(decayFloorElo()).toBe(1700);
    expect(decayedElo(1699, 30)).toBe(1699);
    expect(decayedElo(1760, 30)).toBe(1735);
    expect(decayedElo(1710, 30)).toBe(1700);
    expect(decayedElo(1700, 30)).toBe(1700);
    expect(decayedElo(1910, 30)).toBe(1900);
    expect(decayedElo(2100, 30, 50)).toBe(2050);
  });

  it('leaves players still placing alone', () => {
    expect(decayedElo(1900, 3)).toBe(1900);
  });
});
