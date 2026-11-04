import { describe, expect, it } from 'vitest';
import {
  TOURNAMENT,
  bracketRounds,
  forcedTier,
  isLobbyCode,
  lobbyCodeFrom,
  nextMatch,
  placeOfLoser,
  roundMatches,
  seedOrder,
  tournamentPayouts,
} from '../src/index';

describe('tournament brackets', () => {
  it('seeds so 1 and 2 can only meet in the final', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const s16 = seedOrder(16);
    expect(new Set(s16).size).toBe(16);
    // Every first-round pair adds up to 17, and seed 2 sits in the other half from seed 1.
    for (let i = 0; i < 16; i += 2) expect(s16[i]! + s16[i + 1]!).toBe(17);
    expect(s16.indexOf(2)).toBeGreaterThanOrEqual(8);
  });

  it('rounds, matches per round, where a winner goes next and loser places', () => {
    expect([4, 8, 16].map(bracketRounds)).toEqual([2, 3, 4]);
    expect([1, 2, 3].map((r) => roundMatches(8, r))).toEqual([4, 2, 1]);
    expect(nextMatch(1, 0)).toEqual({ round: 2, slot: 0, side: 'host' });
    expect(nextMatch(1, 3)).toEqual({ round: 2, slot: 1, side: 'guest' });
    expect(placeOfLoser(8, 3)).toBe(2);
    expect(placeOfLoser(8, 2)).toBe(3);
    expect(placeOfLoser(8, 1)).toBe(5);
  });

  it('splits the prize pool 60/25/7.5/7.5 with the dust to the champion', () => {
    expect(TOURNAMENT.splitBps.reduce((a, b) => a + b, 0)).toBe(10_000);
    const finishers = [
      { accountId: 'c', place: 3 },
      { accountId: 'a', place: 1 },
      { accountId: 'd', place: 3 },
      { accountId: 'b', place: 2 },
      { accountId: 'e', place: 5 },
    ];
    const out = tournamentPayouts(1001, finishers);
    expect(out).toEqual([
      { accountId: 'a', place: 1, credits: 600 + 1 },
      { accountId: 'b', place: 2, credits: 250 },
      { accountId: 'c', place: 3, credits: 75 },
      { accountId: 'd', place: 3, credits: 75 },
    ]);
    expect(out.reduce((n, p) => n + p.credits, 0)).toBe(1001);
    expect(tournamentPayouts(0, finishers)).toEqual([]);
    expect(() => tournamentPayouts(-1, finishers)).toThrow();
  });

  it('share codes and talk rules', () => {
    const code = lobbyCodeFrom(new Uint8Array([0, 1, 2, 3, 4, 250]));
    expect(code).toHaveLength(6);
    expect(isLobbyCode(code)).toBe(true);
    expect(isLobbyCode('ABC0EF')).toBe(false);
    expect(forcedTier('any')).toBeNull();
    expect(forcedTier('open')).toBe('open');
  });
});
