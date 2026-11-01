import { screen, waitFor, within } from '@testing-library/react';
import { rankTitle } from '@skirm/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { HomeScreen } from './HomeScreen';

const base = {
  me: async () => meFixture(),
};

describe('S02 Command deck', () => {
  it('shows the lead agent with its role and skill, and the menu tiles', async () => {
    renderWithProviders(<HomeScreen />, { handle: 'ada', path: '/play', api: base });
    const deck = await screen.findByTestId('s02-deck');
    expect(await within(deck).findByRole('img', { name: 'Your lead agent, Rook' })).toBeInTheDocument();
    expect(deck).toHaveTextContent('Builder · crew lead');
    expect(deck).toHaveTextContent('Flood Warden · talk: standard');
    expect(screen.getByTestId('s02-tile-ranked')).toHaveAttribute('href', '/pvp');
    expect(screen.getByTestId('s02-tile-ranked')).toHaveTextContent('CH-05 Copper Hollow in rotation');
    expect(screen.getByTestId('s02-tile-atlas')).toHaveAttribute('href', '/maps');
    expect(screen.getByTestId('s02-tile-atlas')).toHaveTextContent('10 maps');
    expect(screen.getByTestId('s02-tile-crew')).toHaveTextContent('Rook, Wren, Moss');
    expect(screen.getByTestId('s02-tile-crew')).toHaveAttribute('href', '/agents/agt_01J0000000000000000000ROOK');
    expect(screen.getByTestId('s02-tile-skills')).toHaveAttribute('href', '/market');
    expect(screen.getByTestId('s02-tile-ladder')).toHaveAttribute('href', '/leaderboards');
    expect(within(screen.getByTestId('s02-tile-ladder')).queryByText('Soon')).not.toBeInTheDocument();
    // Quick practice: the crew screen on DEFAULT_PRACTICE with "Vs Greedy bot" on.
    expect(screen.getByTestId('s02-tile-practice')).toHaveAttribute('href', '/maps/copper-hollow/crew?d=easy&opponent=bot');
    expect(screen.getByTestId('s02-tile-practice')).toHaveTextContent('Vs Greedy bot');
    expect(screen.getByTestId('s02-tile-practice')).toHaveTextContent('Quick practice · Copper Hollow · Easy · starts at once');
  });

  it('puts your ranked Elo on the Skirmish tile', async () => {
    const me = meFixture({ rank: { elo: 1240, rankedMatches: 3, wins: 2, losses: 1, draws: 0, title: rankTitle(1240).title, position: null } });
    renderWithProviders(<HomeScreen />, { handle: 'ada', path: '/play', api: { ...base, me: async () => me } });
    await waitFor(() =>
      expect(screen.getByTestId('s02-tile-ranked')).toHaveTextContent('Elo 1240 · CH-05 Copper Hollow in rotation'),
    );
  });

  it('shows no scripted barks and no feed ticker', async () => {
    renderWithProviders(<HomeScreen />, { handle: 'ada', path: '/play', api: base });
    const deck = await screen.findByTestId('s02-deck');
    await within(deck).findByRole('img', { name: 'Your lead agent, Rook' });
    expect(screen.queryByTestId('s02-bark')).not.toBeInTheDocument();
    expect(deck).not.toHaveTextContent('// FEED');
    expect(deck).not.toHaveTextContent('Overheard on SW-01');
  });
});

describe('S02 Home', () => {
  it('shows an error card with Retry when the account fails to load', async () => {
    let fail = true;
    const { user, api } = renderWithProviders(<HomeScreen />, {
      handle: 'ada',
      api: {
        ...base,
        me: async () => {
          if (fail) throw new ApiError(500, 'internal', 'boom');
          return meFixture();
        },
      },
    });
    const card = await screen.findByTestId('error-card');
    fail = false;
    await user.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img', { name: 'Your lead agent, Rook' })).toBeInTheDocument();
    expect(screen.queryByTestId('error-card')).not.toBeInTheDocument();
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it('asks signed-out visitors to sign in', async () => {
    renderWithProviders(<HomeScreen />, { path: '/play', api: base });
    expect(await screen.findByTestId('signin-required')).toBeInTheDocument();
    expect(screen.getByTestId('screen-s02')).toBeInTheDocument();
  });
});
