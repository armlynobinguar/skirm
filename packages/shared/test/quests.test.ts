import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  COSMETICS,
  DAILY_QUESTS,
  DEFAULTS,
  QUEST_CONFIG,
  WEEKLY_QUESTS,
  achievementStats,
  drawQuests,
  goalBy,
  playStreak,
  questBudgetCost,
  questById,
  questProgress,
  questWindow,
  v2GlobalFreeBudget,
  type QuestMatch,
} from '../src/index';

const at = (iso: string) => Date.parse(iso);

function match(over: Partial<QuestMatch> = {}): QuestMatch {
  return {
    id: 'mat_1',
    endedAt: at('2026-11-04T10:00:00Z'),
    outcome: 'win',
    practice: false,
    ranked: false,
    reason: 'goal',
    ticks: 80,
    tiers: ['standard'],
    delivered: 3,
    talkSent: 4,
    ...over,
  };
}

describe('quest windows', () => {
  it('daily is the UTC day, weekly starts Monday 00:00 UTC', () => {
    const now = at('2026-11-04T23:59:59Z'); // a Wednesday
    expect(questWindow('daily', now)).toEqual({
      period: 'daily',
      key: '2026-11-04',
      startsAt: at('2026-11-04T00:00:00Z'),
      endsAt: at('2026-11-05T00:00:00Z'),
    });
    expect(questWindow('weekly', now)).toMatchObject({
      key: '2026-11-02',
      startsAt: at('2026-11-02T00:00:00Z'),
      endsAt: at('2026-11-09T00:00:00Z'),
    });
    // Sunday still belongs to the week that started on Monday.
    expect(questWindow('weekly', at('2026-11-08T12:00:00Z')).key).toBe('2026-11-02');
    expect(questWindow('weekly', at('2026-11-09T00:00:00Z')).key).toBe('2026-11-09');
  });
});

describe('drawQuests', () => {
  it('is deterministic per window and picks distinct quests from the right pool', () => {
    const w = questWindow('daily', at('2026-11-04T08:00:00Z'));
    const a = drawQuests(w).map((q) => q.id);
    expect(drawQuests(w).map((q) => q.id)).toEqual(a);
    expect(a).toHaveLength(QUEST_CONFIG.daily.count);
    expect(new Set(a).size).toBe(a.length);
    for (const id of a) expect(DAILY_QUESTS.some((q) => q.id === id)).toBe(true);
    const weekly = drawQuests(questWindow('weekly', at('2026-11-04T08:00:00Z')));
    expect(weekly).toHaveLength(QUEST_CONFIG.weekly.count);
    for (const q of weekly) expect(WEEKLY_QUESTS).toContain(q);
  });

  it('changes from day to day', () => {
    const draws = new Set<string>();
    for (let d = 1; d <= 14; d++) {
      const now = Date.UTC(2026, 10, d, 12);
      draws.add(drawQuests(questWindow('daily', now)).map((q) => q.id).join(','));
    }
    expect(draws.size).toBeGreaterThan(5);
  });

  it('has unique ids across both pools', () => {
    const ids = [...DAILY_QUESTS, ...WEEKLY_QUESTS].map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(questById('w_win_5')?.period).toBe('weekly');
    expect(questById('nope')).toBeUndefined();
  });
});

