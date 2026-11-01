// Practice against the bot and the headless runs that share its cadence: pure data and helpers, so
// the web can show the practice picker without bundling a decision engine. The bot is the greedy
// brain on a Standard crew the same size as the player's; PRACTICE_MAPS are the maps where greedy
// against greedy plays a clean match (decision-engine test/v2-practice-sweep.test.ts pins them).
import type { Difficulty } from './difficulty';
import { ROLES, type AgentSpec } from './match';

/** The crew plan is rewritten every this many ticks (realtime and headless runs alike). */
export const V2_REPLAN_EVERY = 25;

/** How the bot side is shown to players. */
export const BOT_HANDLE = 'Greedy bot';

/** The agent defaults (agents.vision and agents.comms default to 3). */
const BOT_VISION = 3;
const BOT_COMMS = 3;

/** A bot crew of `size` agents on Standard talk, one role each in the engine's role order. */
export function botCrew(size: 1 | 2 | 3, idPrefix: string): AgentSpec[] {
  return ROLES.slice(0, size).map((role, i) => ({
    id: `${idPrefix}-${i + 1}`,
    name: `Bot ${i + 1}`,
    role,
    vision: BOT_VISION,
    comms: BOT_COMMS,
    tier: 'standard',
  }));
}

/**
 * The maps greedy plays cleanly on easy and normal, 1v1 and 2v2: every match ends before tick 150,
 * nobody is eliminated and somebody scores. Atlas order.
 */
export const PRACTICE_MAPS: readonly string[] = [
  'ashfall-orchard',
  'frostline-depot',
  'glasshouse-ruins',
  'copper-hollow',
  'dust-bowl-silos',
  'monsoon-terraces',
  'sunken-metro',
  'blackout-harbor',
];

/** Copper Hollow on Easy ends 3-0 inside 60 ticks with greedy on both sides. */
export const DEFAULT_PRACTICE: { readonly mapId: string; readonly difficulty: Difficulty } = { mapId: 'copper-hollow', difficulty: 'easy' };

export function isPracticeMap(id: string): boolean {
  return PRACTICE_MAPS.includes(id);
}
