import { screen, waitFor, within } from '@testing-library/react';
import { PUZZLES, puzzleGoal } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { HomeScreen } from '@/features/play/HomeScreen';
import { ApiError } from '@/lib/api/errors';
import type { PuzzleDetail, PuzzleList, PuzzleRun, PuzzleView } from '@/lib/api/puzzleTypes';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { PuzzleScreen } from './PuzzleScreen';
import { PuzzlesScreen } from './PuzzlesScreen';
import { goalText } from './parts';

const ME = meFixture();

function view(i: number, best: PuzzleView['best'] = null): PuzzleView {
  const p = PUZZLES[i]!;
  return {
    id: p.id,
    n: p.n,
    title: p.title,
    briefing: p.briefing,
    goal: puzzleGoal(p),
    crewSize: p.crewSize,
    cap: p.cap,
    par: p.medals.gold,
    medals: p.medals,
    item: p.item,
    deliverTo: p.deliverTo,
    costCredits: 0,
    best,
  };
}

const best = (score: number, medal: 'gold' | 'silver' | 'bronze' | null): PuzzleView['best'] => ({
  score,
  ticks: score,
  medal,
  runId: 'pzr_1',
  logHash: 'a'.repeat(64),
  brain: 'greedy',
  solves: 2,
  achievedAt: '2026-11-03T08:00:00Z',
});

const list = (): PuzzleList => ({
  brain: 'greedy',
  free: true,
  limit: { perHour: 30, used: 2, left: 28 },
  puzzles: PUZZLES.map((_, i) => view(i, i === 0 ? best(17, 'gold') : null)),
  medals: { gold: 1, silver: 0, bronze: 0, solved: 1, total: PUZZLES.length },
});

const detail = (runs: PuzzleRun[] = []): PuzzleDetail => {
  const p = PUZZLES[0]!;
  return { ...view(0), board: { layout: p.layout, w: p.layout[0]!.length, h: p.layout.length, hazards: [], blockSupply: 0 }, runs };
};

const run = (o: Partial<PuzzleRun> = {}): PuzzleRun => ({
  id: 'pzr_01JB7Z3K9QX4M2T8V6N5R1C0DE',
  puzzleId: 'pz-1',
  crew: [{ agentId: ME.agents[0]!.id, tier: 'standard' }],
  status: 'done',
  brain: 'greedy',
  credits: 0,
  result: {
    puzzleId: 'pz-1',
    solved: true,
    reason: 'goal',
    ticks: 17,
    score: 17,
    medal: 'gold',
    delivered: 1,
    knockdowns: 0,
    logHash: 'b'.repeat(64),
    best: true,
    crew: [{ agentId: ME.agents[0]!.id, name: ME.agents[0]!.name, role: 'Builder' }],
    calls: 0,
    events: [{ tick: 17, side: 'you', kind: 'delivered', text: 'Rook delivered 1 (score 1)' }],
    eventsDropped: 0,
  },
  shortfall: null,
  error: null,
  createdAt: '2026-11-03T08:00:00Z',
  finishedAt: '2026-11-03T08:00:02Z',
  ...o,
});

describe('Puzzles (/puzzles)', () => {
  it('shows every puzzle with its goal, par and the caller’s medal', async () => {
    renderWithProviders(<PuzzlesScreen />, { handle: 'ada', path: '/puzzles', api: { puzzles: async () => list() } });
    expect(await screen.findByTestId('puzzles-tally')).toHaveTextContent(`1 of ${PUZZLES.length} solved`);
    const first = screen.getByTestId('puzzle-card-pz-1');
    expect(first).toHaveAttribute('href', '/puzzles/pz-1');
    expect(within(first).getByText('First Steps')).toBeInTheDocument();
    expect(within(first).getByText(`Par ${PUZZLES[0]!.medals.gold}`)).toBeInTheDocument();
    expect(screen.getByTestId('puzzle-medal-pz-1')).toHaveTextContent('Gold');
    expect(screen.getByTestId('puzzle-best-pz-2')).toHaveTextContent('Unsolved');
  });

  it('links from home', async () => {
    renderWithProviders(<HomeScreen />, { handle: 'ada', path: '/play', api: { me: async () => meFixture() } });
    expect(await screen.findByTestId('puzzles-strip-go')).toHaveAttribute('href', '/puzzles');
  });

  it('reads each goal kind', () => {
    expect(goalText({ kind: 'deliver', count: 2 }, 'Ore')).toBe('Deliver 2 Ore');
    expect(goalText({ kind: 'reach', at: [1, 2] }, 'Ore')).toBe('Reach the marked tile');
    expect(goalText({ kind: 'survive', ticks: 40 }, 'Ore')).toBe('Hold out 40 ticks');
  });
});

