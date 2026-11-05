// Screen point → board tile for the live match (hybrid control's click-to-move). The arena canvas
// records where it last drew the board (setArenaProjection); tileAtPoint inverts the isometric
// projection the renderer uses (proto/world.ts renderArena: P(x, y) = [ox + (x − y)·T/2,
// oy + (x + y)·T/4], tile tops `slab` above). Null while no live board is drawn flat (third person
// tilts it with CSS, so clicks there pick nothing).

export interface ArenaProjection {
  ox: number;
  oy: number;
  /** Tile width in CSS pixels. */
  T: number;
  /** Height of a tile's top above its base. */
  slab: number;
  w: number;
  h: number;
}

let projection: ArenaProjection | null = null;

export function setArenaProjection(p: ArenaProjection | null): void {
  projection = p;
}

/** The board tile under a viewport point, or null (no live board, or off the board). */
export function tileAtPoint(px: number, py: number, p: ArenaProjection | null = projection): [number, number] | null {
  if (!p || p.T <= 0) return null;
  const u = (px - p.ox) / (p.T / 2);
  const v = (py + p.slab - p.oy) / (p.T / 4);
  const x = Math.round((u + v) / 2);
  const y = Math.round((v - u) / 2);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return null;
  return [x, y];
}
