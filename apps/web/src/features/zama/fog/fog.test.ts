import { FOG_NO_TILE, fogTile, replayFogGame, type FogOutcome } from '@skirm/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: '', explorerUrl: '', contracts: { credits: null, match: null, fog: null } },
  parseAddress: (v: string) => (/^0x[0-9a-fA-F]{40}$/.test(v) ? v : null),
}));

import { boardCells, displayOrder, togglePick } from './board';
import {
  fogAddress,
  finalizePendingRound,
  logEntries,
  parseGame,
  parseGameId,
  revealEndedGame,
  secondsLeft,
  sideOf,
  verifyGameOnChain,
  type FogApi,
  type FogGame,
  type FogRevealed,
} from './fog';

const A = '0x00000000000000000000000000000000000000a1';
const B = '0x00000000000000000000000000000000000000b2';

const game = (over: Partial<FogGame> = {}): FogGame => ({
  id: 7n,
  players: [A, B],
  status: 'playing',
  round: 2,
  roundsPlayed: 1,
  awaitingReveal: false,
  moved: [false, false],
  moveWindow: 600,
  deadline: 1_000,
  winner: 0,
  endReason: 'none',
  revealed: false,
  ...over,
});

/** A FogApi whose every method is a spy; `state` is what read() returns. */
function fakeApi(state: { game: FogGame }, over: Partial<FogApi> = {}): FogApi {
  return {
    read: vi.fn(async () => state.game),
    create: vi.fn(async () => 1n),
    join: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    claimTimeout: vi.fn(async () => undefined),
    roundHandles: vi.fn(async () => ['0x01', '0x02', '0x03'] as `0x${string}`[]),
    finalizeRound: vi.fn(async () => undefined),
    playerView: vi.fn(),
    outcomes: vi.fn(async () => []),
    revealHandles: vi.fn(async () => ['0x0a'] as `0x${string}`[]),
    finalizeGameReveal: vi.fn(async () => undefined),
    replay: vi.fn(),
    ...over,
  };
}

const relayer = () => ({
  publicDecrypt: vi.fn(async (handles: string[]) => ({
    clearValues: Object.fromEntries(handles.map((h) => [h, 0n])),
    abiEncodedClearValues: '0xc1ea' as `0x${string}`,
    decryptionProof: '0x9f00' as `0x${string}`,
  })),
});

describe('fog client', () => {
  it('maps the contract tuple and finds the player side', () => {
    const g = parseGame(3n, {
      players: [A.toUpperCase().replace('0X', '0x'), B],
      status: 2n,
      round: 4n,
      roundsPlayed: 3n,
      awaitingReveal: true,
      moved: [true, false],
      moveWindow: 300n,
      deadline: 99n,
      winner: 0n,
      endReason: 0n,
      revealed: false,
    });
    expect(g).toMatchObject({ id: 3n, status: 'playing', round: 4, roundsPlayed: 3, awaitingReveal: true, moved: [true, false], endReason: 'none' });
    expect(sideOf(g, A)).toBe(0);
    expect(sideOf(g, B.toUpperCase().replace('0X', '0x'))).toBe(1);
    expect(sideOf(g, '0x0000000000000000000000000000000000000001')).toBeNull();
    expect(sideOf(g, null)).toBeNull();
  });

  it('parses game ids from text and links', () => {
    expect(parseGameId('7')).toBe(7n);
    expect(parseGameId(' #12 ')).toBe(12n);
    expect(parseGameId('https://skirm.gg/fog?game=31')).toBe(31n);
    expect(parseGameId('0')).toBeNull();
    expect(parseGameId('abc')).toBeNull();
  });

  it('says the contract is not deployed without an address', () => {
    expect(() => fogAddress()).toThrow(/not deployed/);
  });

  it('counts down to the deadline without going negative', () => {
    expect(secondsLeft(100, 40_000)).toBe(60);
    expect(secondsLeft(100, 200_000)).toBe(0);
  });

  it('writes a round log from the public outcomes', () => {
    const o: FogOutcome[] = [
      { trapHit: false, vialTaken: false, winner: 0 },
      { trapHit: true, vialTaken: false, winner: 0 },
      { trapHit: false, vialTaken: true, winner: 0 },
      { trapHit: true, vialTaken: false, winner: 0 },
      { trapHit: false, vialTaken: true, winner: 0 },
      { trapHit: false, vialTaken: true, winner: 2 },
    ];
    const log = logEntries(o, 1);
    expect(log.map((e) => e.tone)).toEqual(['quiet', 'trap', 'vial', 'drop', 'vial', 'win']);
    expect(log[3]!.text).toMatch(/flood switch.*knocked loose/);
    expect(log[5]!.text).toMatch(/You delivered/);
    expect(logEntries(o, 0)[5]!.text).toMatch(/Your rival delivered/);
  });

  it('publishes a resolved round with the relayer proof, and treats a lost race as done', async () => {
    const state = { game: game({ awaitingReveal: true }) };
    const api = fakeApi(state);
    const inst = relayer();
    await expect(finalizePendingRound(api, inst as never, 7n)).resolves.toBe(true);
    expect(inst.publicDecrypt).toHaveBeenCalledWith(['0x01', '0x02', '0x03']);
    expect(api.finalizeRound).toHaveBeenCalledWith(7n, '0xc1ea', '0x9f00');

    // The rival's tab finalized first: our tx reverts, the re-read shows the round published.
    const raced = fakeApi(state, {
      finalizeRound: vi.fn(async () => {
        state.game = game({ roundsPlayed: 2, round: 3 });
        throw new Error('NotAwaitingReveal');
      }),
    });
    state.game = game({ awaitingReveal: true });
    await expect(finalizePendingRound(raced, inst as never, 7n)).resolves.toBe(false);

    // Nothing pending: no call at all.
    const idle = fakeApi({ game: game() });
    await expect(finalizePendingRound(idle, inst as never, 7n)).resolves.toBe(false);
    expect(idle.roundHandles).not.toHaveBeenCalled();
  });

  it('reveals an ended game once and verifies the replay against the chain record', async () => {
    const input = { traps: [[15, 16], [5, 6]] as [[number, number], [number, number]], vialCol: 3, moves: [[3, 1], [3, 4], [2, 0], [1, 2], [1, 0]] as [number, number][] };
    const replay = replayFogGame(input);
    const revealed: FogRevealed = { ...input, finalTiles: [fogTile(replay.final.pos[0]), fogTile(replay.final.pos[1])] };
    const state = { game: game({ status: 'ended', winner: 1, endReason: 'delivered', roundsPlayed: 5, round: 5 }) };
    const api = fakeApi(state, {
      finalizeGameReveal: vi.fn(async () => {
        state.game = { ...state.game, revealed: true };
      }),
      replay: vi.fn(async () => revealed),
      outcomes: vi.fn(async () => replay.rounds.map((r) => r.outcome)),
    });
    await expect(revealEndedGame(api, relayer() as never, 7n)).resolves.toEqual(revealed);
    expect(api.finalizeGameReveal).toHaveBeenCalledTimes(1);
    await revealEndedGame(api, relayer() as never, 7n);
    expect(api.finalizeGameReveal).toHaveBeenCalledTimes(1);

    const ok = await verifyGameOnChain(api, 7n);
    expect(ok.checks.every((c) => c.ok)).toBe(true);

    // The chain says side 2 won: the replay disagrees.
    state.game = { ...state.game, winner: 2 };
    const bad = await verifyGameOnChain(api, 7n);
    expect(bad.checks.find((c) => c.id === 'winner')?.ok).toBe(false);
  });
});

