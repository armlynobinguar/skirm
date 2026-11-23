// Fog Skirm rules (Zama FHEVM, packages/fhevm FogSkirm.sol), in plain TypeScript. The contract runs
// these rules on ciphertexts; this module runs them on plaintexts, step for step, so the web can
// predict a move and anyone can replay a revealed game and compare it with the on-chain record.
// It has no runtime imports (packages/fhevm's Hardhat tests load it as CommonJS).
//
// Board: 5x5, tile = row * 5 + col. Side 0 starts on (0, 2), home row 0; side 1 on (4, 2), home row 4.
// The seed vial lies on (2, vialCol). Moves: 0 stay, 1 north (row - 1), 2 east (col + 1),
// 3 south (row + 1), 4 west (col - 1); off the board or any other code means stay.
// A round resolves, for both scouts at once: move → traps → tag → pickup → delivery.

export const FOG_SIZE = 5;
export const FOG_TILES = FOG_SIZE * FOG_SIZE;
export const FOG_MAX_ROUNDS = 10;
export const FOG_TRAPS = 2;
/** A spent or invalid trap. */
export const FOG_NO_TILE = 255;
export const FOG_VIAL_ROW = 2;
export const FOG_START_COL = 2;

export type FogSide = 0 | 1;
/** 0 stay, 1 north, 2 east, 3 south, 4 west. */
export type FogDirection = 0 | 1 | 2 | 3 | 4;
export const FOG_DIRECTIONS = { stay: 0, north: 1, east: 2, south: 3, west: 4 } as const;

/** Sense bands, by Manhattan distance: 0 adjacent (<= 1), 1 near (2-3), 2 far (4+). */
export type FogSense = 0 | 1 | 2;
export const FOG_SENSE = { adjacent: 0, near: 1, far: 2 } as const;

/** 0 no winner (draw while ended), 1 side 0, 2 side 1. */
export type FogWinner = 0 | 1 | 2;

export interface FogPos {
  row: number;
  col: number;
}

export interface FogState {
  pos: [FogPos, FogPos];
  carrying: [boolean, boolean];
  /** Live traps by planter: traps[owner] can only catch the other side. */
  traps: [number[], number[]];
  vialCol: number;
}

/** What a round makes public (KMS-verified on chain). */
export interface FogOutcome {
  trapHit: boolean;
  vialTaken: boolean;
  winner: FogWinner;
}

/** What each side privately reads after a round. */
export interface FogPrivate {
  hit: boolean;
  /** Band to the vial's resting tile. */
  senseVial: FogSense;
  /** Band to the rival scout (the same for both sides). */
  senseRival: FogSense;
}

export interface FogRoundResult {
  state: FogState;
  outcome: FogOutcome;
  private: [FogPrivate, FogPrivate];
}

export const fogTile = (p: FogPos): number => p.row * FOG_SIZE + p.col;
export const fogPosOf = (tile: number): FogPos => ({ row: Math.floor(tile / FOG_SIZE), col: tile % FOG_SIZE });
export const fogHomeRow = (side: FogSide): number => (side === 0 ? 0 : FOG_SIZE - 1);
export const fogStart = (side: FogSide): FogPos => ({ row: fogHomeRow(side), col: FOG_START_COL });
export const fogVialTile = (vialCol: number): number => FOG_VIAL_ROW * FOG_SIZE + vialCol;

/** The tiles a side's traps count on: side 0 rows 2-3 (10..19), side 1 rows 1-2 (5..14). */
export function fogTrapBand(owner: FogSide): { lo: number; hi: number } {
  return owner === 0 ? { lo: 10, hi: 19 } : { lo: 5, hi: 14 };
}

/** A planted trap as the contract keeps it: in its band, else inert (NO_TILE). */
export function fogSanitizeTrap(owner: FogSide, tile: number): number {
  const { lo, hi } = fogTrapBand(owner);
  return tile >= lo && tile <= hi ? tile : FOG_NO_TILE;
}

