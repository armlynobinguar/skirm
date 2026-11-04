// The daily challenge: every UTC day one challenge, derived from the date alone (no state, no
// clock reads), so the api, the worker and the web all agree on it and anyone can check a result.
// A challenge is a practice map, a difficulty, the bot's crew size and one twist built from knobs
// the engine already has (the clock, the bot's head start, its bluff cap). Players run their own
// crew against the greedy bot on it, headless; the engine is deterministic, so on the greedy brain
// the same crew on the same day plays the same match and the same log hash.
//
// Score (dailyPoints), highest first:
//   outcome  win 10 000, draw 5 000, loss 0
//   margin   + 100 × (your score − bot score), the margin clamped to ±20
//   speed    + ticks left on the clock when you won (0 on a draw or loss), at most 99
// The outcome always dominates (a win is at least 8 000, a draw at most 7 000, a loss at most
// 2 000), one point of margin outweighs any speed bonus, and the bonus breaks ties between equal
// wins. Board ties (equal points) go to fewer ticks, then to whoever finished first.
import { DIFF_MODS, type Difficulty } from './difficulty';
import type { MapDefV2 } from './map';
import { MAPS_V2 } from './maps';
import type { MatchOptions, Team } from './match';
import { PRACTICE_MAPS, practiceRival } from './practice';
import type { TalkTier } from './talk';

/** Difficulties a daily challenge draws from (Mega's full rival crew is left to practice). */
export const DAILY_DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'agentic'];

export type DailyTwist = 'none' | 'short_clock' | 'sly_bot' | 'eager_bot';

export const DAILY_TWISTS: Readonly<Record<DailyTwist, { name: string; line: string }>> = {
  none: { name: 'Straight', line: 'No twist: the level as it plays in practice' },
  short_clock: { name: 'Short clock', line: 'The clock runs a fifth shorter' },
  sly_bot: { name: 'Sly bot', line: 'The bot may tell three more bluffs' },
  eager_bot: { name: 'Eager bot', line: 'The bot does not wait out its head start' },
};

export interface DailyChallenge {
  /** UTC day, `YYYY-MM-DD`. */
  date: string;
  /** 8 hex chars of the date's hash: every pick below comes from it. */
  seed: string;
  mapId: string;
  difficulty: Difficulty;
  twist: DailyTwist;
  /** Agents the bot fields; the player's crew may have 1 up to this many. */
  crewSize: 1 | 2 | 3;
  /** The match clock in ticks, twist included. */
  ticks: number;
  /** The bot's talk tier, extra start ticks and bluff cap, twist included. */
  bot: { tier: TalkTier; hold: number; lieCap: number };
}

/** Accepts `YYYY-MM-DD` that is a real calendar day. */
export function isDailyDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The UTC day of `now`, `YYYY-MM-DD`. */
export function dailyDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Milliseconds from `now` to the next UTC midnight (when the next challenge opens). */
export function dailyMsLeft(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/** FNV-1a, 32 bit: small, pure and the same everywhere. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A tiny counter-mode stream over the seed: pick n gives the same answer for the same day. */
function pick<T>(seed: number, n: number, from: readonly T[]): T {
  return from[fnv1a(`${seed}:${n}`) % from.length]!;
}

const mapById = (id: string): MapDefV2 => MAPS_V2.find((m) => m.id === id)!;
export const dailyCrewLimit = (m: MapDefV2) => Math.min(3, m.starts.A.length, m.starts.B.length);

/** The challenge of a UTC day (`YYYY-MM-DD`). Throws on a malformed date. */
export function dailyChallenge(date: string): DailyChallenge {
  if (!isDailyDate(date)) throw new Error(`bad daily date ${date}`);
  const h = fnv1a(`skirm.daily/v1:${date}`);
  const maps = PRACTICE_MAPS.filter((id) => MAPS_V2.some((m) => m.id === id));
  const map = mapById(pick(h, 0, maps));
  const difficulty = pick(h, 1, DAILY_DIFFICULTIES);
  const twist = pick(h, 2, Object.keys(DAILY_TWISTS) as DailyTwist[]);
  const limit = dailyCrewLimit(map);
  const sizes = ([1, 2, 3] as const).filter((n) => n <= limit);
  const crewSize = pick(h, 3, sizes);
  const rival = practiceRival(difficulty, crewSize, limit);
  const clock = DIFF_MODS[difficulty].ticks;
  return {
    date,
    seed: h.toString(16).padStart(8, '0'),
    mapId: map.id,
    difficulty,
    twist,
    crewSize: rival.size,
    ticks: twist === 'short_clock' ? Math.round(clock * 0.8) : clock,
    bot: {
      tier: rival.tier,
      hold: twist === 'eager_bot' ? 0 : rival.hold,
      lieCap: twist === 'sly_bot' ? rival.lieCap + 3 : rival.lieCap,
    },
  };
}

/** The engine options a challenge plays with (the bot is crew B). */
export function dailyMatchOptions(c: DailyChallenge): Pick<MatchOptions, 'difficulty' | 'ticks' | 'hold' | 'lieCap'> {
  const bot: Team = 'B';
  return { difficulty: c.difficulty, ticks: c.ticks, hold: { [bot]: c.bot.hold }, lieCap: { [bot]: c.bot.lieCap } };
}

export type DailyOutcome = 'win' | 'draw' | 'loss';

export const DAILY_POINTS = { win: 10_000, draw: 5_000, loss: 0, perMargin: 100, marginCap: 20, speedCap: 99 } as const;

/** An attempt's points (see the header): outcome, then the score margin, then ticks left on a win. */
export function dailyPoints(r: { outcome: DailyOutcome; you: number; bot: number; ticks: number; clock: number }): number {
  const P = DAILY_POINTS;
  const margin = Math.max(-P.marginCap, Math.min(P.marginCap, r.you - r.bot));
  const speed = r.outcome === 'win' ? Math.max(0, Math.min(P.speedCap, r.clock - r.ticks)) : 0;
  return P[r.outcome] + P.perMargin * margin + speed;
}

export interface DailyRankable {
  points: number;
  ticks: number;
  /** When the attempt finished (ms or ISO); earlier wins a tie. */
  finishedAt: number | string | Date;
  /** Last resort, so the order is total. */
  id: string;
}

/** Board order: points high to low, then fewer ticks, then finished first, then id. */
export function compareDaily(a: DailyRankable, b: DailyRankable): number {
  const t = (x: DailyRankable['finishedAt']) => new Date(x).getTime();
  return b.points - a.points || a.ticks - b.ticks || t(a.finishedAt) - t(b.finishedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
