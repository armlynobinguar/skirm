import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { BenchCompare, BenchInfo, BenchRun, BenchRunDetail, BenchRunResult } from '@/lib/api/types';
import { renderWithProviders } from '@/test/render';
import { SECRET_PROMPT, SKILL_ID, skillRowFixture, skillWithTextFixture } from '../testFixtures';
import { BenchRunScreen } from './BenchRunScreen';
import { BenchScreen, benchOptions } from './BenchScreen';

const info: BenchInfo = { brain: 'greedy', free: true, costCredits: 0, limit: { perHour: 20, used: 1, left: 19 } };

const result = (o: Partial<BenchRunResult> = {}): BenchRunResult => ({
  seed: 'copper-hollow:easy',
  mapId: 'copper-hollow',
  difficulty: 'easy',
  role: 'Builder',
  outcome: 'win',
  reason: 'goal',
  decidedBy: 'goal',
  score: { you: 3, bot: 1 },
  ticks: 64,
  logHash: 'a'.repeat(64),
  talk: { says: 2, leaks: 0, abuse: 0, empty: 0 },
  calls: 0,
  events: [{ tick: 12, side: 'you', kind: 'delivered', text: 'You delivered 1 (score 1)' }],
  eventsDropped: 0,
  debrief: { mvp: 'bench-1', goals: [{ title: 'Seal the leak', met: true, available: true, progress: null }], talk: { sent: 2, overheard: 0 }, verbs: 4, switches: { mine: 0, rival: 0 }, steals: 0, agents: [] },
  ...o,
});

const run = (o: Partial<BenchRun> = {}): BenchRun => ({
  id: 'bnr_1',
  skillId: SKILL_ID,
  version: 1,
  skillName: 'Dam Keeper',
  mapId: 'copper-hollow',
  difficulty: 'easy',
  seed: 'copper-hollow:easy',
  status: 'done',
  brain: 'greedy',
  credits: 0,
  edited: false,
  promptSha256: 'f'.repeat(64),
  result: result(),
  shortfall: null,
  error: null,
  createdAt: '2026-11-03T08:00:00Z',
  finishedAt: '2026-11-03T08:00:05Z',
  ...o,
});

const draft = skillRowFixture({ status: 'Draft' });

describe('benchOptions', () => {
  it('offers drafts the caller wrote and every version they hold, editable only when theirs', () => {
    const opts = benchOptions(
      [draft, skillRowFixture({ id: 'skl_minted', status: 'Minted' })],
      [skillRowFixture({ id: 'skl_minted', status: 'Minted' }), skillRowFixture({ id: 'skl_bought', status: 'Minted' }), skillRowFixture({ id: 'skl_starter', status: 'Minted', accountBound: true })],
    );
    expect(opts.map((o) => [o.skillId, o.mine])).toEqual([
      [SKILL_ID, true],
      ['skl_minted', true],
      ['skl_bought', false],
      ['skl_starter', false],
    ]);
  });
});