/** The vial column from the raw FHE random byte (randEuint8 mod 5). */
export const fogVialCol = (byte: number): number => (byte & 0xff) % FOG_SIZE;

export function fogInitialState(traps: [readonly number[], readonly number[]], vialCol: number): FogState {
  return {
    pos: [fogStart(0), fogStart(1)],
    carrying: [false, false],
    traps: [traps[0].map((t) => fogSanitizeTrap(0, t)), traps[1].map((t) => fogSanitizeTrap(1, t))],
    vialCol,
  };
}

/** One step; off the board or an unknown code stays put. */
export function fogApplyMove(p: FogPos, dir: number): FogPos {
  let { row, col } = p;
  if (dir === 1 && row > 0) row -= 1;
  if (dir === 3 && row < FOG_SIZE - 1) row += 1;
  if (dir === 2 && col < FOG_SIZE - 1) col += 1;
  if (dir === 4 && col > 0) col -= 1;
  return { row, col };
}

/** The direction from `from` to an adjacent `to` (or the same tile: stay), else null. */
export function fogDirectionTo(from: number, to: number): FogDirection | null {
  const a = fogPosOf(from);
  const b = fogPosOf(to);
  if (from === to) return 0;
  if (a.col === b.col && b.row === a.row - 1) return 1;
  if (a.row === b.row && b.col === a.col + 1) return 2;
  if (a.col === b.col && b.row === a.row + 1) return 3;
  if (a.row === b.row && b.col === a.col - 1) return 4;
  return null;
}

export const fogDistance = (a: FogPos, b: FogPos): number => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);

export function fogBand(d: number): FogSense {
  return d <= 1 ? 0 : d <= 3 ? 1 : 2;
}

/** Each side's sense pings for a state (what the contract computes after setup and every round). */
export function fogSenses(s: FogState): { rival: FogSense; vial: [FogSense, FogSense] } {
  const vial = { row: FOG_VIAL_ROW, col: s.vialCol };
  return { rival: fogBand(fogDistance(s.pos[0], s.pos[1])), vial: [fogBand(fogDistance(s.pos[0], vial)), fogBand(fogDistance(s.pos[1], vial))] };
}

/** Resolves a round exactly as FogSkirm._resolve does. Does not mutate `s`. */
export function resolveFogRound(s: FogState, moves: readonly [number, number]): FogRoundResult {
  const pos: [FogPos, FogPos] = [fogApplyMove(s.pos[0], moves[0]), fogApplyMove(s.pos[1], moves[1])];
  const carrying: [boolean, boolean] = [...s.carrying];
  const traps: [number[], number[]] = [[...s.traps[0]], [...s.traps[1]]];

  // Traps: each scout against the rival's live traps.
  const hit: [boolean, boolean] = [false, false];
  for (const side of [0, 1] as const) {
    const rival = 1 - side;
    const tile = fogTile(pos[side]);
    traps[rival] = traps[rival]!.map((t) => {
      if (t !== tile) return t;
      hit[side] = true;
      return FOG_NO_TILE;
    });
    if (hit[side]) {
      pos[side] = fogStart(side);
      carrying[side] = false;
    }
  }

  // Tag: sharing a tile knocks the vial loose.
  if (fogTile(pos[0]) === fogTile(pos[1])) carrying[0] = carrying[1] = false;

  // Pickup: alone on the vial tile while it lies free.
  const free = !carrying[0] && !carrying[1];
  const v = fogVialTile(s.vialCol);
  const on0 = fogTile(pos[0]) === v;
  const on1 = fogTile(pos[1]) === v;
  if (free && on0 && !on1) carrying[0] = true;
  if (free && on1 && !on0) carrying[1] = true;

  // Delivery.
  const won0 = carrying[0] && pos[0].row === fogHomeRow(0);
  const won1 = carrying[1] && pos[1].row === fogHomeRow(1);

  const state: FogState = { pos, carrying, traps, vialCol: s.vialCol };
  const sense = fogSenses(state);
  return {
    state,
    outcome: { trapHit: hit[0] || hit[1], vialTaken: carrying[0] || carrying[1], winner: won0 ? 1 : won1 ? 2 : 0 },
    private: [
      { hit: hit[0], senseVial: sense.vial[0], senseRival: sense.rival },
      { hit: hit[1], senseVial: sense.vial[1], senseRival: sense.rival },
    ],
  };
}

