import { playerTier } from '@skirm/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TierBadge, tierFrom, tierText } from '@/components/TierBadge';
import { Accept } from '@/features/v2/Accept';
import { reduceV2 } from '@/features/v2/v2Store';
import { FakeRealtime } from '@/test/fakeRealtime';
import { ME_ID, currentSeasonFixture, meFixture, playerLadderRowFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
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
      playerLadder: async () => ({ rows: [playerLadderRowFixture({ rank: 1, elo: 1612, account: { id: 'acc_nova', handle: 'nova' } })] }),
      mapLadder: async (mapId) => ({
        mapId,
        rows: [
          { rank: 1, account: { id: 'acc_nova', handle: 'nova' }, elo: 1720, rankedMatches: 30, matches: 4, wins: 3, losses: 1, draws: 0, winRate: 0.75, tier: playerTier(1720, 30) },
          { rank: 2, account: ADA, elo: 1240, rankedMatches: 3, matches: 3, wins: 1, losses: 2, draws: 0, winRate: 1 / 3, tier: playerTier(1240, 3) },
        ],
      }),
      skillLadder: async () => ({
        minMatches: 10,
        rows: [
          { rank: 1, skill: { id: 'skl_gem', name: 'Gem Rush' }, creator: { id: 'acc_nova', handle: 'nova' }, matches: 12, wins: 9, losses: 3, draws: 0, winRate: 0.75 },
        ],
      }),
      ...api,
    },
  });
}

beforeEach(() => window.history.replaceState(null, '', '/leaderboards'));

describe('tier badge', () => {
  it('names the tier, or the placement progress', () => {
    expect(tierText(playerTier(1750, 9))).toBe('Diamond');
    expect(tierText(playerTier(1750, 2))).toBe('Placement 2/5');
    // A payload without the tier falls back to the shared rule.
    expect(tierFrom({ elo: 1950, rankedMatches: 6 }).tier).toBe('Master');
    render(<TierBadge tier={playerTier(1350, 7)} testId="b" />);
    expect(screen.getByTestId('b')).toHaveTextContent('Gold');
    expect(screen.getByTestId('b')).toHaveAttribute('data-tier', 'Gold');
    expect(screen.getByTestId('b')).toHaveAttribute('title', 'Gold tier · next tier at 1500 Elo');
  });
});

describe('S14 ranked boards', () => {
  it('shows tiers on the all-time ladder', async () => {
    window.history.replaceState(null, '', '/leaderboards?tab=alltime');
    setup();
    const row = await screen.findByTestId('s14-alltime-row-1');
    // The fixture has 23 ranked matches at 1,612: Platinum.
    expect(row).toHaveTextContent('Platinum');
  });

  it('opens the map board from the URL, with tiers and win rates, and switches maps', async () => {
    window.history.replaceState(null, '', '/leaderboards?tab=maps');
    const { api, user } = setup();
    const first = await screen.findByTestId('s14-map-row-1');
    expect(first).toHaveTextContent('nova');
    expect(first).toHaveTextContent('Diamond');
    expect(first).toHaveTextContent('75%');
    const mine = screen.getByTestId('s14-map-row-2');
    expect(mine).toHaveAttribute('data-you', 'true');
    expect(mine).toHaveTextContent('Placement 3/5');
    expect(api.mapLadder).toHaveBeenCalledWith('copper-hollow', 100);
    const pick = screen.getByTestId('s14-map-pick') as HTMLSelectElement;
    const otherMap = Array.from(pick.options).find((o) => o.value !== 'copper-hollow')!.value;
    await user.selectOptions(pick, otherMap);
    await waitFor(() => expect(api.mapLadder).toHaveBeenCalledWith(otherMap, 100));
  });

  it('lists skills by win rate above the minimum, and says when none qualifies', async () => {
    const { user } = setup();
    await screen.findByTestId('screen-s14');
    await user.click(screen.getByRole('tab', { name: /Skills/ }));
    const row = await screen.findByTestId('s14-skill-row-1');
    expect(row).toHaveTextContent('Gem Rush');
    expect(row).toHaveTextContent('75%');
    expect(screen.getByRole('link', { name: 'Gem Rush' })).toHaveAttribute('href', '/market/skl_gem');
    expect(screen.getByText('Win rate in ranked matches, at least 10 played')).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=skills');
  });

  it('empty skill board', async () => {
    window.history.replaceState(null, '', '/leaderboards?tab=skills');
    setup({ skillLadder: async () => ({ minMatches: 10, rows: [] }) });
    expect(await screen.findByText('No skill has 10 ranked matches yet.')).toBeInTheDocument();
  });
});

describe('match found: tiers', () => {
  it('shows both tiers on a ranked v2_found', () => {
    const rt = new FakeRealtime();
    const view = reduceV2(
      undefined,
      {
        type: 'v2_found',
        matchId: 'mat_t',
        team: 'A',
        mapId: 'copper-hollow',
        ranked: true,
        acceptMs: 10_000,
        tiers: { you: playerTier(1320, 8), rival: playerTier(1200, 1) },
      },
      0,
    )!;
    expect(view.tiers).toEqual({ you: playerTier(1320, 8), rival: playerTier(1200, 1) });
    act(() => {
      renderWithProviders(<Accept view={view} />, { realtime: rt, handle: 'ana' });
    });
    expect(screen.getByTestId('v2-found-tier-you')).toHaveTextContent('Gold');
    expect(screen.getByTestId('v2-found-tier-rival')).toHaveTextContent('Placement 1/5');
  });

  it('casual v2_found carries no tiers', () => {
    const view = reduceV2(undefined, { type: 'v2_found', matchId: 'm', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 1000 }, 0)!;
    expect(view.tiers).toBeNull();
  });
});
