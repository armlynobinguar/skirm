import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { DailyAttempt, DailyBoard, DailyChallenge, DailyToday } from '@/lib/api/types';
import { ROOK, meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { DailyScreen, countdown, pastDays, shortHash } from './DailyScreen';

const WREN = 'agt_01J0000000000000000000WREN';
const MOSS = 'agt_01J0000000000000000000MOSS';

const challenge = (o: Partial<DailyChallenge> = {}): DailyChallenge => ({
  date: '2026-11-05',
  seed: '82f63d5b',
  mapId: 'saltmarsh-weir',
  mapName: 'Saltmarsh Weir',
  difficulty: 'normal',
  twist: 'sly_bot',
  twistName: 'Sly bot',
  twistLine: 'The bot may tell three more bluffs',
  crewSize: 2,
  ticks: 150,
  bot: { tier: 'standard', hold: 0, lieCap: 5 },
  ...o,
});

const attempt = (o: Partial<DailyAttempt> = {}): DailyAttempt => ({
  id: 'dly_1',
  date: '2026-11-05',
  status: 'done',
  brain: 'greedy',
  credits: 0,
  crew: [{ name: 'Rook', role: 'Builder', skills: ['Flood Warden'] }],
  points: 10_250,
  outcome: 'win',
  ticks: 100,
  logHash: 'abcdef0123456789'.repeat(4),
  result: {
    seed: '82f63d5b',
    mapId: 'saltmarsh-weir',
    difficulty: 'normal',
    twist: 'sly_bot',
    outcome: 'win',
    reason: 'goal',
    decidedBy: 'goal',
    score: { you: 3, bot: 1 },
    ticks: 100,
    clock: 150,
    points: 10_250,
    logHash: 'abcdef0123456789'.repeat(4),
    calls: 0,
  },
  shortfall: null,
  error: null,
  createdAt: '2026-11-05T08:00:00Z',
  finishedAt: '2026-11-05T08:00:05Z',
  ...o,
});

const today = (o: Partial<DailyToday> = {}): DailyToday => ({
  challenge: challenge(),
  brain: 'greedy',
  free: true,
  costCredits: 0,
  attempts: { perDay: 3, used: 1, left: 2 },
  msLeft: 3_723_000,
  endsAt: '2026-11-06T00:00:00.000Z',
  mine: [attempt()],
  ...o,
});

const board = (o: Partial<DailyBoard> = {}): DailyBoard => ({
  date: '2026-11-05',
  challenge: challenge(),
  players: 12,
  top: [
    { rank: 1, attemptId: 'dly_9', handle: 'zed', you: false, points: 10_300, outcome: 'win', ticks: 80, logHash: '1234567890abcdef'.repeat(4), crew: [{ name: 'Ash', role: 'Digger', skills: [] }], finishedAt: '2026-11-05T07:00:00Z' },
  ],
  me: { rank: 7, attemptId: 'dly_1', handle: 'ada', you: true, points: 10_250, outcome: 'win', ticks: 100, logHash: 'abcdef0123456789'.repeat(4), crew: [{ name: 'Rook', role: 'Builder', skills: [] }], finishedAt: '2026-11-05T08:00:05Z' },
  ...o,
});

describe('helpers', () => {
  it('formats the countdown, short hashes and the past days', () => {
    expect(countdown(3_723_000)).toBe('01:02:03');
    expect(countdown(-5)).toBe('00:00:00');
    expect(shortHash('abcdef0123456789')).toBe('abcdef0123');
    expect(shortHash(null)).toBe('—');
    expect(pastDays('2026-03-01', 3)).toEqual(['2026-03-01', '2026-02-28', '2026-02-27']);
  });
});

describe('Daily challenge', () => {
  it("shows today's card, your attempts and the board with your rank, and runs the picked crew", async () => {
    const { api, user } = renderWithProviders(<DailyScreen />, {
      handle: 'ada',
      api: {
        me: async () => meFixture(),
        daily: async () => today(),
        dailyBoard: async () => board(),
        startDailyAttempt: async () => attempt({ id: 'dly_2', status: 'queued', points: null, outcome: null, result: null, logHash: null }),
      },
    });
    const card = await screen.findByTestId('daily-challenge');
    expect(card).toHaveTextContent('Saltmarsh Weir');
    expect(card).toHaveTextContent('seed 82f63d5b');
    expect(within(card).getByTestId('daily-twist')).toHaveTextContent('Sly bot');
    expect(within(card).getByTestId('daily-countdown')).toHaveTextContent('01:02:03');
    expect(screen.getByTestId('daily-cost')).toHaveTextContent('2 of 3 attempts left today');

    const mine = screen.getByTestId('daily-attempt-dly_1');
    expect(within(mine).getByTestId('daily-outcome-dly_1')).toHaveTextContent('Win');
    expect(mine).toHaveTextContent('10,250 pts');
    expect(mine).toHaveTextContent('abcdef0123');

    const table = await screen.findByTestId('daily-board');
    expect(within(table).getByTestId('daily-board-row-1')).toHaveTextContent('zed');
    expect(within(table).getByTestId('daily-board-row-1')).toHaveTextContent('Ash (Digger)');
    // You are below the top: your row is added under it.
    expect(within(table).getByTestId('daily-board-row-7')).toHaveTextContent('ada (you)');
    expect(screen.getByText(/12 players on 2026-11-05 · you are #7/)).toBeInTheDocument();

    // The crew defaults to your first agents up to the bot's size; swap Wren for Moss.
    await screen.findByTestId(`daily-agent-${ROOK}`);
    expect(screen.getByTestId(`daily-agent-${MOSS}`)).toBeDisabled();
    await user.click(screen.getByTestId(`daily-agent-${WREN}`));
    await user.click(screen.getByTestId(`daily-agent-${MOSS}`));
    await user.click(screen.getByTestId('daily-run'));
    await waitFor(() => expect(api.startDailyAttempt).toHaveBeenCalledWith([ROOK, MOSS]));
  });

  it('no attempts left: the run button says so; a model brain shows the cost', async () => {
    renderWithProviders(<DailyScreen />, {
      handle: 'ada',
      api: {
        me: async () => meFixture(),
        daily: async () => today({ brain: 'model', free: false, costCredits: 60, attempts: { perDay: 3, used: 3, left: 0 }, mine: [] }),
        dailyBoard: async () => board({ top: [], me: null, players: 0 }),
      },
    });
    expect(await screen.findByTestId('daily-run')).toBeDisabled();
    expect(screen.getByTestId('daily-run')).toHaveTextContent('No attempts left today');
    expect(screen.getByTestId('daily-cost')).toHaveTextContent('holds up to 60 credits');
    expect(await screen.findByText(/Nobody has finished an attempt/)).toBeInTheDocument();
  });

  it('a refused attempt shows the error', async () => {
    const { user } = renderWithProviders(<DailyScreen />, {
      handle: 'ada',
      api: {
        me: async () => meFixture(),
        daily: async () => today(),
        dailyBoard: async () => board(),
        startDailyAttempt: async () => {
          throw new ApiError(429, 'daily_limit', 'at most 3 daily attempts a day');
        },
      },
    });
    await screen.findByTestId(`daily-agent-${ROOK}`);
    await user.click(screen.getByTestId('daily-run'));
    expect(await screen.findByText('No attempts left today')).toBeInTheDocument();
  });
});
