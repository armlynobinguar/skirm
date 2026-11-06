import { act, screen, waitFor, within } from '@testing-library/react';
import { rankTitle } from '@skirm/shared';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import {
  ME_ID,
  ROOK,
  currentSeasonFixture,
  earnBackFixture,
  meFixture,
  seasonFixture,
  standingFixture,
  v2LiveMatchFixture,
} from '@/test/fixtures';
import { PvpLobbyScreen } from './PvpLobbyScreen';
import { v2StoreFor } from '@/features/v2/v2Store';

const WREN = 'agt_01J0000000000000000000WREN';

function setup(o: { api?: NonNullable<Parameters<typeof renderWithProviders>[1]>['api']; me?: ReturnType<typeof meFixture> } = {}) {
  return renderWithProviders(<PvpLobbyScreen />, {
    handle: 'ada',
    path: '/pvp',
    api: {
      me: async () => o.me ?? rich(),
      v2LiveMatches: async () => [],
      currentSeason: async () => currentSeasonFixture(),
      earnBack: async () => earnBackFixture(),
      ...o.api,
    },
  });
}

function rich() {
  const me = meFixture();
  me.credits = { ...me.credits, balance: 2000, available: 2060 };
  return me;
}

async function ready() {
  await screen.findByTestId('screen-s11');
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Rook/ })).toHaveAttribute('aria-checked', 'true'));
}

const standing = (rank: number, handle: string, points: number, id = `acc_${handle}`) =>
  standingFixture({ rank, points, account: { id, handle }, projectedPrizeYocto: null });

function vsFound(o: { matchId?: string; ranked?: boolean; difficulty?: 'hard' } = {}) {
  return {
    type: 'v2_found' as const,
    matchId: o.matchId ?? 'mat_1',
    team: 'B' as const,
    mapId: 'copper-hollow',
    ranked: o.ranked ?? true,
    acceptMs: 10_000,
    ...(o.difficulty ? { difficulty: o.difficulty } : {}),
  };
}

