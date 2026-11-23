// The Fog Skirm screen against a fake FogSkirm: the board, a move, publishing a round, the lobby and
// the game-over verification. The relayer SDK is never loaded (the instance is a stub).
import { FOG_NO_TILE, fogTile, replayFogGame } from '@skirm/shared';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const m = vi.hoisted(() => ({
  decryptView: vi.fn(),
  finalizePendingRound: vi.fn(async () => true),
  encryptU8s: vi.fn(async (_i: unknown, _c: string, _u: string, values: readonly number[]) => ({
    handles: values.map((_, i) => `0x${String(i + 1).padStart(64, '0')}` as `0x${string}`),
    inputProof: '0xpr00f' as `0x${string}`,
  })),
}));

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: '', explorerUrl: '', contracts: { credits: null, match: null, fog: '0x00000000000000000000000000000000000000f0' } },
  parseAddress: (v: string) => (/^0x[0-9a-fA-F]{40}$/.test(v) ? v : null),
}));
vi.mock('@/lib/zama/fhe', async (orig) => ({ ...(await orig<typeof import('@/lib/zama/fhe')>()), encryptU8s: m.encryptU8s }));
vi.mock('./fog', async (orig) => ({ ...(await orig<typeof import('./fog')>()), decryptView: m.decryptView, finalizePendingRound: m.finalizePendingRound }));

import type { FogApi, FogGame, FogView } from './fog';
import { FogLobby } from './FogLobby';
import { FogPlay } from './FogPlay';

const ME = '0x00000000000000000000000000000000000000a1';
const RIVAL = '0x00000000000000000000000000000000000000b2';
const CONTRACT = '0x00000000000000000000000000000000000000f0';

const header = (over: Partial<FogGame> = {}): FogGame => ({
  id: 7n,
  players: [ME, RIVAL],
  status: 'playing',
  round: 2,
  roundsPlayed: 1,
  awaitingReveal: false,
  moved: [false, false],
  moveWindow: 600,
  deadline: Math.floor(Date.now() / 1000) + 300,
  winner: 0,
  endReason: 'none',
  revealed: false,
  ...over,
});

const VIEW: FogView = { tile: 7, carrying: false, hit: false, senseVial: 0, senseRival: 1, trapsPlaced: [12, 13], trapsLive: [12, FOG_NO_TILE] };

function fakeApi(state: { game: FogGame }, over: Partial<FogApi> = {}): FogApi {
  return {
    read: vi.fn(async () => state.game),
    create: vi.fn(async () => 9n),
    join: vi.fn(async () => undefined),
    move: vi.fn(async () => {
      state.game = { ...state.game, moved: [true, false] };
    }),
    cancel: vi.fn(async () => undefined),
    claimTimeout: vi.fn(async () => undefined),
    roundHandles: vi.fn(async () => []),
    finalizeRound: vi.fn(async () => undefined),
    playerView: vi.fn(async () => ({}) as never),
    outcomes: vi.fn(async (_id: bigint, n: number) => Array.from({ length: n }, () => ({ trapHit: true, vialTaken: false, winner: 0 as const }))),
    revealHandles: vi.fn(async () => []),
    finalizeGameReveal: vi.fn(async () => undefined),
    replay: vi.fn(),
    ...over,
  };
}

const signer = { getAddress: async () => ME, signTypedData: async () => '0xsig' };
const instance = vi.fn(async () => ({}) as never);

function renderPlay(api: FogApi) {
  return renderWithProviders(
    <FogPlay gameId={7n} address={ME} contract={CONTRACT} api={api} signer={signer} instance={instance} onLeave={() => undefined} pollMs={50} fallbackMs={0} />,
  );
}

