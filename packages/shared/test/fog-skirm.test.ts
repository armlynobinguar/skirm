import { describe, expect, it } from 'vitest';
import {
  FOG_MAX_ROUNDS,
  FOG_NO_TILE,
  fogApplyMove,
  fogBand,
  fogDirectionTo,
  fogInitialState,
  fogSanitizeTrap,
  fogSenses,
  fogStart,
  fogTile,
  fogVialCol,
  replayFogGame,
  resolveFogRound,
  verifyFogGame,
  type FogReplayInput,
} from '../src/fog-skirm';

const N = 1;
const E = 2;
const S = 3;
const W = 4;

describe('fog-skirm rules', () => {
  it('moves one tile and stays on an edge or an unknown code', () => {
    expect(fogApplyMove({ row: 0, col: 2 }, S)).toEqual({ row: 1, col: 2 });
    expect(fogApplyMove({ row: 0, col: 2 }, N)).toEqual({ row: 0, col: 2 });
    expect(fogApplyMove({ row: 2, col: 4 }, E)).toEqual({ row: 2, col: 4 });
    expect(fogApplyMove({ row: 2, col: 0 }, W)).toEqual({ row: 2, col: 0 });
    expect(fogApplyMove({ row: 4, col: 1 }, S)).toEqual({ row: 4, col: 1 });
    expect(fogApplyMove({ row: 2, col: 2 }, 9)).toEqual({ row: 2, col: 2 });
  });

  it('maps a clicked tile to a direction only when adjacent', () => {
    expect(fogDirectionTo(7, 2)).toBe(N);
    expect(fogDirectionTo(7, 8)).toBe(E);
    expect(fogDirectionTo(7, 12)).toBe(S);
    expect(fogDirectionTo(7, 6)).toBe(W);
    expect(fogDirectionTo(7, 7)).toBe(0);
    expect(fogDirectionTo(4, 5)).toBeNull(); // wraps a row: not adjacent
    expect(fogDirectionTo(7, 13)).toBeNull();
  });

  it('keeps traps in their band and makes the rest inert', () => {
    expect(fogSanitizeTrap(0, 10)).toBe(10);
    expect(fogSanitizeTrap(0, 19)).toBe(19);
    expect(fogSanitizeTrap(0, 9)).toBe(FOG_NO_TILE);
    expect(fogSanitizeTrap(0, 22)).toBe(FOG_NO_TILE);
    expect(fogSanitizeTrap(1, 5)).toBe(5);
    expect(fogSanitizeTrap(1, 15)).toBe(FOG_NO_TILE);
  });

  it('draws the vial column as random byte mod 5 and bands distances', () => {
    expect([0, 4, 5, 254, 255].map(fogVialCol)).toEqual([0, 4, 0, 4, 0]);
    expect([0, 1, 2, 3, 4, 8].map(fogBand)).toEqual([0, 0, 1, 1, 2, 2]);
    const s = fogInitialState([[10, 11], [5, 6]], 2);
    expect(fogSenses(s)).toEqual({ rival: 2, vial: [1, 1] });
  });

  it('sends a trapped scout home, spends the trap and drops the vial', () => {
    let s = fogInitialState([[17, 18], [5, 6]], 2);
    // Side 1 walks up to the vial (row 2) through col 2: 22 → 17 is trapped.
    const r = resolveFogRound(s, [0, N]);
    expect(r.outcome.trapHit).toBe(true);
    expect(r.private[1].hit).toBe(true);
    expect(r.private[0].hit).toBe(false);
    expect(r.state.pos[1]).toEqual(fogStart(1));
    expect(r.state.traps[0]).toEqual([FOG_NO_TILE, 18]);
    // Spent: the same tile is safe the next time.
    s = r.state;
    expect(resolveFogRound(s, [0, N]).outcome.trapHit).toBe(false);
  });

  it('picks up the vial alone, not when contested, and loses it on a tag', () => {
    const s = fogInitialState([[FOG_NO_TILE, FOG_NO_TILE], [FOG_NO_TILE, FOG_NO_TILE]], 2);
    const placed = { ...s, pos: [{ row: 1, col: 2 }, { row: 3, col: 2 }] as typeof s.pos };
    const contested = resolveFogRound(placed, [S, N]);
    expect(contested.outcome.vialTaken).toBe(false);
    expect(contested.private[0].senseRival).toBe(0);

    const alone = resolveFogRound(placed, [S, 0]);
    expect(alone.outcome.vialTaken).toBe(true);
    expect(alone.state.carrying).toEqual([true, false]);

    const tagged = resolveFogRound(alone.state, [0, N]);
    expect(tagged.state.carrying).toEqual([false, false]);
    expect(tagged.outcome.vialTaken).toBe(false);
  });

  it('plays a full game to a delivery', () => {
    const input: FogReplayInput = {
      traps: [[15, 16], [5, 6]],
      vialCol: 3,
      // Side 0: S, S, E (picks up on 13), N, N (delivers on row 0). Side 1 steps on a trap at 16 in round 2.
      moves: [
        [S, N],
        [S, W],
        [E, 0],
        [N, E],
        [N, 0],
      ],
    };
    const replay = replayFogGame(input);
    expect(replay.rounds.map((r) => r.outcome.vialTaken)).toEqual([false, false, true, true, true]);
    expect(replay.rounds.map((r) => r.outcome.trapHit)).toEqual([false, true, false, false, false]);
    expect(replay.winner).toBe(1);
    expect(fogTile(replay.final.pos[0])).toBe(3);

    const chain = {
      outcomes: replay.rounds.map((r) => r.outcome),
      winner: 1 as const,
      endReason: 'delivered',
      finalTiles: [fogTile(replay.final.pos[0]), fogTile(replay.final.pos[1])] as [number, number],
    };
    expect(verifyFogGame(input, chain).every((c) => c.ok)).toBe(true);

    // A tampered outcome or final tile fails its check.
    const forged = { ...chain, outcomes: chain.outcomes.map((o, i) => (i === 1 ? { ...o, trapHit: !o.trapHit } : o)) };
    expect(verifyFogGame(input, forged).find((c) => c.id === 'outcomes')?.ok).toBe(false);
    expect(verifyFogGame(input, { ...chain, finalTiles: [2, 22] }).find((c) => c.id === 'final')?.ok).toBe(false);
  });

  it('ends after the last round with no delivery as a draw', () => {
    const moves = Array.from({ length: FOG_MAX_ROUNDS + 3 }, () => [0, 0] as const);
    const replay = replayFogGame({ traps: [[10, 11], [5, 6]], vialCol: 0, moves });
    expect(replay.rounds).toHaveLength(FOG_MAX_ROUNDS);
    expect(replay.winner).toBe(0);
  });
});