describe('fog board', () => {
  it('puts the player home row at the bottom', () => {
    expect(displayOrder(1).slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(displayOrder(0).slice(0, 5)).toEqual([20, 21, 22, 23, 24]);
    expect(displayOrder(0).slice(-5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('marks the scout, legal moves, traps, the ghost move and the revealed board', () => {
    const view = { tile: 7, carrying: false, hit: false, senseVial: 1 as const, senseRival: 2 as const, trapsPlaced: [12, 3] as [number, number], trapsLive: [FOG_NO_TILE, FOG_NO_TILE] as [number, number] };
    const cells = boardCells({ side: 0, view, canMove: true, pendingMove: null });
    const at = (t: number) => cells.find((c) => c.tile === t)!;
    expect(at(7).mine).toBe(true);
    expect([2, 6, 8, 12].map((t) => at(t).move)).toEqual([1, 4, 2, 3]);
    expect(at(13).move).toBeNull();
    expect(at(7).move).toBeNull();
    expect(at(12).myTrap).toBe('spent');
    expect(at(2).homeMine).toBe(true);
    expect(at(22).homeRival).toBe(true);
    expect(at(11).vialRow).toBe(true);

    const sealed = boardCells({ side: 0, view, canMove: false, pendingMove: 3 });
    expect(sealed.find((c) => c.tile === 12)!.ghost).toBe(true);
    expect(sealed.every((c) => c.move === null)).toBe(true);

    const end = boardCells({ side: 0, view, revealed: { traps: [[12, 3], [5, 9]], vialCol: 1, finalTiles: [7, 17], moves: [] } });
    expect(end.find((c) => c.tile === 9)!.revealedRivalTrap).toBe(true);
    expect(end.find((c) => c.tile === 11)!.revealedVial).toBe(true);
    expect(end.find((c) => c.tile === 17)!.revealedRival).toBe(true);
  });

  it('limits trap picks to two tiles in the side band', () => {
    const cells = boardCells({ side: 1, setupPicks: [5] });
    expect(cells.filter((c) => c.plantable).map((c) => c.tile).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(cells.find((c) => c.tile === 5)!.picked).toBe(true);
    expect(togglePick([5], 6)).toEqual([5, 6]);
    expect(togglePick([5, 6], 7)).toEqual([6, 7]);
    expect(togglePick([5, 6], 5)).toEqual([6]);
  });
});