describe('questProgress', () => {
  const day = questWindow('daily', at('2026-11-04T08:00:00Z'));

  it('counts matches inside the window only and caps at the target', () => {
    const practice = questById('d_practice_3')!;
    const ms = [
      match({ practice: true }),
      match({ practice: true, endedAt: at('2026-11-03T23:59:59Z') }),
      match({ practice: true }),
      match({ practice: false }),
    ];
    expect(questProgress(practice, day, ms)).toBe(2);
    expect(questProgress(practice, day, [...ms, match({ practice: true }), match({ practice: true })])).toBe(3);
  });

  it('wins on Quiet need every agent on Quiet', () => {
    const quiet = questById('d_win_quiet')!;
    expect(questProgress(quiet, day, [match({ tiers: ['quiet', 'standard'] })])).toBe(0);
    expect(questProgress(quiet, day, [match({ tiers: ['quiet', 'quiet'], outcome: 'loss' })])).toBe(0);
    expect(questProgress(quiet, day, [match({ tiers: ['quiet', 'quiet'] })])).toBe(1);
  });

  it('a goal before 3:00 is a goal win by tick 90', () => {
    expect(goalBy(match({ ticks: 90 }), 180)).toBe(true);
    expect(goalBy(match({ ticks: 91 }), 180)).toBe(false);
    expect(goalBy(match({ reason: 'time' }), 180)).toBe(false);
    expect(goalBy(match({ outcome: 'loss' }), 180)).toBe(false);
  });

  it('sums lines and deliveries', () => {
    const talk = questById('d_talk_20')!;
    expect(questProgress(talk, day, [match({ talkSent: 12 }), match({ talkSent: 5 })])).toBe(17);
  });
});

describe('playStreak', () => {
  const now = at('2026-11-04T09:00:00Z');

  it('counts back from today, or from yesterday until today is played', () => {
    expect(playStreak(['2026-11-02', '2026-11-03', '2026-11-04'], now)).toEqual({
      current: 3,
      best: 3,
      playedToday: true,
    });
    expect(playStreak(['2026-11-02', '2026-11-03'], now)).toEqual({
      current: 2,
      best: 2,
      playedToday: false,
    });
    expect(playStreak(['2026-11-01', '2026-11-02'], now).current).toBe(0);
  });

  it('keeps the best run', () => {
    const s = playStreak(
      ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-11-04', '2026-10-04'],
      now,
    );
    expect(s).toEqual({ current: 1, best: 4, playedToday: true });
    expect(playStreak([], now)).toEqual({ current: 0, best: 0, playedToday: false });
  });
});

describe('achievements', () => {
  it('derive from all-time stats', () => {
    const s = achievementStats(
      [
        match({ ticks: 55 }),
        match({ outcome: 'loss', practice: true, reason: 'time', ticks: 150 }),
        match({ tiers: ['quiet'], ranked: true, ticks: 100 }),
      ],
      3,
      2,
    );
    expect(s).toEqual({
      matches: 3,
      wins: 2,
      practice: 1,
      ranked: 1,
      goals: 2,
      fastestGoalTicks: 55,
      quietWins: 1,
      bestStreak: 3,
      questsClaimed: 2,
    });
    const quick = ACHIEVEMENTS.find((a) => a.id === 'quick_goal')!;
    expect(quick.value(s)).toBe(1);
    expect(quick.value({ ...s, fastestGoalTicks: 61 })).toBe(0);
  });

  it('reward only real premium cosmetics, each once', () => {
    const rewards = ACHIEVEMENTS.flatMap((a) => (a.cosmetic ? [a.cosmetic] : []));
    expect(new Set(rewards).size).toBe(rewards.length);
    for (const id of rewards) expect(COSMETICS.some((c) => c.id === id)).toBe(true);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe('quest rewards and the global free budget', () => {
  it('documents the cost: quests reshare G, they never raise it', () => {
    const cost = questBudgetCost();
    expect(QUEST_CONFIG.maxCreditsPerDay).toBe(80);
    expect(cost.baseDaily).toBe(DEFAULTS.free.dailyCredits);
    expect(cost.maxDaily).toBe(140);
    expect(cost.avgDaily).toBeCloseTo(60 + 30 + 50 / 7, 6);
    expect(cost.globalDaily).toBe(v2GlobalFreeBudget());
    expect(cost.playersAtBase).toBe(68);
    expect(cost.playersAtFullClaim).toBe(42);
    // One full-claim player's day is a small slice of G.
    expect(cost.maxDaily).toBeLessThan(cost.globalDaily * 0.05);
  });
});
