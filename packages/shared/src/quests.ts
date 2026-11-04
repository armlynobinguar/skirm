// Daily and weekly quests, play streaks and achievements. Everything here is pure: progress is
// derived from a player's ended matches (QuestMatch), so the server needs no counters of its own,
// only a record of what was claimed and when an achievement was first seen.
//
// Quests are drawn deterministically from a pool per UTC day (daily) and per UTC week starting
// Monday 00:00 (weekly): every player gets the same quests, and any instance draws the same ones.
//
// Rewards and the global free budget (Formulas §4, v2GlobalFreeBudget, 4,126 credits a day):
// a quest's credits REFILL the player's free allowance for the day, up to the daily allowance
// (DEFAULTS.free.dailyCredits). They are never paid credits and never new money: a hold still draws
// free credits only while the global budget has room, so all free play together stays under G
// whatever is claimed. What the rewards change is how G is shared. A player who claims everything
// can use at most dailyCredits + QUEST_CONFIG.maxCreditsPerDay free credits in one day
// (60 + 3 × 10 + 2 × 25 = 140), about 97 a day averaged over a week, against 60 without quests;
// questBudgetCost() works it out. Achievement rewards are premium cosmetics, purely visual, with no
// model cost behind them.
import { DEFAULTS } from './config';
import { v2GlobalFreeBudget } from './economy';

export type QuestPeriod = 'daily' | 'weekly';
export type QuestOutcome = 'win' | 'loss' | 'draw';

/** Ticks of 2 s: 3:00 into a match is tick 90. */
export const TICK_SECONDS = 2;

/** One ended (not void) match from the player's side. */
export interface QuestMatch {
  id: string;
  /** ms since the epoch. */
  endedAt: number;
  outcome: QuestOutcome;
  practice: boolean;
  ranked: boolean;
  /** goal | time | eliminated. */
  reason: string | null;
  ticks: number | null;
  /** The talk tier each of the player's agents locked in, in crew order. */
  tiers: string[];
  /** Items the player's crew delivered (its score). */
  delivered: number;
  /** Lines the player's crew had delivered (debrief talk.sent). */
  talkSent: number;
}

export interface QuestDef {
  id: string;
  period: QuestPeriod;
  title: string;
  target: number;
  /** How much one match moves the quest. */
  count: (m: QuestMatch) => number;
}

const DAILY = Object.freeze({ count: 3, rewardCredits: 10 });
const WEEKLY = Object.freeze({ count: 2, rewardCredits: 25 });

export const QUEST_CONFIG = Object.freeze({
  daily: DAILY,
  weekly: WEEKLY,
  /** Most free credits quests can refill in one day: every daily plus every weekly claimed that day. */
  maxCreditsPerDay: DAILY.count * DAILY.rewardCredits + WEEKLY.count * WEEKLY.rewardCredits,
});

const won = (m: QuestMatch) => m.outcome === 'win';
const goalWin = (m: QuestMatch) => won(m) && m.reason === 'goal';
const allOn = (m: QuestMatch, tier: string) => m.tiers.length > 0 && m.tiers.every((t) => t === tier);
const one = (b: boolean) => (b ? 1 : 0);

/** Goal delivered by `seconds` into the match. */
export function goalBy(m: QuestMatch, seconds: number): boolean {
  return goalWin(m) && m.ticks !== null && m.ticks * TICK_SECONDS <= seconds;
}

export const DAILY_QUESTS: readonly QuestDef[] = Object.freeze([
  { id: 'd_practice_3', period: 'daily', title: 'Play 3 practice matches', target: 3, count: (m) => one(m.practice) },
  { id: 'd_win_quiet', period: 'daily', title: 'Win with every agent on Quiet talk', target: 1, count: (m) => one(won(m) && allOn(m, 'quiet')) },
  { id: 'd_goal_3min', period: 'daily', title: 'Deliver the goal before 3:00', target: 1, count: (m) => one(goalBy(m, 180)) },
  { id: 'd_play_2', period: 'daily', title: 'Play 2 matches', target: 2, count: () => 1 },
  { id: 'd_win_1', period: 'daily', title: 'Win a match', target: 1, count: (m) => one(won(m)) },
  { id: 'd_full_crew', period: 'daily', title: 'Play a match with a crew of three', target: 1, count: (m) => one(m.tiers.length >= 3) },
  { id: 'd_ranked_1', period: 'daily', title: 'Play a ranked match', target: 1, count: (m) => one(m.ranked) },
  { id: 'd_talk_20', period: 'daily', title: 'Get 20 lines through to your crew', target: 20, count: (m) => m.talkSent },
  { id: 'd_deliver_5', period: 'daily', title: 'Deliver 5 items', target: 5, count: (m) => m.delivered },
  { id: 'd_win_open', period: 'daily', title: 'Win with an agent on Open talk', target: 1, count: (m) => one(won(m) && m.tiers.includes('open')) },
] satisfies QuestDef[]);

