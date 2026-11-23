// The 5x5 Fog Skirm board as the screen draws it: one cell model per tile, from what this player
// knows (its own decrypted view) and, once the game is over, from the revealed board. Pure.
import {
  FOG_SIZE,
  FOG_TILES,
  FOG_VIAL_ROW,
  fogApplyMove,
  fogDirectionTo,
  fogHomeRow,
  fogPosOf,
  fogTile,
  fogTrapBand,
  fogVialTile,
  type FogDirection,
  type FogSide,
} from '@skirm/shared';
import { liveTile, type FogRevealed, type FogView } from './fog';

export interface FogCell {
  tile: number;
  row: number;
  col: number;
  /** This player's scout is here. */
  mine: boolean;
  /** Where this player's sealed move will land (prediction from the rules). */
  ghost: boolean;
  /** One of this player's traps: live, spent (it caught the rival) or none. */
  myTrap: 'live' | 'spent' | null;
  /** A legal move target (click to move), with its direction. */
  move: FogDirection | null;
  homeMine: boolean;
  homeRival: boolean;
  vialRow: boolean;
  /** Setup: a tile this player's traps count on. */
  plantable: boolean;
  /** Setup: picked as a trap. */
  picked: boolean;
  /** After the reveal: the rival's trap, the vial, the rival's final scout. */
  revealedRivalTrap: boolean;
  revealedVial: boolean;
  revealedRival: boolean;
}

export interface BoardInput {
  side: FogSide;
  view?: FogView | null;
  /** Clickable targets around the scout (the player still has to move this round). */
  canMove?: boolean;
  /** The sealed move this round, for the ghost. */
  pendingMove?: number | null;
  /** Setup: the traps picked so far. */
  setupPicks?: readonly number[];
  revealed?: FogRevealed | null;
}

/** Tiles in display order: the player's home row at the bottom (side 0 sees the board flipped). */
export function displayOrder(side: FogSide): number[] {
  const rows = Array.from({ length: FOG_SIZE }, (_, r) => r);
  if (side === 0) rows.reverse();
  return rows.flatMap((r) => Array.from({ length: FOG_SIZE }, (_, c) => r * FOG_SIZE + c));
}

export function boardCells(input: BoardInput): FogCell[] {
  const { side, view, revealed } = input;
  const rival = (1 - side) as FogSide;
  const band = fogTrapBand(side);
  const picks = input.setupPicks ?? null;
  const ghost =
    view && input.pendingMove !== undefined && input.pendingMove !== null ? fogTile(fogApplyMove(fogPosOf(view.tile), input.pendingMove)) : null;
  const placed = view ? view.trapsPlaced : null;
  const live = view ? view.trapsLive.map(liveTile) : [];
  return displayOrder(side).map((tile) => {
    const { row, col } = fogPosOf(tile);
    let myTrap: FogCell['myTrap'] = null;
    if (placed) {
      const k = placed.findIndex((t) => t === tile);
      if (k >= 0) myTrap = live[k] === tile ? 'live' : 'spent';
    }
    const dir = view && input.canMove ? fogDirectionTo(view.tile, tile) : null;
    return {
      tile,
      row,
      col,
      mine: !!view && view.tile === tile,
      ghost: ghost !== null && ghost === tile && ghost !== view?.tile,
      myTrap,
      move: dir !== null && dir !== 0 ? dir : null,
      homeMine: row === fogHomeRow(side),
      homeRival: row === fogHomeRow(rival),
      vialRow: row === FOG_VIAL_ROW,
      plantable: picks !== null && tile >= band.lo && tile <= band.hi,
      picked: !!picks?.includes(tile),
      revealedRivalTrap: !!revealed && revealed.traps[rival].includes(tile),
      revealedVial: !!revealed && fogVialTile(revealed.vialCol) === tile,
      revealedRival: !!revealed && revealed.finalTiles[rival] === tile,
    };
  });
}

/** Toggles a setup pick: at most two distinct tiles, oldest dropped first. */
export function togglePick(picks: readonly number[], tile: number, max = 2): number[] {
  if (picks.includes(tile)) return picks.filter((t) => t !== tile);
  return [...picks, tile].slice(-max);
}

export const isTile = (t: number) => Number.isInteger(t) && t >= 0 && t < FOG_TILES;

