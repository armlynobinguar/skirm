import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Lobby, TournamentDetail } from '@/lib/api/lobbyTypes';
import { agentFixture, meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { testRouter } from '@/test/router';
import { LobbiesScreen } from './LobbiesScreen';
import { LobbyScreen } from './LobbyScreen';
import { TournamentScreen } from './TournamentScreen';
import { bracketGrid, prizePreview, roundName, shareLink } from './lobbyUtil';

const WICK = agentFixture({ id: 'agt_wick', name: 'Wick', tier: 'standard' });
const MOSS = agentFixture({ id: 'agt_moss', name: 'Moss', tier: 'open' });
const me = () =>
  meFixture({
    account: { id: 'acc_ada', handle: 'ada', nearAccountId: null, createdAt: '2026-11-01T00:00:00.000Z' },
    agents: [WICK, MOSS],
    credits: { balance: 500, held: 0, allowanceLeft: 60, allowanceResetAt: '2026-11-05T00:00:00.000Z', available: 560 },
  });

const lobby = (o: Partial<Lobby> = {}): Lobby => ({
  id: 'lby_1',
  code: 'ABCD23',
  host: { id: 'acc_ada', handle: 'ada' },
  guest: { id: 'acc_bo', handle: 'bo' },
  mapId: 'copper-hollow',
  difficulty: 'easy',
  talk: 'any',
  crewSize: 2,
  status: 'open',
  matchId: null,
  winnerId: null,
  tournamentId: null,
  round: null,
  slot: null,
  ready: { host: false, guest: false },
  openedAt: '2026-11-04T00:00:00.000Z',
  createdAt: '2026-11-04T00:00:00.000Z',
  ...o,
});

describe('lobby helpers', () => {
  it('names rounds, lays out the bracket and previews the prize split', () => {
    expect([1, 2, 3].map((r) => roundName(8, r))).toEqual(['Quarter-finals', 'Semi-finals', 'Final']);
    const grid = bracketGrid({ size: 8, matches: [{ lobbyId: 'l', code: 'X', round: 1, slot: 2, hostId: 'a', guestId: 'b', status: 'open', matchId: null, winnerId: null }] });
    expect(grid.map((c) => c.slots.length)).toEqual([4, 2, 1]);
    expect(grid[0]!.slots[2]?.lobbyId).toBe('l');
    expect(prizePreview(1000)).toEqual([
      { place: '1st', credits: 600 },
      { place: '2nd', credits: 250 },
      { place: '3rd–4th (each)', credits: 75 },
    ]);
    expect(shareLink('ABCD23', 'https://skirm.gg')).toBe('https://skirm.gg/lobbies/join/ABCD23');
  });
});

describe('lobbies', () => {
  it('makes a friend lobby with the picked rules and opens it', async () => {
    testRouter.reset('/lobbies');
    const { api, user } = renderWithProviders(<LobbiesScreen />, {
      handle: 'ada',
      api: { myLobbies: async () => [], createLobby: async () => lobby({ guest: null }) },
    });
    await user.selectOptions(await screen.findByTestId('lobbies-new-talk'), 'standard');
    await user.selectOptions(screen.getByTestId('lobbies-new-crew'), '2');
    await user.click(screen.getByTestId('lobbies-create'));
    expect(api.createLobby).toHaveBeenCalledWith(expect.objectContaining({ talk: 'standard', crewSize: 2 }));
    expect(testRouter.push).toHaveBeenCalledWith('/lobbies/lby_1');
  });

  it('readies the crew on the lobby rules, steps back, and follows v2_found to the match', async () => {
    testRouter.reset('/lobbies/lby_1');
    const { realtime, user } = renderWithProviders(<LobbyScreen lobbyId="lby_1" />, {
      handle: 'ada',
      api: { me: async () => me(), lobby: async () => lobby({ talk: 'quiet' }) },
    });
    expect(await screen.findByTestId('lobby-code')).toHaveTextContent('ABCD23');
    expect(screen.getByTestId('lobby-guest')).toHaveTextContent('bo');
    expect(screen.getByText(/Quiet \(lobby rule\)/)).toBeInTheDocument();
    await user.click(screen.getByTestId('lobby-ready'));
    expect(realtime.sent).toContainEqual({ type: 'v2_lobby_ready', lobbyId: 'lby_1', crew: [{ agentId: 'agt_wick', tier: 'quiet' }] });
    await user.click(screen.getByTestId('lobby-unready'));
    expect(realtime.sent.at(-1)).toEqual({ type: 'v2_cancel_queue' });
    await user.click(screen.getByTestId('lobby-ready'));
    act(() => realtime.emit({ type: 'v2_lobby', lobbyId: 'lby_1', ready: { host: true, guest: true } }));
    expect(screen.getByTestId('lobby-guest')).toHaveTextContent('Crew readied');
    act(() => realtime.emit({ type: 'v2_found', matchId: 'mat_9', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, difficulty: 'easy' }));
    expect(testRouter.push).toHaveBeenCalledWith('/matches/mat_9');
  });

  it('cannot ready before a guest joins, and says why a ready was refused', async () => {
    testRouter.reset('/lobbies/lby_1');
    const { realtime, user } = renderWithProviders(<LobbyScreen lobbyId="lby_1" />, {
      handle: 'ada',
      api: { me: async () => me(), lobby: async () => lobby({ guest: null }) },
    });
    expect(await screen.findByTestId('lobby-ready')).toBeDisabled();
    expect(screen.getByTestId('lobby-guest')).toHaveTextContent('Waiting for a friend');
    expect(realtime.sent).toEqual([]);
  });
});

describe('tournament bracket', () => {
  const T: TournamentDetail = {
    id: 'trn_1',
    name: 'Copper Cup',
    creator: { id: 'acc_ada', handle: 'ada' },
    size: 4,
    entrants: 4,
    mapId: 'copper-hollow',
    difficulty: 'easy',
    talk: 'any',
    crewSize: 2,
    prizePool: 1000,
    status: 'running',
    champion: null,
    createdAt: '2026-11-04T00:00:00.000Z',
    startedAt: '2026-11-04T00:00:00.000Z',
    endedAt: null,
    rounds: 2,
    entries: [
      { account: { id: 'a1', handle: 'ana' }, seed: 1, elo: 1400, place: null, prize: 0 },
      { account: { id: 'a2', handle: 'ben' }, seed: 2, elo: 1300, place: null, prize: 0 },
      { account: { id: 'a3', handle: 'cy' }, seed: 3, elo: 1250, place: 3, prize: 0 },
      { account: { id: 'acc_ada', handle: 'ada' }, seed: 4, elo: 1200, place: null, prize: 0 },
    ],
    matches: [
      { lobbyId: 'lby_s0', code: 'AAAAAA', round: 1, slot: 0, hostId: 'a1', guestId: 'acc_ada', status: 'open', matchId: null, winnerId: null },
      { lobbyId: 'lby_s1', code: 'BBBBBB', round: 1, slot: 1, hostId: 'a2', guestId: 'a3', status: 'done', matchId: 'mat_s1', winnerId: 'a2' },
    ],
    you: { joined: true, creator: true, place: null, prize: 0, lobbyId: 'lby_s0' },
  };

  it('shows rounds, seeds, winners, the caller’s match and the prize split', async () => {
    renderWithProviders(<TournamentScreen id="trn_1" />, { handle: 'ada', api: { tournament: async () => T } });
    expect(await screen.findByTestId('t-title')).toHaveTextContent('Copper Cup');
    const semi1 = screen.getByTestId('t-match-1-1');
    expect(within(semi1).getByText('ben').closest('[data-won]')).toHaveAttribute('data-won', 'true');
    expect(within(semi1).getByRole('link', { name: 'debrief' })).toHaveAttribute('href', '/matches/mat_s1/result');
    expect(screen.getByTestId('t-match-1-0')).toHaveAttribute('data-mine', 'true');
    expect(within(screen.getByTestId('t-round-2')).getByTestId('t-match-empty')).toBeInTheDocument();
    expect(within(screen.getByTestId('t-your-match')).getByRole('link')).toHaveAttribute('href', '/lobbies/lby_s0');
    expect(screen.getByTestId('t-pool')).toHaveTextContent('1,000 credits');
    // Running: no join or cancel any more.
    expect(screen.queryByTestId('t-cancel')).toBeNull();
  });

  it('joins an open tournament', async () => {
    const open: TournamentDetail = { ...T, status: 'open', entrants: 3, matches: [], entries: T.entries.slice(0, 3).map((e) => ({ ...e, seed: null, elo: null, place: null })), you: { joined: false, creator: false, place: null, prize: 0, lobbyId: null } };
    const { api, user } = renderWithProviders(<TournamentScreen id="trn_1" />, {
      handle: 'ada',
      api: { tournament: async () => open, joinTournament: async () => ({ ...open, entrants: 4, you: { ...open.you!, joined: true } }) },
    });
    await user.click(await screen.findByTestId('t-join-btn'));
    expect(api.joinTournament).toHaveBeenCalledWith('trn_1');
    expect(await screen.findByTestId('t-leave')).toBeInTheDocument();
  });
});