describe('S11 Skirmish hub', () => {
  it('shows the rank title, record, ladder place, the season pool and split, and the season top 10 with you marked', async () => {
    const me = rich();
    me.rank = { elo: 1240, rankedMatches: 23, wins: 14, losses: 9, draws: 0, title: rankTitle(1240).title, position: 7 };
    setup({
      me,
      api: {
        currentSeason: async () =>
          currentSeasonFixture({
            top: [standing(1, 'nova', 130), standing(2, 'mira', 105), standing(7, 'ada', 50, ME_ID), standing(8, 'kai', 42)],
            you: standing(7, 'ada', 50, ME_ID),
          }),
      },
    });
    await ready();
    expect(screen.getByTestId('s11-elo')).toHaveTextContent('1,240');
    expect(screen.getByTestId('s11-title')).toHaveTextContent('Breach Runner II');
    const card = screen.getByRole('region', { name: 'Your rank' });
    expect(card).toHaveTextContent('W14L9Rank#7');
    expect(card).toHaveTextContent('Next title at 1,300 Elo');
    expect(await within(card).findByTestId('s11-season')).toHaveTextContent('Ranked · Season 3');
    expect(within(card).queryByText('Soon')).not.toBeInTheDocument();
    const ladder = screen.getByTestId('s11-ladder');
    expect(await within(ladder).findByText('nova')).toBeInTheDocument();
    expect(ladder).toHaveTextContent('Season 3 · top 10 paid');
    expect(within(ladder).getByTestId('s11-ladder-1')).toHaveTextContent('01nova130 pts30%');
    expect(within(ladder).getByTestId('s11-ladder-7')).toHaveClass(/you/);
    expect(within(ladder).getByTestId('s11-ladder-8')).toHaveTextContent('kai42 pts5%');
    expect(within(ladder).getByTestId('s11-ladder-8')).not.toHaveClass(/you/);
    expect(within(ladder).getByTestId('s11-ladder-more')).toHaveAttribute('href', '/leaderboards');
    const pool = screen.getByRole('region', { name: /Season 3 prize pool/ });
    expect(within(pool).getByTestId('s11-pool')).toHaveTextContent('12.50 NEARlocal');
    expect(within(pool).getByTestId('s11-pool-local')).toHaveAttribute('title', 'Kept offchain until the seasons contract is deployed');
    expect(pool).toHaveTextContent('1st30%2nd20%3rd15%4th–10th5% each');
    expect(pool).toHaveTextContent('Paid in NEAR to the top 10 when the season ends');
    expect(within(pool).getByTestId('s11-pool-ends')).toHaveTextContent(/^2d 0[23]h \d\dm$/);
    expect(screen.queryByText('Soon')).not.toBeInTheDocument();
    expect(screen.getByTestId('s11-rotation')).toHaveTextContent('Ranked rotation · all 10 maps · 31×13 to 55×25');
  });

  it('reads the pool split from the season, and drops the local label once it is onchain', async () => {
    setup({
      api: {
        currentSeason: async () => currentSeasonFixture({ season: seasonFixture({ number: 4, poolSource: 'onchain', splitBps: [6000, 3000, 1000] }) }),
      },
    });
    await ready();
    const pool = await screen.findByRole('region', { name: /Season 4 prize pool/ });
    expect(await within(pool).findByText('Paid in NEAR to the top 3 when the season ends')).toBeInTheDocument();
    expect(pool).toHaveTextContent('1st60%2nd30%3rd10%');
    expect(within(pool).queryByTestId('s11-pool-local')).not.toBeInTheDocument();
  });

  it('shows the ladder place from /me, and lists you below the season top', async () => {
    const me = rich();
    me.rank = { elo: 1105, rankedMatches: 3, wins: 1, losses: 2, draws: 0, title: rankTitle(1105).title, position: 14 };
    const top = Array.from({ length: 10 }, (_, i) => standing(i + 1, `p${i + 1}`, 200 - i * 10));
    setup({
      me,
      api: {
        currentSeason: async () => currentSeasonFixture({ top, you: standing(12, 'ada', 30, ME_ID) }),
      },
    });
    await ready();
    const ladder = screen.getByTestId('s11-ladder');
    const you = await within(ladder).findByTestId('s11-ladder-12');
    expect(you).toHaveClass(/you/);
    expect(you).toHaveTextContent('12ada30 pts—');
    expect(await screen.findByTestId('s11-position')).toHaveTextContent('#14');
    expect(screen.getByTestId('s11-title')).toHaveTextContent('Breach Runner I');
  });

  it('shows no place before the first ranked match, and an empty season', async () => {
    setup({ api: { currentSeason: async () => currentSeasonFixture({ top: [] }) } });
    await ready();
    expect(screen.getByTestId('s11-position')).toHaveTextContent('—');
    expect(screen.getByTestId('s11-title')).toHaveTextContent('Breach Runner II');
    expect(await within(screen.getByTestId('s11-ladder')).findByText(/No ranked matches this season yet/)).toBeInTheDocument();
  });

  it('links to private lobbies, tournaments and match verification from the hub', async () => {
    setup();
    await ready();
    expect(screen.getByTestId('s11-more-lobbies')).toHaveAttribute('href', '/lobbies');
    expect(screen.getByTestId('s11-more-tournaments')).toHaveAttribute('href', '/tournaments');
    expect(screen.getByTestId('s11-more-verify')).toHaveAttribute('href', '/verify');
  });

  it('shows an error card with Retry when the season fails', async () => {
    const { api, user } = setup({ api: { currentSeason: async () => Promise.reject(new Error('boom')) } });
    await ready();
    const ladder = screen.getByTestId('s11-ladder');
    const card = await within(ladder).findByTestId('error-card');
    api.currentSeason.mockResolvedValue(currentSeasonFixture());
    await user.click(within(card).getByRole('button', { name: /Retry/ }));
    expect(await within(ladder).findByText('nova')).toBeInTheDocument();
  });

  it('shows real earn-back values, season prizes included, and rentals as not offered', async () => {
    setup();
    await ready();
    const earn = screen.getByTestId('s11-earn');
    expect(await within(earn).findByTestId('s11-earn-sales')).toHaveTextContent('1.84 NEAR');
    expect(within(earn).getByTestId('s11-earn-spent')).toHaveTextContent('−2.10 NEAR');
    expect(within(earn).getByTestId('s11-earn-prizes')).toHaveTextContent('0.50 NEAR');
    expect(within(earn).getByTestId('s11-earn-rentals')).toHaveTextContent('Not offered yet');
    expect(earn).toHaveTextContent('Season prizes');
    expect(within(earn).queryByText('Soon')).not.toBeInTheDocument();
  });

  it('shows rentals once the api has them, and an error card when earn-back fails', async () => {
    const { api, user } = setup({
      api: { earnBack: async () => Promise.reject(new Error('boom')) },
    });
    await ready();
    const earn = screen.getByTestId('s11-earn');
    const card = await within(earn).findByTestId('error-card');
    api.earnBack.mockResolvedValueOnce(
      earnBackFixture({ prizesYocto: '1500000000000000000000000', rentalsYocto: '360000000000000000000000', spentCredits: 0 }),
    );
    await user.click(within(card).getByRole('button', { name: /Retry/ }));
    expect(await within(earn).findByText('1.50 NEAR')).toBeInTheDocument();
    expect(within(earn).getByText('0.36 NEAR')).toBeInTheDocument();
    expect(within(earn).getByTestId('s11-earn-spent')).toHaveTextContent('0.00 NEAR');
  });
});

