// Difficulty: the same map with different rules and a different goal (the prototype's DIFFS). Casual
// matches pick one of five; ranked always plays Normal. A level changes how fast the hazards spread
// and how far they grow, how many items win, the clock, and whether the whole map is fogged or dark.
import type { MapDefV2 } from './map';
import type { TalkTier } from './talk';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'agentic' | 'mega';

/** In picker order (the prototype's DIFFS index). */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'agentic', 'mega'];

/** Ranked plays this level. */
export const RANKED_DIFFICULTY: Difficulty = 'normal';

export interface DiffMods {
  key: Difficulty;
  /** Display name, e.g. "Mega Agentic". */
  name: string;
  /** Accent colour of the level's tag. */
  colour: string;
  /** Multiplies each hazard's spread interval (above 1: slower), rounded, at least 1 tick. */
  hazardScale: number;
  /** Added to each hazard's wave cap (at least 3 waves). */
  capDelta: number;
  /** Added to the map's goal (at least 2 items). */
  goalDelta: number;
  /** Match length in ticks. */
  ticks: number;
  /** Extra ticks the rival crew holds at the start (Easy gives you 12 s). */
  rivalWaitTicks: number;
  /** Talk tier the prototype's rival crew plays at. */
  rivalTier: TalkTier;
  /** Bluffs the practice bot may tell (practiceRival; every other crew has BLUFF_CAP). */
  rivalLies: number;
  /** Fog over the whole map, whatever the map's own setting. */
  fog: boolean;
  /** Night (vision one tile shorter), whatever the map's own setting. */
  night: boolean;
  /** The rival fields a full crew of three. */
  fullRival: boolean;
  /** One line for the picker. */
  line: string;
}

export const DIFF_MODS: Readonly<Record<Difficulty, DiffMods>> = {
  easy: {
    key: 'easy',
    name: 'Easy',
    colour: '#5fd39a',
    hazardScale: 1.6,
    capDelta: -2,
    goalDelta: -1,
    ticks: 150,
    rivalWaitTicks: 6,
    rivalTier: 'quiet',
    rivalLies: 1,
    fog: false,
    night: false,
    fullRival: false,
    line: 'Slow hazard · rival waits 12 s · one fewer to deliver',
  },
  normal: {
    key: 'normal',
    name: 'Normal',
    colour: '#34e0c8',
    hazardScale: 1,
    capDelta: 0,
    goalDelta: 0,
    ticks: 150,
    rivalWaitTicks: 0,
    rivalTier: 'standard',
    rivalLies: 3,
    fog: false,
    night: false,
    fullRival: false,
    line: 'The map as designed · ranked plays this',
  },
  hard: {
    key: 'hard',
    name: 'Hard',
    colour: '#ffb547',
    hazardScale: 0.75,
    capDelta: 1,
    goalDelta: 0,
    ticks: 135,
    rivalWaitTicks: 0,
    rivalTier: 'standard',
    rivalLies: 4,
    fog: false,
    night: false,
    fullRival: false,
    line: 'Faster hazard · 4:30 clock',
  },
  agentic: {
    key: 'agentic',
    name: 'Agentic',
    colour: '#ff4655',
    hazardScale: 0.6,
    capDelta: 2,
    goalDelta: 1,
    ticks: 135,
    rivalWaitTicks: 0,
    rivalTier: 'open',
    rivalLies: 6,
    fog: true,
    night: false,
    fullRival: false,
    line: 'Rivals talk every tick and bluff often · fog everywhere · one more to deliver',
  },
  mega: {
    key: 'mega',
    name: 'Mega Agentic',
    colour: '#c06bff',
    hazardScale: 0.5,
    capDelta: 3,
    goalDelta: 1,
    ticks: 120,
    rivalWaitTicks: 0,
    rivalTier: 'open',
    rivalLies: 9,
    fog: true,
    night: true,
    fullRival: true,
    line: 'Full rival crew on Open talk · night fog · 4:00 clock',
  },
};

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v);
}

/**
 * The map as a level plays it: each hazard spreads every `round(every × hazardScale)` ticks (at
 * least 1) for `cap + capDelta` waves (at least 3), the goal moves by `goalDelta` (at least 2), and
 * the level's fog and night are added to the map's own. Normal is the map as designed.
 *
 * The rival-only rules (rivalWaitTicks, rivalTier, rivalLies, fullRival) shape the practice bot
 * (practiceRival). Both crews in a PvP match are players who picked the same level, so they apply
 * only there.
 */
export function withDifficulty(def: MapDefV2, difficulty: Difficulty): MapDefV2 {
  if (difficulty === 'normal') return def;
  const D = DIFF_MODS[difficulty];
  return {
    ...def,
    goal: Math.max(2, def.goal + D.goalDelta),
    hazards: def.hazards.map((h) => ({ kind: h.kind, every: Math.max(1, Math.round(h.every * D.hazardScale)), cap: Math.max(3, h.cap + D.capDelta) })),
    fog: def.fog || D.fog,
    night: def.night || D.night,
  };
}
