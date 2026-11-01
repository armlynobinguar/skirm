// Engine vocabulary as display data (design system bundle, renamed). Tags, actions and
// thing tags come from @skirm/shared and Game Spec §2; this file only adds UI wording.
import { ACTION_KINDS, TAGS, type ActionKind, type Tag, type ThingId } from '@skirm/shared';
import type { IconName, TileInfo, UnlockName } from './types';

export { TAGS };
export const ACTIONS: readonly ActionKind[] = ACTION_KINDS;

export const TAG_MEANING: Readonly<Record<Tag, string>> = {
  spreads: 'Grows into neighbouring tiles over time',
  liquid: 'Agents cannot walk into it; water puts out fire',
  damages: 'Removes an agent on the same tile',
  solid: 'Agents cannot walk into it',
  blocks: 'Stops anything that spreads',
  pushable: 'Moves one tile when an agent walks into it',
  breakable: 'Removed by dig',
  flammable: 'Fire can spread onto it, destroying it',
  collectible: 'Can be picked up into an agent’s inventory',
  goal: 'Reaching or collecting it can end the match',
};

export const UNLOCKS: Readonly<Record<UnlockName, { action: ActionKind; icon: IconName }>> = {
  Builder: { action: 'place_block', icon: 'place_block' },
  Digger: { action: 'dig', icon: 'dig' },
  Firefighter: { action: 'extinguish', icon: 'extinguish' },
};

/** Library tags per thing id (Game Spec §2, "Things built from tags"). */
export const THING_TAGS: Readonly<Record<ThingId, readonly Tag[]>> = {
  water: ['spreads', 'liquid'],
  lava: ['spreads', 'liquid', 'damages'],
  fire: ['spreads', 'damages'],
  wall: ['solid', 'blocks'],
  block: ['solid', 'blocks'],
  dirt: ['solid', 'blocks', 'breakable'],
  crate: ['solid', 'pushable', 'flammable'],
  grass: ['flammable'],
  gem: ['collectible'],
  key: ['collectible'],
  crystal: ['collectible'],
  exit: ['goal'],
  flag: ['goal'],
};

/** Player-facing thing names. */
export const THING_NAME: Readonly<Record<ThingId, string>> = {
  water: 'water',
  lava: 'lava',
  fire: 'fire',
  wall: 'stone wall',
  block: 'placed block',
  dirt: 'dirt',
  crate: 'wooden crate',
  grass: 'grass',
  gem: 'gem',
  key: 'key',
  crystal: 'crystal',
  exit: 'exit',
  flag: 'flag',
};

/** One entry per thing in the tags table: map char ↔ library thing(s) ↔ tags. */
export const TILES: readonly TileInfo[] = [
  { kind: 'floor', ch: '.', name: 'Floor', things: [], tags: [], token: 'tile-floor', glyph: 'none (open tile)' },
  { kind: 'wall', ch: '#', name: 'Stone wall', things: ['wall'], tags: ['solid', 'blocks'], token: 'tile-wall', glyph: 'brick joints' },
  { kind: 'water', ch: '~', name: 'Water', things: ['water'], tags: ['spreads', 'liquid'], token: 'tile-water', glyph: 'two waves' },
  { kind: 'lava', ch: 'L', name: 'Lava', things: ['lava'], tags: ['spreads', 'liquid', 'damages'], token: 'tile-lava', glyph: 'glowing crack' },
  { kind: 'fire', ch: '^', name: 'Fire', things: ['fire'], tags: ['spreads', 'damages'], token: 'tile-fire', glyph: 'flame' },
  { kind: 'grass', ch: ',', name: 'Grass', things: ['grass'], tags: ['flammable'], token: 'tile-grass', glyph: 'three tufts' },
  { kind: 'crate', ch: 'c', name: 'Wooden crate', things: ['crate'], tags: ['solid', 'pushable', 'flammable'], token: 'tile-crate', glyph: 'frame and X brace' },
  { kind: 'dirt', ch: 'd', name: 'Dirt', things: ['dirt'], tags: ['solid', 'blocks', 'breakable'], token: 'tile-dirt', glyph: 'stipple' },
  { kind: 'block', ch: '=', name: 'Placed block', things: ['block'], tags: ['solid', 'blocks'], token: 'tile-block', glyph: 'inset frame and plus' },
  { kind: 'gem', ch: '*', name: 'Gem, key, crystal', things: ['gem', 'key', 'crystal'], tags: ['collectible'], token: 'tile-gem', glyph: 'faceted diamond' },
  { kind: 'exit', ch: 'E', name: 'Exit', things: ['exit', 'flag'], tags: ['goal'], token: 'tile-exit', glyph: 'door arch' },
  { kind: 'agent', ch: '0', name: 'Agent', things: [], tags: [], token: 'tile-agent', glyph: 'round body, >_ face' },
  { kind: 'mark', ch: null, name: 'Critical spot', things: [], tags: [], token: 'tile-mark', glyph: 'pink corner brackets' },
];

