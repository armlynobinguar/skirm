import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Achievements, AchievementView } from '@/lib/api/types';
import { renderWithProviders } from '@/test/render';
import { AchievementsCard } from './AchievementsCard';

const item = (o: Partial<AchievementView> = {}): AchievementView => ({
  id: 'first_win',
  title: 'First win',
  detail: 'Win a match',
  target: 1,
  progress: 1,
  unlocked: true,
  unlockedAt: '2026-11-03T10:00:00.000Z',
  cosmetic: null,
  badge: null,
  ...o,
});

const data = (badge: AchievementView['badge'] = null): Achievements => ({
  streak: { current: 2, best: 4, playedToday: true },
  achievements: [
    item({ badge }),
    item({ id: 'first_match', title: 'First drop', detail: 'Play your first match', badge: { status: 'local', tokenId: 't', txHash: 'noop:x', owner: 'acc', mintedAt: null } }),
    item({
      id: 'wins_25',
      title: 'Veteran',
      detail: 'Win 25 matches',
      target: 25,
      progress: 4,
      unlocked: false,
      unlockedAt: null,
      cosmetic: { id: 'outfit_obsidian', name: 'Obsidian outfit' },
    }),
  ],
});

describe('S16 achievements card', () => {
  it('lists progress, unlocks, rewards and badge state', async () => {
    renderWithProviders(<AchievementsCard />, { handle: 'ada', api: { achievements: async () => data() } });
    const card = await screen.findByTestId('s16-achievements');
    await waitFor(() => expect(card).toHaveTextContent('2 of 3 · best streak 4'));
    expect(screen.getByTestId('achievement-wins_25')).toHaveTextContent('Reward: Obsidian outfit');
    expect(screen.getByRole('progressbar', { name: 'Veteran: 4 of 25' })).toBeInTheDocument();
    expect(screen.queryByTestId('achievement-wins_25-mint')).not.toBeInTheDocument();
    expect(screen.getByTestId('achievement-first_match-badge')).toHaveTextContent('Badge (local)');
    expect(screen.getByTestId('achievement-first_win-mint')).toHaveTextContent('Mint badge');
  });

  it('mints an unlocked achievement as a badge', async () => {
    let minted = false;
    const { user, api } = renderWithProviders(<AchievementsCard />, {
      handle: 'ada',
      api: {
        achievements: async () =>
          data(minted ? { status: 'local', tokenId: 'first_win:acc', txHash: 'noop:y', owner: 'acc', mintedAt: null } : null),
        mintBadge: async () => {
          minted = true;
          return { badge: { status: 'local', tokenId: 'first_win:acc', txHash: 'noop:y', owner: 'acc', mintedAt: null } };
        },
      },
    });
    await user.click(await screen.findByTestId('achievement-first_win-mint'));
    expect(api.mintBadge).toHaveBeenCalledWith('first_win');
    expect(await screen.findByTestId('achievement-first_win-badge')).toHaveTextContent('Badge (local)');
    expect(await screen.findByText('First win badge minted')).toBeInTheDocument();
  });

  it('offers a retry after a failed mint', async () => {
    renderWithProviders(<AchievementsCard />, {
      handle: 'ada',
      api: { achievements: async () => data({ status: 'failed', tokenId: 't', txHash: null, owner: 'a', mintedAt: null }) },
    });
    expect(await screen.findByTestId('achievement-first_win-mint')).toHaveTextContent('Retry mint');
  });
});