describe('S11 PvP lobby', () => {
  it('asks signed-out visitors to sign in', async () => {
    renderWithProviders(<PvpLobbyScreen />, { path: '/pvp', api: { v2LiveMatches: async () => [] } });
    expect(await screen.findByTestId('signin-required')).toBeInTheDocument();
  });

  it('queues a v2 ranked match with the picked agent at Standard and shows the hold', async () => {
    const { realtime, user } = setup();
    await ready();
    expect(screen.getByTestId('s11-credits-chip')).toHaveTextContent('2,060 credits to spend');
    expect(screen.getByTestId('s11-cost')).toHaveTextContent('Holds 30 credits · 0.20 per tick');
    await user.click(screen.getByTestId('s11-find-match'));
    expect(realtime.sent).toEqual([{ type: 'v2_queue', ranked: true, crew: [{ agentId: ROOK, tier: 'standard' }] }]);
    expect(v2StoreFor(realtime).queued).toEqual([{ agentId: ROOK, name: 'Rook', tier: 'standard' }]);
    expect(screen.getByRole('heading', { name: 'Finding a match' })).toBeInTheDocument();
    expect(screen.getByTestId('s11-elo-range')).toHaveTextContent('Starting search');
  });

  it('shows search time and the widening Elo range, and cancels', async () => {
    const { realtime, user } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit({ type: 'queue_status', searchingMs: 23_000, eloRange: 200 }));
    expect(screen.getByTestId('s11-searching-time')).toHaveTextContent('0:23');
    expect(screen.getByTestId('s11-elo-range')).toHaveTextContent('1,000 – 1,400');
    await user.click(screen.getByTestId('s11-cancel'));
    expect(realtime.sent.at(-1)).toEqual({ type: 'v2_cancel_queue' });
    expect(screen.getByTestId('s11-find-match')).toBeEnabled();
  });

  it('cancels with Esc while searching', async () => {
    const { realtime, user } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit({ type: 'queue_status', searchingMs: 1000, eloRange: 100 }));
    screen.getByTestId('s11-cancel').focus();
    await user.keyboard('{Escape}');
    expect(realtime.sent.at(-1)).toEqual({ type: 'v2_cancel_queue' });
    expect(screen.getByTestId('s11-find-match')).toBeInTheDocument();
  });

  it('shows the VS takeover on v2_found, rival hidden, and opens the match screen on Accept', async () => {
    const { realtime, user, router } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit(vsFound()));
    const vs = screen.getByRole('dialog', { name: /Match found/ });
    expect(vs).toHaveTextContent('Match found · ranked · CH-05 Copper Hollow');
    expect(vs).toHaveTextContent('You · Elo 1,200');
    expect(vs).toHaveTextContent('ada');
    expect(within(screen.getByTestId('s11-vs-faces-you')).getByRole('img', { name: /Rook/ })).toBeInTheDocument();
    expect(screen.getByTestId('s11-vs-faces-rival')).toHaveAccessibleName('Rival crew hidden');
    expect(screen.getByTestId('s11-vs-faces-rival')).toHaveTextContent('? · ? · ?');
    expect(vs).toHaveTextContent('Rival crew is hidden until both lock in');
    expect(screen.getByTestId('s11-vs-accept')).toHaveTextContent(/Accept\s*10/);
    expect(screen.getByTestId('s11-vs-accept')).toHaveFocus();
    expect(router.push).not.toHaveBeenCalled();
    expect(v2StoreFor(realtime).get('mat_1')).toMatchObject({ team: 'B', crew: [{ name: 'Rook' }] });

    await user.click(screen.getByTestId('s11-vs-accept'));
    expect(realtime.sent.at(-1)).toEqual({ type: 'v2_accept', matchId: 'mat_1' });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/matches/mat_1');
    expect(screen.queryByTestId('s11-vs')).not.toBeInTheDocument();
    expect(screen.getByTestId('s11-match-found')).toBeInTheDocument();
    act(() => realtime.emit({ type: 'v2_accepted', matchId: 'mat_1', team: 'B' }));
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('names a casual match difficulty on the takeover', async () => {
    const { realtime } = setup();
    await ready();
    act(() => realtime.emit(vsFound({ ranked: false, difficulty: 'hard' })));
    expect(screen.getByTestId('s11-vs')).toHaveTextContent('Match found · casual · CH-05 Copper Hollow · Hard');
  });

  it('declines from the takeover and says so', async () => {
    const { realtime, user, router } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit(vsFound()));
    await user.click(screen.getByTestId('s11-vs-decline'));
    expect(realtime.sent.at(-1)).toEqual({ type: 'v2_decline', matchId: 'mat_1' });
    expect(screen.queryByTestId('s11-vs')).not.toBeInTheDocument();
    expect(screen.getByTestId('s11-vs-void')).toHaveTextContent('Match declined. You are back in the hub.');
    expect(screen.getByTestId('s11-find-match')).toBeEnabled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('closes the takeover when the server calls the match off', async () => {
    const { realtime, user } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit(vsFound()));
    act(() => realtime.emit({ type: 'v2_end', matchId: 'mat_1', result: null, reason: 'accept_timeout', logHash: null }));
    expect(screen.queryByTestId('s11-vs')).not.toBeInTheDocument();
    expect(screen.getByTestId('s11-vs-void')).toHaveTextContent('A crew did not accept in time');
    await user.click(screen.getByTestId('s11-find-match'));
    expect(screen.queryByTestId('s11-vs-void')).not.toBeInTheDocument();
  });

  it('opens the match screen when the crew accepted in another tab', async () => {
    const { realtime, router } = setup();
    await ready();
    act(() => realtime.emit(vsFound()));
    act(() => realtime.emit({ type: 'v2_accepted', matchId: 'mat_1', team: 'B' }));
    expect(router.push).toHaveBeenCalledWith('/matches/mat_1');
  });

  it('says which agent is busy', async () => {
    const { realtime, user } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit({ type: 'error', code: 'agent_busy', message: 'an agent is in a match that has not ended' }));
    expect(screen.getByTestId('s11-queue-error')).toHaveTextContent('Rook is still in a match');
    expect(screen.getByTestId('s11-find-match')).toBeInTheDocument();
  });

  it('offers a top-up when the server finds the balance short', async () => {
    const { realtime, user } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit({ type: 'error', code: 'insufficient_credits', message: 'not enough credits (need 175, have 60)' }));
    const alert = screen.getByTestId('s11-queue-error');
    expect(alert).toHaveTextContent('Need 175 credits, have 60');
    expect(within(alert).getByRole('link', { name: /Top up credits/ })).toHaveAttribute('href', '/account/credits');
  });

  it('shows "Top up to play" when credits cannot cover the hold', async () => {
    const me = meFixture();
    me.credits = { ...me.credits, available: 20, allowanceLeft: 20 };
    setup({ me });
    await ready();
    expect(screen.getByTestId('s11-topup')).toHaveAttribute('href', '/account/credits');
    expect(screen.queryByTestId('s11-find-match')).not.toBeInTheDocument();
  });

  it('lets the 60 free credits cover a 2-agent ranked match, but not 3 agents', async () => {
    const { user } = setup({ me: meFixture() });
    await ready();
    await user.click(screen.getByRole('checkbox', { name: /Wren/ }));
    expect(screen.getByTestId('s11-cost')).toHaveTextContent('Holds 60 credits · 0.40 per tick');
    expect(screen.getByTestId('s11-find-match')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Moss/ }));
    expect(screen.getByTestId('s11-cost')).toHaveTextContent('Holds 90 credits · 0.60 per tick');
    expect(screen.queryByTestId('s11-find-match')).not.toBeInTheDocument();
    expect(screen.getByTestId('s11-topup')).toHaveAttribute('href', '/account/credits');
  });

  it('picks up to three agents and, in casual, plays each at its own talk tier', async () => {
    const me = rich();
    me.agents[1] = { ...me.agents[1]!, tier: 'open' };
    const { realtime, user } = setup({ me });
    await ready();
    await user.click(screen.getByRole('tab', { name: 'Casual' }));
    await user.click(screen.getByRole('checkbox', { name: /Wren/ }));
    expect(screen.getByTestId('s11-cost')).toHaveTextContent('Holds 90 credits · 0.60 per tick');
    await user.click(screen.getByTestId('s11-find-match'));
    expect(realtime.sent[0]).toEqual({ type: 'v2_queue', ranked: false, crew: [{ agentId: ROOK, tier: 'standard' }, { agentId: WREN, tier: 'open' }] });
  });

  it('queues draft mode as a casual search with the ban rules shown', async () => {
    const { realtime, user } = setup({ me: rich() });
    await ready();
    expect(screen.queryByTestId('s11-draft-rules')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Draft' }));
    expect(screen.getByTestId('s11-rotation')).toHaveTextContent('Draft rotation');
    expect(screen.getByTestId('s11-draft-rules')).toHaveTextContent('each crew bans one of the rival');
    await user.click(screen.getByTestId('s11-find-match'));
    expect(realtime.sent[0]).toEqual({ type: 'v2_queue', ranked: false, draft: true, crew: [{ agentId: ROOK, tier: 'standard' }] });
  });

  it('queues again after a reconnect', async () => {
    const { realtime, user } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit({ type: 'queue_status', searchingMs: 4000, eloRange: 100 }));
    act(() => realtime.setStatus('reconnecting'));
    expect(screen.getByTestId('s11-reconnecting')).toHaveTextContent('Your search starts again');
    act(() => realtime.setStatus('open'));
    expect(realtime.sent.filter((m) => m.type === 'v2_queue')).toHaveLength(2);
  });

  it('cancels the search when leaving the lobby', async () => {
    const { realtime, user, unmount } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    unmount();
    expect(realtime.sent.at(-1)).toEqual({ type: 'v2_cancel_queue' });
  });

  it('lists live v2 matches with Watch links to the v2 match screen', async () => {
    setup({ api: { v2LiveMatches: async () => [v2LiveMatchFixture()] } });
    const row = await screen.findByTestId('s11-live-mat_live');
    expect(row).toHaveTextContent('ada · 2 agents');
    expect(row).toHaveTextContent('ben · 2 agents');
    expect(row).toHaveTextContent('CH-05 Copper Hollow · ranked · 1:0');
    expect(within(row).getByRole('link', { name: /Watch/ })).toHaveAttribute('href', '/matches/mat_live');
    expect(within(row).queryByText('Practice')).not.toBeInTheDocument();
  });

  it('marks practice matches against the bot crew and names a casual difficulty', async () => {
    setup({
      api: {
        v2LiveMatches: async () => [
          v2LiveMatchFixture({ id: 'mat_p', ranked: false, practice: true, difficulty: 'easy', teams: { A: { handle: 'ada', size: 1 }, B: { handle: 'Greedy bot', size: 1 } } }),
          v2LiveMatchFixture({ id: 'mat_c', ranked: false, difficulty: 'hard', startedAt: null }),
        ],
      },
    });
    const practice = await screen.findByTestId('s11-live-mat_p');
    expect(practice).toHaveTextContent('ada · 1 agent');
    expect(practice).toHaveTextContent('Greedy bot · 1 agent');
    expect(within(practice).getByTestId('s11-live-practice-mat_p')).toHaveTextContent('Practice');
    expect(practice).toHaveTextContent('practice · Easy');
    const casual = screen.getByTestId('s11-live-mat_c');
    expect(casual).toHaveTextContent('CH-05 Copper Hollow · casual · Hard');
    expect(within(casual).queryByText('Practice')).not.toBeInTheDocument();
  });

  it('shows the empty state of Live now', async () => {
    setup();
    expect(await within(await screen.findByTestId('s11-live')).findByText('No live matches right now. Find a match to start one.')).toBeInTheDocument();
  });

  it('shows an error card with Retry when live matches fail', async () => {
    const { api, user } = setup({ api: { v2LiveMatches: async () => Promise.reject(new Error('boom')) } });
    const live = await screen.findByTestId('s11-live');
    const card = await within(live).findByTestId('error-card');
    api.v2LiveMatches.mockResolvedValueOnce([]);
    await user.click(within(card).getByRole('button', { name: /Retry/ }));
    expect(await within(live).findByText('No live matches right now. Find a match to start one.')).toBeInTheDocument();
  });

  // Verifier regressions.
  it('keeps searching through errors that are not about the queue', async () => {
    const { realtime, user } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit({ type: 'error', code: 'too_many_subscriptions', message: 'at most 8 matches at once' }));
    act(() => realtime.emit({ type: 'error', code: 'not_found', message: 'run not found' }));
    expect(screen.getByTestId('s11-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('s11-queue-error')).not.toBeInTheDocument();
  });

  it('stays searching when not_queued answers a cancel that a new queue followed', async () => {
    const { realtime, user } = setup();
    await ready();
    await user.click(screen.getByTestId('s11-find-match'));
    await user.click(screen.getByTestId('s11-cancel'));
    await user.click(screen.getByTestId('s11-find-match'));
    act(() => realtime.emit({ type: 'error', code: 'not_queued', message: 'not searching for a match' }));
    expect(screen.getByTestId('s11-cancel')).toBeInTheDocument();
    act(() => realtime.emit({ type: 'queue_status', searchingMs: 2000, eloRange: 100 }));
    expect(screen.getByTestId('s11-searching-time')).toHaveTextContent('0:02');
  });

  it('shows the takeover for a match found from another tab too', async () => {
    const { realtime } = setup();
    await ready();
    act(() => realtime.emit(vsFound({ matchId: 'mat_9', ranked: false })));
    expect(screen.getByTestId('s11-vs')).toBeInTheDocument();
  });
});
