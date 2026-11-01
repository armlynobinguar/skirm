// Cross-package contract: the tag and unlock vocabulary skills are written against, the sides of a
// match, the charge reasons the ledger reads and the public skill record (Game Spec §2, §4, §9).
// Change this file only on purpose: every package builds against it.

// ---------- Vocabulary ----------

export type Tag =
  | 'spreads'
  | 'liquid'
  | 'damages'
  | 'solid'
  | 'blocks'
  | 'pushable'
  | 'breakable'
  | 'flammable'
  | 'collectible'
  | 'goal';
/** Order of the tag table in Spec §2; tag lists are always written in this order. */
export const TAGS: readonly Tag[] = [
  'spreads',
  'liquid',
  'damages',
  'solid',
  'blocks',
  'pushable',
  'breakable',
  'flammable',
  'collectible',
  'goal',
];

/** Action names a skill can require. */
export type ActionKind =
  'move' | 'wait' | 'pick_up' | 'drop' | 'place_block' | 'dig' | 'extinguish';
export const ACTION_KINDS: readonly ActionKind[] = [
  'move',
  'wait',
  'pick_up',
  'drop',
  'place_block',
  'dig',
  'extinguish',
];

export type Unlock = 'builder' | 'digger' | 'firefighter';
export const UNLOCK_ACTION: Readonly<Record<Unlock, ActionKind>> = {
  builder: 'place_block',
  digger: 'dig',
  firefighter: 'extinguish',
};

/** Thing ids the UI names and draws (Spec §2). */
export type ThingId =
  | 'wall'
  | 'block'
  | 'water'
  | 'lava'
  | 'fire'
  | 'dirt'
  | 'crate'
  | 'grass'
  | 'gem'
  | 'key'
  | 'crystal'
  | 'exit'
  | 'flag';

/** Why an agent's turn became (or was) a wait. null = applied as picked. */
export type ActionReason = 'illegal' | 'stale' | 'blocked' | 'timeout' | 'error' | 'lost' | null;

export type Side = 'A' | 'B';

// ---------- Skills (skirm.skill/v0, Spec §9) ----------

export interface SkillPublic {
  schema: 'skirm.skill/v0';
  id: string;
  version: number;
  name: string;
  summary?: string;
  creator: string;
  owner: string;
  royalty_bps: number;
  requires_actions: Extract<ActionKind, 'place_block' | 'dig' | 'extinguish'>[];
  handles_tags: Tag[];
  prompt_sha256: string;
  created_at: string;
}

/** Stored form; prompt and reflexes are write-only and never leave the runner. */
export interface SkillStored extends SkillPublic {
  prompt: string;
  reflexes?: string;
}