describe('FogPlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    m.decryptView.mockResolvedValue(VIEW);
  });

  it('shows my decrypted scout, traps and pings, and seals a click as an encrypted move', async () => {
    const state = { game: header() };
    const api = fakeApi(state);
    renderPlay(api);

    await screen.findByTestId('fog-my-scout');
    expect(screen.getByTestId('fog-tile-7')).toContainElement(screen.getByTestId('fog-my-scout'));
    expect(screen.getByTestId('fog-sense')).toHaveTextContent('🟢Vial: adjacent');
    expect(screen.getByTestId('fog-sense')).toHaveTextContent('Rival scout: near');
    expect(screen.getByTestId('fog-log')).toHaveTextContent('R1 A flood switch went off');
    expect(screen.getByTestId('fog-tile-12')).toHaveAccessibleName(/your flood switch/);
    expect(screen.getByTestId('fog-tile-13')).toHaveAccessibleName(/spent/);
    // Only the four neighbours are clickable.
    expect(screen.getByTestId('fog-tile-13')).toBeDisabled();
    expect(screen.getByTestId('fog-tile-12')).toBeEnabled();

    await userEvent.click(screen.getByTestId('fog-tile-12'));
    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(1));
    expect(m.encryptU8s).toHaveBeenCalledWith(expect.anything(), CONTRACT, ME, [3]); // south: row + 1
    await waitFor(() => expect(screen.getByTestId('fog-status')).toHaveTextContent(/Your move is sealed/));
    expect(screen.getByTestId('fog-tile-12')).toBeDisabled();
  });

  it('publishes a resolved round with the KMS proof when both moves are in', async () => {
    const state = { game: header({ awaitingReveal: true, moved: [true, true] }) };
    const api = fakeApi(state);
    m.finalizePendingRound.mockImplementation(async () => {
      state.game = header({ round: 3, roundsPlayed: 2 });
      return true;
    });
    renderPlay(api);
    await waitFor(() => expect(m.finalizePendingRound).toHaveBeenCalledWith(api, expect.anything(), 7n));
    await waitFor(() => expect(screen.getByTestId('fog-log')).toHaveTextContent('R2'));
  });

  it('offers the timeout claim once the rival missed the deadline', async () => {
    const state = { game: header({ moved: [true, false], deadline: Math.floor(Date.now() / 1000) - 5 }) };
    const api = fakeApi(state);
    renderPlay(api);
    await userEvent.click(await screen.findByTestId('fog-claim'));
    await waitFor(() => expect(api.claimTimeout).toHaveBeenCalledWith(7n));
  });

  it('reveals the board at the end and verifies the game against the chain', async () => {
    const input = { traps: [[15, 16], [5, 6]] as [[number, number], [number, number]], vialCol: 3, moves: [[3, 1], [3, 4], [2, 0], [1, 2], [1, 0]] as [number, number][] };
    const replay = replayFogGame(input);
    const revealed = { ...input, finalTiles: [fogTile(replay.final.pos[0]), fogTile(replay.final.pos[1])] as [number, number] };
    const state = { game: header({ status: 'ended', winner: 1, endReason: 'delivered', roundsPlayed: 5, round: 5, revealed: true }) };
    const api = fakeApi(state, {
      replay: vi.fn(async () => revealed),
      outcomes: vi.fn(async () => replay.rounds.map((r) => r.outcome)),
    });
    m.decryptView.mockResolvedValue({ ...VIEW, tile: 3, carrying: true });
    renderPlay(api);

    expect(await screen.findByTestId('fog-result')).toHaveTextContent('You win!');
    await waitFor(() => expect(screen.getByTestId(`fog-tile-${revealed.finalTiles[1]}`)).toHaveAccessibleName(/rival's scout/));
    expect(screen.getByTestId('fog-tile-13')).toHaveAccessibleName(/the vial was here/);
    expect(screen.getByTestId('fog-tile-5')).toHaveAccessibleName(/rival's flood switch/);
    await userEvent.click(screen.getByTestId('fog-verify'));
    const checks = await screen.findByTestId('fog-checks');
    expect(checks).toHaveTextContent('Public outcomes match the replay');
    expect(checks.querySelectorAll('li')).toHaveLength(5);
    expect(checks).not.toHaveTextContent('✗');
  });
});

describe('FogLobby', () => {
  it('plants two traps, encrypts them under one proof and creates the game', async () => {
    const api = fakeApi({ game: header() });
    const onEnter = vi.fn();
    renderWithProviders(<FogLobby address={ME} contract={CONTRACT} api={api} signer={signer} instance={instance} onEnter={onEnter} />);
    const create = screen.getByTestId('fog-create');
    expect(create).toBeDisabled();
    expect(screen.getByTestId('fog-tile-3')).toBeDisabled(); // own half: not plantable
    await userEvent.click(screen.getByTestId('fog-tile-12'));
    await userEvent.click(screen.getByTestId('fog-tile-17'));
    await userEvent.click(create);
    await waitFor(() => expect(onEnter).toHaveBeenCalledWith(9n));
    expect(m.encryptU8s).toHaveBeenCalledWith(expect.anything(), CONTRACT, ME, [12, 17]);
    expect(api.create).toHaveBeenCalledWith('', 600, expect.objectContaining({ inputProof: '0xpr00f' }));
  });

  it('finds an open game by id and joins it with traps on the other half', async () => {
    const api = fakeApi({ game: header({ status: 'waiting', players: [RIVAL, '0x0000000000000000000000000000000000000000'], round: 0, roundsPlayed: 0 }) });
    const onEnter = vi.fn();
    renderWithProviders(<FogLobby address={ME} contract={CONTRACT} api={api} signer={signer} instance={instance} onEnter={onEnter} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Join by id' }));
    await userEvent.type(screen.getByTestId('fog-join-id'), '7{Enter}');
    await screen.findByTestId('fog-join');
    expect(screen.getByTestId('fog-tile-17')).toBeDisabled(); // side 1 plants on tiles 5..14
    await userEvent.click(screen.getByTestId('fog-tile-6'));
    await userEvent.click(screen.getByTestId('fog-tile-11'));
    await act(async () => {
      await userEvent.click(screen.getByTestId('fog-join'));
    });
    await waitFor(() => expect(api.join).toHaveBeenCalledWith(7n, expect.objectContaining({ inputProof: '0xpr00f' })));
    expect(onEnter).toHaveBeenCalledWith(7n);
  });
});