describe('Test bench', () => {
  it('runs the draft with the edited prompt on the chosen seed', async () => {
    const { api, user } = renderWithProviders(<BenchScreen />, {
      handle: 'ada',
      search: `?skill=${SKILL_ID}`,
      api: {
        skills: async (tab) => (tab === 'owned' ? [] : [draft]),
        skill: async () => skillWithTextFixture({ reflexes: null }),
        benchInfo: async () => info,
        benchRuns: async () => [],
        startBenchRun: async (body) => run({ id: 'bnr_2', status: 'queued', result: null, mapId: body.mapId, difficulty: body.difficulty }),
      },
    });
    expect(await screen.findByTestId('bench-cost')).toHaveTextContent('Free here');
    const prompt = await screen.findByTestId('bench-prompt');
    expect(prompt).toHaveValue(SECRET_PROMPT);
    await user.selectOptions(screen.getByTestId('bench-difficulty'), 'normal');
    await user.type(prompt, ' Then haul.');
    await user.click(screen.getByTestId('bench-run'));
    await waitFor(() =>
      expect(api.startBenchRun).toHaveBeenCalledWith({
        skillId: SKILL_ID,
        version: 1,
        mapId: expect.any(String),
        difficulty: 'normal',
        prompt: `${SECRET_PROMPT} Then haul.`,
        reflexes: null,
      }),
    );
  });

  it('re-runs a seed, and compares two ticked runs with the prompt diff', async () => {
    const a = run({ id: 'bnr_a', mapId: 'copper-hollow', difficulty: 'hard' });
    const b = run({ id: 'bnr_b', edited: true, result: result({ outcome: 'loss', score: { you: 1, bot: 3 } }) });
    const compare: BenchCompare = {
      a,
      b,
      prompt: { hidden: false, same: false, diff: [{ op: 'same', text: 'block ' }, { op: 'del', text: 'narrow' }, { op: 'add', text: 'wide' }] },
    };
    const { api, user } = renderWithProviders(<BenchScreen />, {
      handle: 'ada',
      api: {
        skills: async (tab) => (tab === 'owned' ? [] : [draft]),
        skill: async () => skillWithTextFixture(),
        benchInfo: async () => info,
        benchRuns: async () => [b, a],
        startBenchRun: async () => run({ id: 'bnr_c', status: 'queued', result: null }),
        compareBenchRuns: async () => compare,
      },
    });
    const row = await screen.findByTestId('bench-run-bnr_a');
    expect(within(row).getByTestId('bench-outcome-bnr_a')).toHaveTextContent('Win');
    expect(within(row).getByTestId('bench-debrief-bnr_a')).toHaveAttribute('href', '/skills/bench/bnr_a');
    await screen.findByTestId('bench-prompt');
    await user.click(within(row).getByTestId('bench-rerun-bnr_a'));
    await waitFor(() => expect(api.startBenchRun).toHaveBeenCalledWith(expect.objectContaining({ mapId: 'copper-hollow', difficulty: 'hard' })));

    await user.click(screen.getByTestId('bench-pick-bnr_a'));
    expect(screen.getByText(/Tick one more run/)).toBeInTheDocument();
    await user.click(screen.getByTestId('bench-pick-bnr_b'));
    const cmp = await screen.findByTestId('bench-compare');
    await within(cmp).findByTestId('bench-diff');
    expect(within(cmp).getByText('narrow').tagName).toBe('DEL');
    expect(within(cmp).getByText('wide').tagName).toBe('INS');
    expect(within(within(cmp).getByTestId('bench-compare-b')).getByTestId('bench-outcome-bnr_b')).toHaveTextContent('Loss');
  });

  it('holds back a bought version’s text and blocks runs past the hourly cap', async () => {
    const { user } = renderWithProviders(<BenchScreen />, {
      handle: 'ada',
      api: {
        skills: async (tab) => (tab === 'owned' ? [skillRowFixture({ id: 'skl_bought', status: 'Minted' })] : []),
        benchInfo: async () => ({ ...info, limit: { perHour: 20, used: 20, left: 0 } }),
        benchRuns: async () => [],
      },
    });
    expect(await screen.findByText(/did not write it/)).toBeInTheDocument();
    expect(screen.queryByTestId('bench-prompt')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('bench-run')).toBeDisabled());
    await user.click(screen.getByTestId('bench-run'));
  });

  it('shows the bench_limit error from the server', async () => {
    const { user } = renderWithProviders(<BenchScreen />, {
      handle: 'ada',
      api: {
        skills: async (tab) => (tab === 'owned' ? [] : [draft]),
        skill: async () => skillWithTextFixture(),
        benchInfo: async () => info,
        benchRuns: async () => [],
        startBenchRun: async () => {
          throw new ApiError(429, 'bench_limit', 'at most 20 bench runs an hour');
        },
      },
    });
    await screen.findByTestId('bench-prompt');
    await user.click(screen.getByTestId('bench-run'));
    expect(await screen.findByText('Bench limit reached')).toBeInTheDocument();
  });
});

describe('Bench debrief', () => {
  it('shows the verdict, debrief, key events and the prompt that played', async () => {
    const detail: BenchRunDetail = { ...run({ edited: true }), prompt: 'EDITED prompt', reflexes: null, promptHidden: false };
    renderWithProviders(<BenchRunScreen runId="bnr_1" />, { handle: 'ada', api: { benchRun: async () => detail } });
    expect(await screen.findByTestId('bench-debrief')).toBeInTheDocument();
    expect(screen.getByTestId('bench-events')).toHaveTextContent('You delivered 1');
    expect(screen.getByTestId('bench-run-prompt')).toHaveTextContent('EDITED prompt');
    expect(screen.getByTestId('bench-run-again')).toHaveAttribute('href', `/skills/bench?skill=${SKILL_ID}&version=1&map=copper-hollow&d=easy`);
  });
});
