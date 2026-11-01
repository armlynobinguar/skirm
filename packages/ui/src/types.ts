import type { ActionKind, Tag, ThingId, Unlock } from '@skirm/shared';

export type { Tag, ThingId } from '@skirm/shared';

/** Map-level action names (same as the engine's ActionKind). */
export type ActionName = ActionKind;
/** Display form of an unlock. Components also accept the engine's lowercase `Unlock` ids. */
export type UnlockName = 'Builder' | 'Digger' | 'Firefighter';
export type UnlockLike = UnlockName | Unlock;
export type Tone = 'neutral' | 'good' | 'warning' | 'critical';
export type Crew = 'a' | 'b';
export type TileKind =
  | 'floor'
  | 'wall'
  | 'water'
  | 'lava'
  | 'fire'
  | 'grass'
  | 'crate'
  | 'dirt'
  | 'block'
  | 'gem'
  | 'exit'
  | 'agent'
  | 'mark';
export type Detail = 'full' | 'compact' | 'fill';
export type AgentState = 'idle' | 'acting' | 'lost';

export type IconName =
  | 'move'
  | 'wait'
  | 'pick_up'
  | 'drop'
  | 'place_block'
  | 'dig'
  | 'extinguish'
  | 'tick'
  | 'steps'
  | 'agent'
  | 'crew'
  | 'skill'
  | 'credits'
  | 'timer'
  | 'royalty'
  | 'trophy'
  | 'replay'
  | 'play'
  | 'pause'
  | 'step_back'
  | 'step_fwd'
  | 'check'
  | 'warning'
  | 'critical'
  | 'info'
  | 'close'
  | 'plus'
  | 'minus'
  | 'lock'
  | 'elo'
  | 'map'
  | 'pvp'
  | 'wallet'
  | `tag_${Tag}`;

export interface TileInfo {
  kind: TileKind;
  /** v0 map character, or null for overlays. */
  ch: string | null;
  name: string;
  /** Library thing ids drawn with this tile. */
  things: ThingId[];
  tags: Tag[];
  token: string;
  glyph: string;
}
