// Agent traits in play (catalogue and caps: @skirm/shared progression.ts). Each trait is one small
// step on one existing agent stat, applied the same way every time: the stats an agent was created
// with stay as they are (they are what the match log header records), and the trait list beside
// them is what changes how they play. Ranked plays every agent on its base stats unless
// DEFAULTS.progression.rankedTraits is on (createMatch drops the traits).
import { normalizeTraits, type TraitId } from '@skirm/shared';

/** What a set of traits changes, as deltas on the engine's stats. */
export interface TraitMods {
  /** Added to vision (sight radius) and comms (say range). */
  vision: number;
  comms: number;
  /** Taken off the knock-down and stun timers. */
  down: number;
  stun: number;
  /** Taken off a verb's cooldown. */
  cooldown: number;
  /** Extra dig hits per move into dirt by hand (Diggers already clear it in one). */
  dig: number;
}

const NONE: TraitMods = { vision: 0, comms: 0, down: 0, stun: 0, cooldown: 0, dig: 0 };

export const TRAIT_MODS: Readonly<Record<TraitId, Partial<TraitMods>>> = {
  keen: { vision: 1 },
  clear: { comms: 1 },
  steady: { down: 1 },
  calm: { stun: 1 },
  quick: { cooldown: 2 },
  strong: { dig: 1 },
};

/** A traited stat never goes past this (base stats are 1 to 5). */
export const TRAIT_STAT_MAX = 6;

/** The summed changes of a trait list (normalised first: known, once each, capped). */
export function traitMods(traits: readonly TraitId[] | undefined): TraitMods {
  const out = { ...NONE };
  for (const t of normalizeTraits(traits)) for (const [k, v] of Object.entries(TRAIT_MODS[t]) as [keyof TraitMods, number][]) out[k] += v;
  return out;
}

type Traited = { vision: number; comms: number; traits?: readonly TraitId[] };

/** Vision with traits: the sight radius and bluff doubt read this. */
export function visionOf(a: Traited): number {
  return Math.min(TRAIT_STAT_MAX, a.vision + traitMods(a.traits).vision);
}

/** Comms with traits: how far its voice carries. */
export function commsOf(a: Traited): number {
  return Math.min(TRAIT_STAT_MAX, a.comms + traitMods(a.traits).comms);
}

/** Ticks a knock-down or stun lasts for this agent (never under one). */
export function timerFor(base: number, a: { traits?: readonly TraitId[] }, kind: 'down' | 'stun'): number {
  return Math.max(1, base - traitMods(a.traits)[kind]);
}

/** A verb cooldown for this agent (never under one tick). */
export function cooldownFor(base: number, a: { traits?: readonly TraitId[] }): number {
  return Math.max(1, base - traitMods(a.traits).cooldown);
}

/** Dig hits one move into dirt does: `base` plus any trait. */
export function digHitsFor(base: number, a: { traits?: readonly TraitId[] }): number {
  return base + traitMods(a.traits).dig;
}
