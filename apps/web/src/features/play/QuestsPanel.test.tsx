import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { QuestBoard, QuestView } from '@/lib/api/types';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { HomeScreen } from './HomeScreen';

const quest = (o: Partial<QuestView> = {}): QuestView => ({
  id: 'd_win_quiet',
  period: 'daily',
  title: 'Win with every agent on Quiet talk',
  target: 1,
  progress: 0,
  done: false,
  claimed: false,
  claimable: false,
  rewardCredits: 10,
  credited: null,
  ...o,
});

const board = (o: Partial<QuestBoard> = {}): QuestBoard => ({
  daily: {
    key: '2026-11-04',
    endsAt: '2026-11-05T00:00:00.000Z',
    quests: [
      quest(),
      quest({ id: 'd_practice_3', title: 'Play 3 practice matches', target: 3, progress: 3, done: true, claimable: true }),
      quest({ id: 'd_play_2', title: 'Play 2 matches', target: 2, progress: 2, done: true, claimed: true, credited: 10 }),
    ],
  },
  weekly: {
    key: '2026-11-02',
    endsAt: '2026-11-09T00:00:00.000Z',
    quests: [quest({ id: 'w_win_5', period: 'weekly', title: 'Win 5 matches', target: 5, progress: 2, rewardCredits: 25 })],
  },
  streak: { current: 3, best: 5, playedToday: false },
  allowanceLeft: 30,
  ...o,
});

describe('S02 quests panel', () => {
  it('shows daily and weekly quests with progress, claim state and the streak', async () => {
    const { user } = renderWithProviders(<HomeScreen />, {
      handle: 'ada',
      api: { me: async () => meFixture(), quests: async () => board() },
    });
    // The quests live behind the home hub's lightbulb.
    const panel = await screen.findByTestId('s02-quests');
    expect(panel).not.toBeVisible();
    await user.click(screen.getByTestId('hub-open'));
    expect(panel).toBeVisible();
    expect(within(screen.getByTestId('s02-quests-daily')).getAllByRole('listitem')).toHaveLength(3);
    expect(within(screen.getByTestId('s02-quests-weekly')).getByText('Win 5 matches')).toBeInTheDocument();
    expect(screen.getByTestId('quest-w_win_5')).toHaveTextContent('2 / 5');
    expect(screen.getByTestId('quest-w_win_5')).toHaveTextContent('+25 free');
    expect(screen.getByRole('progressbar', { name: 'Play 3 practice matches: 3 of 3' })).toBeInTheDocument();
    expect(screen.getByTestId('quest-d_play_2-claimed')).toHaveTextContent('Claimed · +10');
    expect(screen.queryByTestId('quest-d_win_quiet-claim')).not.toBeInTheDocument();
    expect(screen.getByTestId('s02-streak')).toHaveTextContent('Streak 3 days · play today to keep it · best 5 days');
    expect(panel).toHaveTextContent('refill free credits you spent today');
  });

  it('claims a finished quest and shows what it refilled', async () => {
    const { user, api } = renderWithProviders(<HomeScreen />, {
      handle: 'ada',
      api: {
        me: async () => meFixture(),
        quests: async () => board(),
        claimQuest: async (id) => ({
          quest: quest({ id, title: 'Play 3 practice matches', target: 3, progress: 3, done: true, claimed: true, credited: 10 }),
          credited: 10,
          allowanceLeft: 40,
        }),
      },
    });
    await user.click(await screen.findByTestId('quest-d_practice_3-claim'));
    expect(api.claimQuest).toHaveBeenCalledWith('d_practice_3');
    await waitFor(() => expect(screen.getByTestId('quest-d_practice_3-claimed')).toHaveTextContent('Claimed · +10'));
    expect(await screen.findByText('+10 free credits · 40 free left today')).toBeInTheDocument();
  });

  it('explains a claim refused while the free credits are full', async () => {
    const { user } = renderWithProviders(<HomeScreen />, {
      handle: 'ada',
      api: {
        me: async () => meFixture(),
        quests: async () => board(),
        claimQuest: async () => {
          throw new ApiError(409, 'allowance_full', 'full');
        },
      },
    });
    await user.click(await screen.findByTestId('quest-d_practice_3-claim'));
    expect(await screen.findByText('Your free credits are full')).toBeInTheDocument();
    expect(screen.getByTestId('quest-d_practice_3-claim')).toBeInTheDocument();
  });

  it('stays out of the way when quests do not load', async () => {
    renderWithProviders(<HomeScreen />, {
      handle: 'ada',
      api: {
        me: async () => meFixture(),
        quests: async () => {
          throw new ApiError(500, 'internal', 'boom');
        },
      },
    });
    await screen.findByTestId('s02-deck');
    expect(screen.queryByTestId('s02-quests')).not.toBeInTheDocument();
  });
});
