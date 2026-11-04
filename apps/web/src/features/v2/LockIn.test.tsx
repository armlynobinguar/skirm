import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { skillRowFixture } from '@/features/skills/testFixtures';
import { FakeRealtime } from '@/test/fakeRealtime';
import { agentFixture, meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { V2MatchScreen } from './V2MatchScreen';
import { v2StoreFor } from './v2Store';

const WICK = agentFixture({ id: 'agt_wick', name: 'Wick', role: 'Builder', vision: 4, comms: 3, tier: 'standard', skills: [{ id: 'skl_mine', version: 2, name: 'Dam First' }] });
const MOSS = agentFixture({ id: 'agt_moss', name: 'Moss', role: 'Runner', vision: 3, comms: 3, tier: 'open', skills: [{ id: 'skl_bought', version: 5, name: 'Clean Sweep' }] });
const ROOK = agentFixture({ id: 'agt_rook', name: 'Rook', role: 'Scout', vision: 5, comms: 4, tier: 'quiet' });

function setup({ ranked = false, crewLimit, difficulty }: { ranked?: boolean; crewLimit?: number; difficulty?: 'hard' | 'mega' } = {}) {
  const rt = new FakeRealtime();
  v2StoreFor(rt).queued = [
    { agentId: WICK.id, name: 'Wick', tier: 'standard' },
    { agentId: MOSS.id, name: 'Moss', tier: 'open' },
  ];
  const r = renderWithProviders(<V2MatchScreen matchId="mat_lk" />, {
    realtime: rt,
    handle: 'ada',
    path: '/matches/mat_lk',
    search: '',
    api: {
      me: async () => meFixture({ agents: [WICK, MOSS, ROOK] }),
      skills: async (tab) => (tab === 'written' ? [skillRowFixture({ id: 'skl_mine', name: 'Dam First' })] : []),
    },
  });
  act(() => {
    rt.emit({ type: 'v2_found', matchId: 'mat_lk', team: 'A', mapId: 'copper-hollow', ranked, acceptMs: 10_000, ...(difficulty ? { difficulty } : {}) });
    rt.emit({ type: 'v2_lockin', matchId: 'mat_lk', lockMs: 30_000, rival: { agents: 2 }, ...(crewLimit ? { crewLimit } : {}) });
  });
  return { ...r, rt };
}

afterEach(() => vi.useRealTimers());

describe('v2 lock-in', () => {
  it('shows a card per queued agent with role, verb fit, skill, pips and talk tier', async () => {
    setup();
    const wick = await screen.findByTestId(`v2-card-${WICK.id}`);
    expect(await within(wick).findByText('Dam First')).toBeInTheDocument();
    expect(wick).toHaveTextContent('Builder');
    expect(await within(wick).findByText(/Skill · v2 · yours/)).toBeInTheDocument();
    expect(within(wick).getByRole('img', { name: 'Vision 4 of 5' })).toBeInTheDocument();
    const moss = screen.getByTestId(`v2-card-${MOSS.id}`);
    expect(moss).toHaveTextContent('take + deliver only');
    expect(await within(moss).findByText(/prompt encrypted/)).toBeInTheDocument();
    expect(within(moss).getByRole('radio', { name: 'Open' })).toBeChecked();
    // Each tier's rate shows as decimal credits per agent per tick.
    expect(within(moss).getByRole('radio', { name: 'Quiet' })).toHaveAttribute('title', 'Callouts only · 0.20 credits per tick');
    expect(within(moss).getByRole('radio', { name: 'Standard' })).toHaveAttribute('title', 'A line every 5 ticks · 0.20 credits per tick');
    expect(within(moss).getByRole('radio', { name: 'Open' })).toHaveAttribute('title', 'A line every tick · 0.40 credits per tick');
    // 150 ticks × (0.20 + 0.40); the head start with 2 against 2.
    expect(screen.getByTestId('v2-hold')).toHaveTextContent('Hold 90 credits · 0.60 per tick');
    expect(screen.getByTestId('v2-lockin')).toHaveTextContent('150 ticks × (0.20 + 0.40) credits per tick');
    expect(screen.getByTestId('v2-head-start')).toHaveTextContent('Rival fields 2 · no head start');
    expect(screen.getByTestId('goal-box')).toHaveTextContent('Normal');
    // A real 30 s countdown: on a slow machine the awaits above can take a second or more.
    expect(screen.getByRole('timer', { name: 'Time left to lock in' })).toHaveTextContent(/^0:(30|2\d)$/);
  });

  it('adds from the roster, removes an agent and sends the new crew with its tiers', async () => {
    const { rt, user } = setup();
    await user.click(await screen.findByTestId(`v2-roster-${ROOK.id}`));
    expect(screen.getByTestId(`v2-card-${ROOK.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('v2-head-start')).toHaveTextContent('Rival fields 2 · they start 10 s ahead');
    expect(screen.getByTestId('v2-hold')).toHaveTextContent('Hold 120 credits · 0.80 per tick');
    await user.click(screen.getByRole('button', { name: 'Remove Moss' }));
    expect(screen.queryByTestId(`v2-card-${MOSS.id}`)).not.toBeInTheDocument();
    await user.click(screen.getByTestId('v2-lock'));
    expect(rt.sentOf('v2_lock_in')).toEqual([
      {
        type: 'v2_lock_in',
        matchId: 'mat_lk',
        tiers: ['standard', 'quiet'],
        crew: [
          { agentId: WICK.id, tier: 'standard' },
          { agentId: ROOK.id, tier: 'quiet' },
        ],
      },
    ]);
    expect(screen.getByTestId('v2-lockin')).toHaveTextContent('Locked · waiting for the rival');
  });

  it('keeps the crew limit and at least one agent', async () => {
    const { user } = setup({ crewLimit: 2 });
    await user.click(await screen.findByTestId(`v2-roster-${ROOK.id}`));
    expect(screen.queryByTestId(`v2-card-${ROOK.id}`)).not.toBeInTheDocument();
    expect(await screen.findByText('2 agents is the most this map takes.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Moss' }));
    await user.click(screen.getByRole('button', { name: 'Remove Wick' }));
    expect(screen.getByTestId(`v2-card-${WICK.id}`)).toBeInTheDocument();
    expect(await screen.findByText('A crew needs at least one agent.')).toBeInTheDocument();
  });

  it('plays ranked at Standard and Normal, whatever the agents default to', async () => {
    const { rt, user } = setup({ ranked: true });
    const moss = await screen.findByTestId(`v2-card-${MOSS.id}`);
    expect(within(moss).getByRole('radio', { name: 'Standard' })).toBeChecked();
    expect(within(moss).getByRole('radio', { name: 'Open' })).toBeDisabled();
    expect(screen.getByTestId('v2-hold')).toHaveTextContent('Hold 60 credits · 0.40 per tick');
    expect(screen.getByTestId('goal-box')).toHaveTextContent('Ranked always plays Normal');
    await user.click(screen.getByTestId('v2-lock'));
    expect(rt.sentOf('v2_lock_in')).toEqual([{ type: 'v2_lock_in', matchId: 'mat_lk', tiers: ['standard', 'standard'] }]);
  });

  it('prices a casual difficulty by its clock', async () => {
    setup({ difficulty: 'mega' });
    await screen.findByTestId(`v2-card-${WICK.id}`);
    // Mega: 120 ticks × (0.20 + 0.40).
    expect(screen.getByTestId('v2-hold')).toHaveTextContent('Hold 72 credits');
    expect(screen.getByTestId('v2-lockin')).toHaveTextContent('Mega Agentic');
  });

  it('locks what is on screen as the countdown runs out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rt } = setup();
    await screen.findByTestId(`v2-card-${WICK.id}`);
    expect(rt.sentOf('v2_lock_in')).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(29_800);
    });
    expect(rt.sentOf('v2_lock_in')).toEqual([{ type: 'v2_lock_in', matchId: 'mat_lk', tiers: ['standard', 'open'] }]);
  });
});