export const WEEKLY_QUESTS: readonly QuestDef[] = Object.freeze([
  { id: 'w_win_5', period: 'weekly', title: 'Win 5 matches', target: 5, count: (m) => one(won(m)) },
  { id: 'w_play_10', period: 'weekly', title: 'Play 10 matches', target: 10, count: () => 1 },
  { id: 'w_ranked_win_3', period: 'weekly', title: 'Win 3 ranked matches', target: 3, count: (m) => one(won(m) && m.ranked) },
  { id: 'w_goal_3', period: 'weekly', title: 'Deliver the goal 3 times', target: 3, count: (m) => one(goalWin(m)) },
  { id: 'w_quiet_3', period: 'weekly', title: 'Win 3 matches with every agent on Quiet', target: 3, count: (m) => one(won(m) && allOn(m, 'quiet')) },
  { id: 'w_deliver_25', period: 'weekly', title: 'Deliver 25 items', target: 25, count: (m) => m.delivered },
] satisfies QuestDef[]);

export function questById(id: string): QuestDef | undefined {
  return DAILY_QUESTS.find((q) => q.id === id) ?? WEEKLY_QUESTS.find((q) => q.id === id);
}

export function questReward(period: QuestPeriod): number {
  return QUEST_CONFIG[period].rewardCredits;
}

// ---------- Periods ----------

const DAY_MS = 86_400_000;

/** UTC day key, YYYY-MM-DD. */
export function questDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface QuestWindow {
  period: QuestPeriod;
  /** The day (daily) or the Monday the week starts on (weekly), YYYY-MM-DD. */
  key: string;
  startsAt: number;
  endsAt: number;
}

/** The UTC day or Monday-to-Sunday UTC week `now` is in. */
export function questWindow(period: QuestPeriod, now: number): QuestWindow {
  const d = new Date(now);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (period === 'daily')
    return { period, key: questDay(dayStart), startsAt: dayStart, endsAt: dayStart + DAY_MS };
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const startsAt = dayStart - sinceMonday * DAY_MS;
  return { period, key: questDay(startsAt), startsAt, endsAt: startsAt + 7 * DAY_MS };
}

// ---------- Draw ----------

/** FNV-1a, 32 bits. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small seeded PRNG, the same on every instance. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The quests of one window: a seeded shuffle of the pool keyed by period and window key. */
export function drawQuests(window: Pick<QuestWindow, 'period' | 'key'>): QuestDef[] {
  const pool = [...(window.period === 'daily' ? DAILY_QUESTS : WEEKLY_QUESTS)];
  const next = rng(fnv1a(`skirm-quests:${window.period}:${window.key}`));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, QUEST_CONFIG[window.period].count);
}

/** Progress towards a quest from the matches that ended inside its window, capped at the target. */
export function questProgress(
  quest: QuestDef,
  window: Pick<QuestWindow, 'startsAt' | 'endsAt'>,
  matches: readonly QuestMatch[],
): number {
  let n = 0;
  for (const m of matches)
    if (m.endedAt >= window.startsAt && m.endedAt < window.endsAt) n += Math.max(0, quest.count(m));
  return Math.min(quest.target, n);
}

// ---------- Streaks ----------

export interface PlayStreak {
  /** Consecutive UTC days with a match, ending today, or yesterday when today has none yet. */
  current: number;
  best: number;
  playedToday: boolean;
}

/** Streak from the UTC days (YYYY-MM-DD) the player ended a match on. */
export function playStreak(days: Iterable<string>, now: number): PlayStreak {
  const set = new Set(days);
  const dayMs = (k: string) => Date.parse(`${k}T00:00:00Z`);
  const sorted = [...set].filter((k) => !Number.isNaN(dayMs(k))).sort();
  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const k of sorted) {
    const t = dayMs(k);
    run = t - prev === DAY_MS ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  const today = questWindow('daily', now).startsAt;
  const playedToday = set.has(questDay(today));
  let cursor = playedToday ? today : today - DAY_MS;
  let current = 0;
  while (set.has(questDay(cursor))) {
    current++;
    cursor -= DAY_MS;
  }
  return { current, best, playedToday };
}