/** A revealed game: what FogSkirm.finalizeGameReveal stores. */
export interface FogReplayInput {
  /** As planted (before sanitizing), side 0 then side 1. */
  traps: [readonly number[], readonly number[]];
  vialCol: number;
  /** [side 0, side 1] per finalized round. */
  moves: readonly (readonly [number, number])[];
}

export interface FogReplay {
  rounds: FogRoundResult[];
  final: FogState;
  /** 0 draw / none, else the side + 1 that delivered. */
  winner: FogWinner;
}

/** Replays a revealed game from the start. Stops at the first delivery, like the contract. */
export function replayFogGame(input: FogReplayInput): FogReplay {
  let state = fogInitialState(input.traps, input.vialCol);
  const rounds: FogRoundResult[] = [];
  let winner: FogWinner = 0;
  for (const m of input.moves.slice(0, FOG_MAX_ROUNDS)) {
    const r = resolveFogRound(state, m);
    rounds.push(r);
    state = r.state;
    if (r.outcome.winner !== 0) {
      winner = r.outcome.winner;
      break;
    }
  }
  return { rounds, final: state, winner };
}

/** One check of a revealed game against the chain. */
export interface FogCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** The on-chain record a replay is checked against. */
export interface FogChainRecord {
  /** KMS-verified outcome per finalized round, in order. */
  outcomes: readonly FogOutcome[];
  winner: FogWinner;
  /** 'delivered' | 'max_rounds' | 'timeout'. */
  endReason: string;
  /** Final tiles as revealed by the KMS (side 0, side 1). */
  finalTiles: readonly [number, number];
}

/** Compares a replay of the revealed history with the on-chain record. Pure. */
export function verifyFogGame(input: FogReplayInput, chain: FogChainRecord): FogCheck[] {
  const checks: FogCheck[] = [];
  const replay = replayFogGame(input);
  checks.push({
    id: 'vial',
    label: 'Vial in the middle row',
    ok: Number.isInteger(input.vialCol) && input.vialCol >= 0 && input.vialCol < FOG_SIZE,
    detail: `column ${input.vialCol} (tile ${fogVialTile(input.vialCol)})`,
  });
  checks.push({
    id: 'rounds',
    label: 'Every round replayed',
    ok: replay.rounds.length === chain.outcomes.length && input.moves.length === chain.outcomes.length,
    detail: `${replay.rounds.length} replayed, ${chain.outcomes.length} on chain`,
  });
  const bad = chain.outcomes.findIndex((o, i) => {
    const r = replay.rounds[i]?.outcome;
    return !r || r.trapHit !== o.trapHit || r.vialTaken !== o.vialTaken || r.winner !== o.winner;
  });
  checks.push({
    id: 'outcomes',
    label: 'Public outcomes match the replay',
    ok: bad === -1,
    detail: bad === -1 ? 'trap hits, vial carries and the winner agree every round' : `round ${bad + 1} differs`,
  });
  const tiles = [fogTile(replay.final.pos[0]), fogTile(replay.final.pos[1])];
  checks.push({
    id: 'final',
    label: 'Final positions match',
    ok: tiles[0] === chain.finalTiles[0] && tiles[1] === chain.finalTiles[1],
    detail: `replay ${tiles.join(' / ')}, chain ${chain.finalTiles.join(' / ')}`,
  });
  if (chain.endReason !== 'timeout') {
    checks.push({
      id: 'winner',
      label: 'Winner matches',
      ok: replay.winner === chain.winner,
      detail: `replay ${replay.winner}, chain ${chain.winner}`,
    });
  }
  return checks;
}
