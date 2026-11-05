// The daily challenge: one per UTC day from the date alone, its points and the board order.
import { describe, expect, it } from 'vitest';
import {
  DAILY_DIFFICULTIES,
  DAILY_TWISTS,
  DIFF_MODS,
  MAPS_V2,
  PRACTICE_MAPS,
  compareDaily,
  dailyChallenge,
  dailyCrewLimit,
  dailyDate,
  dailyMatchOptions,
  dailyMsLeft,
  dailyPoints,
  isDailyDate,
} from '../src/v2';

const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

describe('dailyChallenge', () => {
  it('is the same challenge for the same date, every time', () => {
    expect(dailyChallenge('2026-11-05')).toEqual(dailyChallenge('2026-11-05'));
    // Pinned: a change to the derivation would move every past board's challenge.
    expect(dailyChallenge('2026-11-05')).toEqual({
      date: '2026-11-05',
      seed: '82f63d5b',
      mapId: 'saltmarsh-weir',
      difficulty: 'agentic',
      twist: 'sly_bot',
      crewSize: 3,
      ticks: 135,
      bot: { tier: 'open', hold: 0, lieCap: 9 },
    });
  });

  it('only picks practice maps, daily difficulties and known twists, within the map crew limit', () => {
    for (const d of days('2026-01-01', 366)) {
      const c = dailyChallenge(d);
      expect(c.date).toBe(d);
      expect(c.seed).toMatch(/^[0-9a-f]{8}$/);
      expect(PRACTICE_MAPS).toContain(c.mapId);
      expect(DAILY_DIFFICULTIES).toContain(c.difficulty);
      expect(Object.keys(DAILY_TWISTS)).toContain(c.twist);
      const map = MAPS_V2.find((m) => m.id === c.mapId)!;
      expect(c.crewSize).toBeGreaterThanOrEqual(1);
      expect(c.crewSize).toBeLessThanOrEqual(dailyCrewLimit(map));
      const clock = DIFF_MODS[c.difficulty].ticks;
      expect(c.ticks).toBe(c.twist === 'short_clock' ? Math.round(clock * 0.8) : clock);
      if (c.twist === 'eager_bot') expect(c.bot.hold).toBe(0);
    }
  });

  it('varies from day to day', () => {
    const cs = days('2026-03-01', 60).map(dailyChallenge);
    expect(new Set(cs.map((c) => c.seed)).size).toBe(60);
    expect(new Set(cs.map((c) => c.mapId)).size).toBeGreaterThan(3);
    expect(new Set(cs.map((c) => c.difficulty)).size).toBeGreaterThan(1);
    expect(new Set(cs.map((c) => c.twist)).size).toBeGreaterThan(1);
  });

  it('refuses a date that is not a calendar day', () => {
    expect(() => dailyChallenge('2026-02-30')).toThrow();
    expect(() => dailyChallenge('nope')).toThrow();
    expect(isDailyDate('2028-02-29')).toBe(true);
    expect(isDailyDate('2026-13-01')).toBe(false);
  });

  it('plays the bot as crew B with the twist applied', () => {
    const c = dailyChallenge('2026-11-05');
    expect(dailyMatchOptions(c)).toEqual({ difficulty: c.difficulty, ticks: c.ticks, hold: { B: c.bot.hold }, lieCap: { B: c.bot.lieCap } });
  });
});

describe('daily clock', () => {
  it('reads the UTC day and the time to the next UTC midnight', () => {
    const now = new Date('2026-11-05T23:00:00-02:00'); // 01:00 UTC on the 6th
    expect(dailyDate(now)).toBe('2026-11-06');
    expect(dailyMsLeft(now)).toBe(23 * 3_600_000);
    expect(dailyMsLeft(new Date('2026-11-05T00:00:00Z'))).toBe(86_400_000);
  });
});

describe('dailyPoints', () => {
  it('ranks outcome first, then margin, then ticks left on a win', () => {
    const win = (you: number, bot: number, ticks: number) => dailyPoints({ outcome: 'win', you, bot, ticks, clock: 150 });
    expect(win(3, 1, 100)).toBe(10_000 + 200 + 50);
    // The speed bonus is capped below one point of margin.
    expect(win(3, 1, 0)).toBe(10_000 + 200 + 99);
    expect(win(3, 1, 0)).toBeLessThan(win(4, 1, 150));
    // The worst win beats the best draw; the worst draw beats the best loss.
    expect(dailyPoints({ outcome: 'win', you: 0, bot: 99, ticks: 150, clock: 150 })).toBe(8_000);
    expect(dailyPoints({ outcome: 'draw', you: 99, bot: 0, ticks: 10, clock: 150 })).toBe(7_000);
    expect(dailyPoints({ outcome: 'draw', you: 0, bot: 99, ticks: 150, clock: 150 })).toBe(3_000);
    expect(dailyPoints({ outcome: 'loss', you: 99, bot: 0, ticks: 10, clock: 150 })).toBe(2_000);
    // No speed bonus without a win.
    expect(dailyPoints({ outcome: 'loss', you: 1, bot: 2, ticks: 20, clock: 150 })).toBe(-100);
  });
});

describe('compareDaily', () => {
  it('breaks ties by fewer ticks, then by who finished first, then by id', () => {
    const rows = [
      { id: 'd', points: 10_250, ticks: 90, finishedAt: '2026-11-05T10:00:00Z' },
      { id: 'c', points: 10_250, ticks: 80, finishedAt: '2026-11-05T12:00:00Z' },
      { id: 'b', points: 10_250, ticks: 80, finishedAt: '2026-11-05T09:00:00Z' },
      { id: 'a', points: 5_000, ticks: 60, finishedAt: '2026-11-05T08:00:00Z' },
      { id: 'e', points: 10_300, ticks: 140, finishedAt: '2026-11-05T23:00:00Z' },
      { id: 'f', points: 10_250, ticks: 80, finishedAt: '2026-11-05T09:00:00Z' },
    ];
    expect([...rows].sort(compareDaily).map((r) => r.id)).toEqual(['e', 'b', 'f', 'c', 'd', 'a']);
  });
});