// ---------- Achievements ----------

export interface AchievementStats {
  matches: number;
  wins: number;
  practice: number;
  ranked: number;
  goals: number;
  /** Fewest ticks a goal was delivered in, null before the first. */
  fastestGoalTicks: number | null;
  quietWins: number;
  bestStreak: number;
  questsClaimed: number;
}

export interface AchievementDef {
  id: string;
  title: string;
  detail: string;
  target: number;
  value: (s: AchievementStats) => number;
  /** A premium cosmetic (@skirm/shared COSMETICS id) granted when it unlocks. */
  cosmetic?: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze([
  { id: 'first_match', title: 'First drop', detail: 'Play your first match', target: 1, value: (s) => s.matches },
  { id: 'first_win', title: 'First win', detail: 'Win a match', target: 1, value: (s) => s.wins },
  { id: 'practice_10', title: 'Sparring partner', detail: 'Play 10 practice matches', target: 10, value: (s) => s.practice },
  { id: 'ranked_10', title: 'On the ladder', detail: 'Play 10 ranked matches', target: 10, value: (s) => s.ranked },
  { id: 'goal_10', title: 'Courier', detail: 'Deliver the goal 10 times', target: 10, value: (s) => s.goals },
  {
    id: 'quick_goal',
    title: 'Two-minute drill',
    detail: 'Deliver the goal before 2:00',
    target: 1,
    value: (s) => one(s.fastestGoalTicks !== null && s.fastestGoalTicks * TICK_SECONDS <= 120),
  },
  { id: 'silent_5', title: 'Silent running', detail: 'Win 5 matches with every agent on Quiet', target: 5, value: (s) => s.quietWins },
  { id: 'wins_25', title: 'Veteran', detail: 'Win 25 matches', target: 25, value: (s) => s.wins, cosmetic: 'outfit_obsidian' },
  { id: 'streak_7', title: 'Seven straight', detail: 'Play 7 days in a row', target: 7, value: (s) => s.bestStreak, cosmetic: 'hair_platinum' },
  { id: 'quests_20', title: 'Quest runner', detail: 'Complete 20 quests', target: 20, value: (s) => s.questsClaimed, cosmetic: 'hair_violet' },
] satisfies AchievementDef[]);

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** All-time stats from every ended match, the streak and the quests claimed. */
export function achievementStats(
  matches: readonly QuestMatch[],
  bestStreak: number,
  questsClaimed: number,
): AchievementStats {
  const s: AchievementStats = {
    matches: 0,
    wins: 0,
    practice: 0,
    ranked: 0,
    goals: 0,
    fastestGoalTicks: null,
    quietWins: 0,
    bestStreak,
    questsClaimed,
  };
  for (const m of matches) {
    s.matches++;
    if (won(m)) s.wins++;
    if (m.practice) s.practice++;
    if (m.ranked) s.ranked++;
    if (goalWin(m)) {
      s.goals++;
      if (m.ticks !== null) s.fastestGoalTicks = Math.min(s.fastestGoalTicks ?? m.ticks, m.ticks);
    }
    if (won(m) && allOn(m, 'quiet')) s.quietWins++;
  }
  return s;
}

// ---------- Budget ----------

export interface QuestBudgetCost {
  /** Free credits one player can use in a day without quests. */
  baseDaily: number;
  /** Most one player can use in a day with every quest claimed that day. */
  maxDaily: number;
  /** A full-claim player's daily average over a week (dailies every day, weeklies once). */
  avgDaily: number;
  /** The global free budget G; quests never raise it. */
  globalDaily: number;
  /** Players G covers at the base allowance, and at the full-claim average. */
  playersAtBase: number;
  playersAtFullClaim: number;
}

/** What quest rewards cost the free budget (see the header). */
export function questBudgetCost(
  globalDaily: number = v2GlobalFreeBudget(),
  baseDaily: number = DEFAULTS.free.dailyCredits,
): QuestBudgetCost {
  const daily = QUEST_CONFIG.daily.count * QUEST_CONFIG.daily.rewardCredits;
  const weekly = QUEST_CONFIG.weekly.count * QUEST_CONFIG.weekly.rewardCredits;
  const avgDaily = baseDaily + daily + weekly / 7;
  return {
    baseDaily,
    maxDaily: baseDaily + QUEST_CONFIG.maxCreditsPerDay,
    avgDaily,
    globalDaily,
    playersAtBase: Math.floor(globalDaily / baseDaily),
    playersAtFullClaim: Math.floor(globalDaily / avgDaily),
  };
}
