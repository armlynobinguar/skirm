import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { renderWithProviders } from '@/test/render';
import { ME_ID, currentSeasonFixture, meFixture, playerLadderRowFixture, seasonFixture, standingFixture } from '@/test/fixtures';
import { LeaderboardsScreen } from './LeaderboardsScreen';

const ADA = { id: ME_ID, handle: 'ada' };

function setup(api: NonNullable<Parameters<typeof renderWithProviders>[1]>['api'] = {}) {
  const current = currentSeasonFixture();
  return renderWithProviders(<LeaderboardsScreen />, {
    handle: 'ada',
    path: '/leaderboards',
    api: {
      me: async () => meFixture(),
      currentSeason: async () => current,
      seasonStandings: async () => ({ rows: current.top, total: current.top.length }),
      playerLadder: async () => ({
        rows: [playerLadderRowFixture({ rank: 1, elo: 1612, account: { id: 'acc_nova', handle: 'nova' } }), playerLadderRowFixture({ rank: 2, elo: 1240, account: ADA })],
      }),
      ...api,
    },
  });
}

beforeEach(() => window.history.replaceState(null, '', '/leaderboards'));

describe('S14 Leaderboards', () => {
  it('shows the season: number, countdown, the local pool and the standings with projected prizes', async () => {
    const { api } = setup();
    expect(await screen.findByRole('heading', { name: 'Season 3' })).toBeInTheDocument();
    expect(screen.getByTestId('s14-season-countdown')).toHaveTextContent(/^Ends in 2d 0[23]h \d\dm$/);
    const pool = screen.getByTestId('s14-season-pool');
    expect(pool).toHaveTextContent('Prize pool 12.50 NEAR tallied offchain, not yet on NEAR · paid to the top 10. Ranked wins earn 25 points, draws 12, losses 5.');
    expect(within(pool).getByTestId('s14-pool-local')).toHaveAttribute('title', expect.stringMatching(/until the season is recorded on the seasons contract/));
    expect(pool).not.toHaveTextContent(/local/);
    const first = await screen.findByTestId('s14-season-row-1');
    expect(first).toHaveTextContent('1nova1305–1–01,6123.75 NEAR');
    expect(screen.getByTestId('s14-season-row-2')).toHaveTextContent('2.50 NEAR');
    expect(api.seasonStandings).toHaveBeenCalledWith('ssn_01J00000000000000000000003', { limit: 100 });
    expect(screen.queryByRole('tab', { name: /Race ladder|Per map/ })).not.toBeInTheDocument();
  });

  it('marks your row, and adds it below when you are outside the rows', async () => {
    const you = standingFixture({ rank: 14, account: ADA, points: 25, wins: 1, losses: 0, draws: 0, matches: 1, elo: 1216, projectedPrizeYocto: null });
    setup({ currentSeason: async () => currentSeasonFixture({ you }) });
    const row = await screen.findByTestId('s14-season-row-14');
    expect(row).toHaveAttribute('data-you', 'true');
    expect(row).toHaveTextContent('14ada · you251–0–01,216—');
    expect(screen.getByTestId('s14-season-row-1')).not.toHaveAttribute('data-you');
  });

  it('says how many players the standings hold when there are more rows', async () => {
    setup({ seasonStandings: async () => ({ rows: currentSeasonFixture().top, total: 230 }) });
    expect(await screen.findByText('Top 2 of 230 players.')).toBeInTheDocument();
  });

  it('shows an onchain pool without the local label, and an ended season', async () => {
    setup({
      currentSeason: async () =>
        currentSeasonFixture({ season: seasonFixture({ poolSource: 'onchain', status: 'paid', endsAt: new Date(Date.now() - 1000).toISOString() }) }),
    });
    expect(await screen.findByTestId('s14-season-countdown')).toHaveTextContent('Ended · prizes paid');
    expect(screen.queryByTestId('s14-pool-local')).not.toBeInTheDocument();
  });

  it('says how an empty pool fills instead of 0.00 NEAR, and an ended season with none', async () => {
    const { unmount } = setup({ currentSeason: async () => currentSeasonFixture({ season: seasonFixture({ poolYocto: '0' }) }) });
    const pool = await screen.findByTestId('s14-season-pool');
    expect(pool).toHaveTextContent('No prize pool yet: 30% of every skill-market fee taken this season goes into it, split among the top 10.');
    expect(pool).not.toHaveTextContent('0.00 NEAR');
    expect(pool).not.toHaveTextContent(/soon/i);
    expect(screen.queryByTestId('s14-pool-local')).not.toBeInTheDocument();
    unmount();
    setup({ currentSeason: async () => currentSeasonFixture({ season: seasonFixture({ poolYocto: '0', status: 'paid', endsAt: new Date(Date.now() - 1000).toISOString() }) }) });
    expect(await screen.findByTestId('s14-season-pool')).toHaveTextContent('This season ended with no prize pool.');
  });

  it('shows the empty season with a call to play ranked and a link to /verify', async () => {
    setup({ seasonStandings: async () => ({ rows: [], total: 0 }) });
    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveTextContent('The board is open.');
    expect(empty).toHaveTextContent('your first win takes first place');
    expect(within(empty).getByRole('link', { name: 'Play ranked' })).toHaveAttribute('href', '/pvp');
    expect(within(empty).getByRole('link', { name: 'See how results are verified on NEAR' })).toHaveAttribute('href', '/verify');
  });

  it('shows an error with Retry when the season fails', async () => {
    const { api, user } = setup({ currentSeason: async () => Promise.reject(new ApiError(503, 'internal', 'down')) });
    const card = await screen.findByTestId('error-card');
    api.currentSeason.mockResolvedValueOnce(currentSeasonFixture());
    await user.click(within(card).getByRole('button', { name: /Retry/ }));
    expect(await screen.findByTestId('s14-season-row-1')).toBeInTheDocument();
  });

  it('shows the all-time player ladder with you marked, and keeps the tab in the URL', async () => {
    const { user } = setup();
    await screen.findByTestId('screen-s14');
    await user.click(screen.getByRole('tab', { name: /All-time/ }));
    const mine = await screen.findByTestId('s14-alltime-row-2');
    await waitFor(() => expect(mine).toHaveAttribute('data-you', 'true'));
    expect(mine).toHaveTextContent('2ada · you');
    expect(mine).toHaveTextContent('1,240');
    expect(screen.getByTestId('s14-alltime-row-1')).toHaveTextContent('nova');
    expect(window.location.search).toBe('?tab=alltime');
    await user.click(screen.getByRole('tab', { name: /Season/ }));
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('opens on the all-time tab from the URL, and shows the empty ladder', async () => {
    window.history.replaceState(null, '', '/leaderboards?tab=alltime');
    setup({ playerLadder: async () => ({ rows: [] }) });
    expect(await screen.findByText('No ranked matches yet. Win one to take the first place.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /All-time/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between tabs with the arrow keys', async () => {
    const { user } = setup();
    await screen.findByTestId('screen-s14');
    screen.getByRole('tab', { name: /Season/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /All-time/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('s14-alltime')).toBeInTheDocument();
  });
});
