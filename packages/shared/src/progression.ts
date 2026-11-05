// Agent progression: XP from matches, levels from XP, and traits picked at trait levels
// (DEFAULTS.progression). The trait catalogue lives here (ids, names, what each does); the engine
// (v2/traits.ts) turns a trait list into stat changes. Every trait is one small step on one stat,
// each can be taken once, and an agent holds at most `maxTraits`, so the total is capped.
import { DEFAULTS } from './config';

/** DEFAULTS.progression under its own name. */
export const PROGRESSION = DEFAULTS.progression;

export const TRAIT_IDS = ['keen', 'clear', 'steady', 'calm', 'quick', 'strong'] as const;
export type TraitId = (typeof TRAIT_IDS)[number];

export interface TraitInfo {
  id: TraitId;
  name: string;
  /** What it does, in one short line. */
  effect: string;
}

export const TRAITS: Readonly<Record<TraitId, TraitInfo>> = {
  keen: { id: 'keen', name: 'Keen', effect: '+1 vision: sees one tile further' },
  clear: { id: 'clear', name: 'Clear voice', effect: '+1 comms: its say carries one tile further' },
  steady: { id: 'steady', name: 'Steady', effect: 'Back up 1 tick sooner after a hazard or switch knocks it down' },
  calm: { id: 'calm', name: 'Calm', effect: 'Stunned 1 tick less by a rival repel' },
  quick: { id: 'quick', name: 'Quick hands', effect: "Verb cooldowns (a Scout's repel) 2 ticks shorter" },
  strong: { id: 'strong', name: 'Strong arm', effect: 'Digs dirt by hand in 2 hits instead of 3' },
};

export const isTraitId = (v: unknown): v is TraitId => typeof v === 'string' && (TRAIT_IDS as readonly string[]).includes(v);

/**
 * A trait list as it plays: known ids only, each once, in catalogue order, at most `maxTraits`.
 * The same set always gives the same list, whatever order it was picked in.
 */
export function normalizeTraits(list: readonly unknown[] | null | undefined): TraitId[] {
  const set = new Set((list ?? []).filter(isTraitId));
  return TRAIT_IDS.filter((t) => set.has(t)).slice(0, PROGRESSION.maxTraits);
}

/** Total XP an agent needs to reach `level` (level 1 is 0 XP). */
export function xpForLevel(level: number): number {
  const n = Math.max(0, Math.min(PROGRESSION.maxLevel, Math.floor(level)) - 1);
  return n * PROGRESSION.levelBase + (PROGRESSION.levelStep * n * (n - 1)) / 2;
}

/** The level `xp` reaches, 1 to maxLevel. */
export function levelOf(xp: number): number {
  let level = 1;
  while (level < PROGRESSION.maxLevel && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Trait picks a level has earned (one per trait level reached, at most maxTraits). */
export function traitSlots(level: number): number {
  return Math.min(PROGRESSION.maxTraits, PROGRESSION.traitLevels.filter((l) => level >= l).length);
}

export type MatchXpKind = 'ranked' | 'casual' | 'practice';

export interface MatchXpInput {
  kind: MatchXpKind;
  outcome: 'win' | 'draw' | 'loss';
  /** Items this agent delivered. */
  delivered: number;
}

/** XP one agent earns from one match played to the end (practice: none by default). */
export function matchXp(i: MatchXpInput): number {
  const x = PROGRESSION.xp;
  const base = x[i.kind];
  if (base <= 0) return 0;
  const result = i.outcome === 'win' ? x.win : i.outcome === 'draw' ? x.draw : 0;
  const items = Math.max(0, Math.min(x.maxDelivered, Math.floor(i.delivered)));
  return base + result + items * x.perDelivered;
}

/** An agent's progression as the API and the web show it. */
export interface AgentProgression {
  xp: number;
  level: number;
  /** XP where this level starts, and where the next one does (null at the top level). */
  levelXp: number;
  nextLevelXp: number | null;
  maxLevel: number;
  traits: TraitId[];
  /** Trait picks earned so far; `traits.length` of them are taken. */
  traitSlots: number;
  /** The level that earns the next trait pick (null when every pick is earned). */
  nextTraitLevel: number | null;
}

export function progressionOf(xp: number, traits: readonly unknown[] | null | undefined): AgentProgression {
  const level = levelOf(xp);
  return {
    xp,
    level,
    levelXp: xpForLevel(level),
    nextLevelXp: level < PROGRESSION.maxLevel ? xpForLevel(level + 1) : null,
    maxLevel: PROGRESSION.maxLevel,
    traits: normalizeTraits(traits),
    traitSlots: traitSlots(level),
    nextTraitLevel: PROGRESSION.traitLevels.slice(0, PROGRESSION.maxTraits).find((l) => l > level) ?? null,
  };
}

/** Whether the agent may pick `trait` now; the reason when not. */
export function traitPickError(p: AgentProgression, trait: TraitId): string | null {
  if (p.traits.includes(trait)) return 'the agent already has that trait';
  if (p.traits.length >= p.traitSlots)
    return p.nextTraitLevel ? `the next trait unlocks at level ${p.nextTraitLevel}` : `an agent holds at most ${PROGRESSION.maxTraits} traits`;
  return null;
}