/** Stroke icons on a 16-unit grid, 1.5 stroke, round caps; drawn in currentColor. */
export const ICONS: Readonly<Record<IconName, string>> = {
  move: 'M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6 2 8l2 2M12 6l2 2-2 2',
  wait: 'M4.5 2h7M4.5 14h7M5.5 2v1.6c0 2 5 2.4 5 4.4s-5 2.4-5 4.4V14M10.5 2v1.6c0 2-5 2.4-5 4.4s5 2.4 5 4.4V14',
  pick_up: 'M8 10V2.5M5 5.5l3-3 3 3M2.5 10v3.5h11V10',
  drop: 'M8 2.5V10M5 7l3 3 3-3M2.5 10v3.5h11V10',
  place_block: 'M2.5 2.5h11v11h-11zM8 5.2v5.6M5.2 8h5.6',
  dig: 'M2.5 6.2C5 3.2 11 3.2 13.5 6.2M8 4.4V14',
  extinguish: 'M8 2s4.5 4.9 4.5 7.9a4.5 4.5 0 0 1-9 0C3.5 6.9 8 2 8 2zM6.2 10.6l3.6-3.6',
  tick: 'M1.5 8.5h2.5l1.5-4 3 7.5 1.5-3.5h4.5',
  steps: 'M2.5 13.5H6V10h3.5V6.5H13V3',
  agent: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM5.3 6.2 7 7.9 5.3 9.6M8.4 10h2.6',
  crew: 'M5.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM11 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  skill: 'M2.5 2.5h11v11h-11zM5 6l2 2-2 2M8.4 10.4H11',
  credits:
    'M8 5.5c3 0 5.5-.9 5.5-2s-2.5-2-5.5-2-5.5.9-5.5 2 2.5 2 5.5 2zM2.5 3.5v4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-4M2.5 7.5v4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-4',
  timer: 'M8 15a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 6.8v2.8l1.8 1.1M6.3 1.5h3.4M12.4 4.6l1.1-1.1',
  royalty:
    'M12.5 3.5l-9 9M4.8 6.3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM11.2 12.7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  trophy:
    'M5 2.5h6V6a3 3 0 0 1-6 0zM5 3.5H2.5V5A2.5 2.5 0 0 0 5 7.5M11 3.5h2.5V5A2.5 2.5 0 0 1 11 7.5M8 9v3M5.5 14h5M6.5 12h3',
  replay: 'M2.6 8.6a5.5 5.5 0 1 0 1.5-4.5M3 1.8v3h3',
  play: 'M5 3l8 5-8 5z',
  pause: 'M5.5 3v10M10.5 3v10',
  step_back: 'M4 3v10M13 3 6.5 8l6.5 5z',
  step_fwd: 'M12 3v10M3 3l6.5 5L3 13z',
  check: 'M3 8.5l3 3 7-7',
  warning: 'M8 2 14.5 13.5h-13zM8 6.5v3.2M8 11.8v.2',
  critical: 'M5.5 1.5h5l4 4v5l-4 4h-5l-4-4v-5zM6 6l4 4M10 6l-4 4',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v4M8 4.8v.2',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  lock: 'M3.5 7.5h9v6.5h-9zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
  elo: 'M3 9.5 8 5l5 4.5M3 13.5 8 9l5 4.5',
  map: 'M2.5 2.5h11v11h-11zM2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11',
  pvp: 'M2.5 2.5 10 10M13.5 2.5 6 10M9 12l3.5 1.5L11 10M7 12l-3.5 1.5L5 10',
  wallet: 'M2.5 4.5h10.5v9H2.5zM2.5 4.5l8-2v2M10 9h3',
  tag_spreads: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3',
  tag_liquid:
    'M1.5 6c1.6-1.5 3.3-1.5 4.3 0s2.7 1.5 4.3 0 3.3-1.5 4.4 0M1.5 10.5c1.6-1.5 3.3-1.5 4.3 0s2.7 1.5 4.3 0 3.3-1.5 4.4 0',
  tag_damages: 'M9 1.5 4 9h4l-1 5.5L12 7H8z',
  tag_solid: 'M2.5 2.5h11v11h-11zM2.5 8 8 2.5M2.5 13.5l11-11M8 13.5 13.5 8',
  tag_blocks: 'M2 3.5h12v9H2zM2 8h12M6 3.5V8M10 8v4.5',
  tag_pushable: 'M7.5 4.5h6v7h-6zM1.5 8h4M3.6 6l2 2-2 2',
  tag_breakable: 'M2.5 2.5h11v11h-11zM8.5 2.5 7 6l2.5 2-2 2.5.6 3',
  tag_flammable:
    'M8 1.8c2.6 3 4.7 5 4.2 8.2-.4 2.5-2.3 4-4.2 4s-3.8-1.5-4.2-4c-.3-2 1-3 2-4.5.3 1.5 1 2.3 1.6 2.6C7.2 6.1 7.5 4 8 1.8z',
  tag_collectible: 'M8 2l5 5-5 7-5-7zM3 7h10',
  tag_goal: 'M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5',
};

export const FILLED_ICONS: ReadonlySet<IconName> = new Set<IconName>(['play']);

/** Motion tokens in ms (tokens.json), for the per-tick budget. */
export const DURATION = { fast: 120, base: 200, step: 180, spread: 320, loop: 1600, toast: 5000, lost: 400 } as const;
