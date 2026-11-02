// Practice against the bot and the headless runs that share its cadence: pure data and helpers, so
// the web can show the practice picker without bundling a decision engine. The bot is the greedy
// brain on a crew shaped by the difficulty (practiceRival); PRACTICE_MAPS are the maps where greedy
// against greedy plays a clean match (decision-engine test/v2-practice-sweep.test.ts pins them).
import type { Difficulty } from './difficulty';
import { DIFF_MODS } from './difficulty';
import { ROLES, type AgentSpec } from './match';
import type { TalkTier } from './talk';

/** The crew plan is rewritten every this many ticks (realtime and headless runs alike). */
export const V2_REPLAN_EVERY = 25;

/** How the bot side is shown to players. */
export const BOT_HANDLE = 'Greedy bot';

/** The agent defaults (agents.vision and agents.comms default to 3). */
const BOT_VISION = 3;
const BOT_COMMS = 3;

/** A bot crew of `size` agents on one talk tier (Standard by default), one role each in the engine's role order. */
export function botCrew(size: 1 | 2 | 3, idPrefix: string, tier: TalkTier = 'standard'): AgentSpec[] {
  return ROLES.slice(0, size).map((role, i) => ({
    id: `${idPrefix}-${i + 1}`,
    name: `Bot ${i + 1}`,
    role,
    vision: BOT_VISION,
    comms: BOT_COMMS,
    tier,
  }));
}

export interface PracticeRival {
  /** Agents the bot fields. */
  size: 1 | 2 | 3;
  /** The bot's talk tier. */
  tier: TalkTier;
  /** Extra ticks the bot holds at the start (MatchOptions.hold for its side). */
  hold: number;
  /** Bluffs the bot may tell (MatchOptions.lieCap for its side). */
  lieCap: number;
}

/**
 * How the bot plays at a difficulty (the rival-only rules of DIFF_MODS): its crew matches the
 * player's, or is a full three on Mega Agentic (as many as the map takes); it talks at the level's
 * tier (Quiet on Easy, Open on Agentic and Mega); it waits the level's extra ticks (12 s on Easy);
 * it bluffs up to the level's cap (1 on Easy to 9 on Mega).
 * A bot crew larger than the player's also gives the player the usual head start.
 */
export function practiceRival(difficulty: Difficulty, playerSize: 1 | 2 | 3, crewLimit: number): PracticeRival {
  const D = DIFF_MODS[difficulty];
  const size = (D.fullRival ? Math.max(playerSize, Math.min(3, crewLimit)) : playerSize) as 1 | 2 | 3;
  return { size, tier: D.rivalTier, hold: D.rivalWaitTicks, lieCap: D.rivalLies };
}

/**
 * The maps greedy plays cleanly on easy and normal, 1v1 and 2v2: every match ends before tick 150,
 * nobody is eliminated and somebody scores. Atlas order.
 */
export const PRACTICE_MAPS: readonly string[] = [
  'saltmarsh-weir',
  'ashfall-orchard',
  'frostline-depot',
  'glasshouse-ruins',
  'copper-hollow',
  'dust-bowl-silos',
  'monsoon-terraces',
  'sunken-metro',
  'basalt-stair',
  'blackout-harbor',
];

/** Copper Hollow on Easy ends 3-0 inside 60 ticks with greedy on both sides. */
export const DEFAULT_PRACTICE: { readonly mapId: string; readonly difficulty: Difficulty } = { mapId: 'copper-hollow', difficulty: 'easy' };

export function isPracticeMap(id: string): boolean {
  return PRACTICE_MAPS.includes(id);
}