describe('Puzzle (/puzzles/:id)', () => {
  it('previews the board, runs the chosen crew and shows the result and the board', async () => {
    let polled = 0;
    const { user, api } = renderWithProviders(<PuzzleScreen puzzleId="pz-1" />, {
      handle: 'ada',
      path: '/puzzles/pz-1',
      api: {
        me: async () => ME,
        puzzle: async () => detail(),
        puzzleLeaderboard: async () => ({
          puzzleId: 'pz-1',
          par: 17,
          medals: PUZZLES[0]!.medals,
          entries: [{ rank: 1, account: { id: ME.account.id, handle: 'ada' }, score: 17, ticks: 17, medal: 'gold', logHash: 'b'.repeat(64), brain: 'greedy', achievedAt: '2026-11-03T08:00:02Z' }],
        }),
        startPuzzleRun: async () => run({ status: 'queued', result: null, finishedAt: null }),
        puzzleRun: async () => (polled++ === 0 ? run({ status: 'running', result: null }) : run()),
      },
    });
    expect(await screen.findByTestId('puzzle-board')).toBeInTheDocument();
    expect(screen.getByTestId('puzzle-par')).toHaveTextContent(String(PUZZLES[0]!.medals.gold));
    expect(screen.getByTestId('puzzle-your-best')).toHaveTextContent('Not solved yet');
    expect(await within(screen.getByTestId('puzzle-leaderboard')).findByText('ada')).toBeInTheDocument();

    // A one-agent puzzle: ticking a second agent swaps the first out.
    await user.click(screen.getByTestId(`puzzle-crew-${ME.agents[1]!.id}`));
    expect(screen.getByTestId(`puzzle-crew-${ME.agents[0]!.id}`)).not.toBeChecked();
    await user.click(screen.getByTestId(`puzzle-crew-${ME.agents[0]!.id}`));
    await user.click(screen.getByTestId('puzzle-run'));
    expect(api.startPuzzleRun).toHaveBeenCalledWith('pz-1', { crew: [{ agentId: ME.agents[0]!.id }] });
    await waitFor(() => expect(screen.getByTestId('puzzle-result-status')).toHaveTextContent('Solved in 17 ticks'), { timeout: 6000 });
    expect(screen.getByTestId('puzzle-result-medal')).toHaveTextContent('Gold');
    expect(screen.getByTestId('puzzle-events')).toHaveTextContent('Rook delivered 1');
  }, 15_000);

  it('explains a run refused over the hourly cap', async () => {
    const { user } = renderWithProviders(<PuzzleScreen puzzleId="pz-1" />, {
      handle: 'ada',
      path: '/puzzles/pz-1',
      api: {
        me: async () => ME,
        puzzle: async () => detail(),
        puzzleLeaderboard: async () => ({ puzzleId: 'pz-1', par: 17, medals: PUZZLES[0]!.medals, entries: [] }),
        startPuzzleRun: async () => {
          throw new ApiError(429, 'puzzle_limit', 'limit');
        },
      },
    });
    await user.click(await screen.findByTestId('puzzle-run'));
    expect(await screen.findByTestId('puzzle-error')).toHaveTextContent('this hour');
    expect(screen.getByText('Nobody has solved it yet. Be the first.')).toBeInTheDocument();
  });
});
