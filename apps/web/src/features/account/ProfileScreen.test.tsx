import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { PREFERENCES_KEY, preferencesStore } from '@/lib/preferences';
import { agentFixture, meFixture, myMatchFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { ProfileScreen } from './ProfileScreen';

const base = {
  me: async () => meFixture(),
  myMatches: async () => [],
};

afterEach(() => preferencesStore().reset());

describe('S16 Profile', () => {
  it('shows the starter agents with role, talk tier, unlocks and skills, and no per-agent Elo', async () => {
    renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      path: '/account',
      api: {
        ...base,
        me: async () =>
          meFixture({
            agents: [
              agentFixture({
                elo: 1263,
                matchesPlayed: 9,
                wins: 6,
                losses: 3,
                role: 'Builder',
                vision: 4,
                comms: 2,
                tier: 'open',
                unlocks: ['builder'],
                skills: [{ id: 'skl_1', version: 1, name: 'Flood Warden' }],
              }),
              agentFixture({ id: 'agt_w', name: 'Wren' }),
              agentFixture({ id: 'agt_m', name: 'Moss' }),
            ],
          }),
      },
    });
    expect(await screen.findByTestId('screen-s16')).toBeInTheDocument();
    const names = await screen.findAllByTestId('s16-agent-name');
    expect(names.map((n) => n.textContent)).toEqual(['Rook', 'Wren', 'Moss']);
    const rook = screen.getByTestId('s16-agent-agt_01J0000000000000000000ROOK');
    expect(rook).toHaveTextContent('Builder · vision 4 · comms 2');
    expect(rook).toHaveTextContent('Open');
    expect(rook).toHaveTextContent('Flood Warden v1');
    expect(rook).not.toHaveTextContent('1,263');
    expect(rook).not.toHaveTextContent('6–3–0');
    expect(screen.getByTestId('s16-agent-agt_w')).toHaveTextContent('Runner · vision 3 · comms 3');
    expect(screen.getByTestId('s16-agent-agt_w')).toHaveTextContent('Standard');
    expect(screen.getByTestId('s16-agent-agt_w')).toHaveTextContent('Map briefing only');
    expect(screen.getByTestId('s16-handle')).toHaveTextContent('ada');
    const unlocks = screen.getByTestId('s16-unlocks');
    expect(unlocks).toHaveTextContent('On Rook');
    expect(within(unlocks).getAllByText('Not attached')).toHaveLength(2);
    expect(screen.getByTestId('s16-credits')).toHaveAttribute('href', '/account/credits');
  });

  it('shows the account rank: Elo, title, ranked record and ladder place', async () => {
    renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      api: {
        ...base,
        me: async () => meFixture({ rank: { elo: 1340, rankedMatches: 12, wins: 8, losses: 3, draws: 1, title: 'Breach Runner II', position: 14 } }),
      },
    });
    const rank = await screen.findByTestId('s16-rank');
    expect(within(rank).getByTestId('s16-rank-elo')).toHaveTextContent('1,340');
    expect(within(rank).getByTestId('s16-rank-title')).toHaveTextContent('Breach Runner II');
    expect(within(rank).getByTestId('s16-rank-record')).toHaveTextContent('8–3–1 in 12');
    expect(within(rank).getByTestId('s16-rank-position')).toHaveTextContent('#14');
    expect(within(rank).getByRole('link', { name: 'Season standings' })).toHaveAttribute('href', '/leaderboards');
  });

  it('shows a new account as unranked at the starting Elo', async () => {
    renderWithProviders(<ProfileScreen />, { handle: 'ada', api: base });
    const rank = await screen.findByTestId('s16-rank');
    expect(within(rank).getByTestId('s16-rank-elo')).toHaveTextContent('1,200');
    expect(within(rank).getByTestId('s16-rank-record')).toHaveTextContent('0–0–0 in 0');
    expect(within(rank).getByTestId('s16-rank-position')).toHaveTextContent('Not placed yet');
  });

  it('lists recent v2 matches linking to their results', async () => {
    const { api } = renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      api: {
        ...base,
        myMatches: async () => [
          myMatchFixture(),
          myMatchFixture({ id: 'mat_live', result: 'live', score: null, endedAt: null, eloDelta: null }),
          myMatchFixture({ id: 'mat_bot', mapId: 'basalt-stair', ranked: false, practice: true, result: 'loss', score: { you: 1, rival: 3 }, eloDelta: null }),
          myMatchFixture({ id: 'mat_void', ranked: false, result: 'void', score: null, eloDelta: null }),
        ],
      },
    });
    const won = await screen.findByTestId('s16-match-mat_v2');
    expect(within(won).getByRole('link', { name: 'Copper Hollow' })).toHaveAttribute('href', '/matches/mat_v2/result');
    expect(won).toHaveTextContent('Won');
    expect(won).toHaveTextContent('Ranked · 4–2 · Elo +16');
    expect(won).toHaveTextContent('25 Oct 12:03 UTC');
    const live = screen.getByTestId('s16-match-mat_live');
    expect(within(live).getByRole('link')).toHaveAttribute('href', '/matches/mat_live');
    expect(live).toHaveTextContent('Live');
    const bot = screen.getByTestId('s16-match-mat_bot');
    expect(bot).toHaveTextContent('Basalt Stair');
    expect(bot).toHaveTextContent('Lost');
    expect(bot).toHaveTextContent('Practice · 1–3');
    expect(screen.getByTestId('s16-match-mat_void')).toHaveTextContent('Called off');
    expect(api.myMatches).toHaveBeenCalled();
  });

  it('shows an empty state with no matches', async () => {
    renderWithProviders(<ProfileScreen />, { handle: 'ada', api: base });
    expect(await within(await screen.findByTestId('s16-matches')).findByText(/No matches yet/)).toBeInTheDocument();
    expect(screen.getByTestId('screen-s16')).not.toHaveTextContent(/tutorial/i);
  });

  it('shows a retry card when the match list fails', async () => {
    renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      api: { ...base, myMatches: async () => Promise.reject(new ApiError(500, 'internal', 'boom')) },
    });
    const matches = await screen.findByTestId('s16-matches');
    expect(await within(matches).findByText('Matches did not load')).toBeInTheDocument();
  });

  it('shows a skeleton then an error card when the account fails', async () => {
    renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      api: { ...base, me: async () => Promise.reject(new ApiError(0, 'network', 'Failed to fetch')) },
    });
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    const card = await screen.findByTestId('error-card');
    expect(card).toHaveTextContent('Your account did not load');
    expect(card).toHaveTextContent('network');
  });

  it('links a NEAR account through M01 in dev mode', async () => {
    let linked: string | null = null;
    const { user, api } = renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      api: {
        ...base,
        me: async () => meFixture({ account: { id: 'acc', handle: 'ada', nearAccountId: linked } }),
        createSession: async (body) => {
          linked = body?.nearAccountId ?? linked;
          return { account: { id: 'acc', handle: 'ada', nearAccountId: linked }, created: false };
        },
      },
    });
    expect(await screen.findByTestId('s16-near-none')).toHaveTextContent('Not connected');
    await user.click(screen.getByTestId('s16-connect-wallet'));
    await user.click(screen.getByTestId('m01-wallet-mynearwallet'));
    const input = screen.getByLabelText('Testnet account id');
    await user.clear(input);
    await user.type(input, 'ada.testnet');
    await user.click(screen.getByTestId('m01-connect'));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith({ nearAccountId: 'ada.testnet' }));
    expect(await screen.findByTestId('s16-near-account')).toHaveTextContent('ada.testnet');
    expect(screen.queryByTestId('m01-connect-wallet')).not.toBeInTheDocument();
    expect(screen.getByTestId('s16-connect-wallet')).toHaveTextContent('Connect a different wallet');
    expect(screen.getByTestId('toasts')).toHaveTextContent('NEAR account linked');
  });

  it('keeps M01 open and explains near_account_taken', async () => {
    const { user } = renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      api: {
        ...base,
        createSession: async (body) => {
          if (body?.nearAccountId) throw new ApiError(409, 'near_account_taken', 'taken');
          return { account: { id: 'acc', handle: 'ada', nearAccountId: null }, created: false };
        },
      },
    });
    await user.click(await screen.findByTestId('s16-connect-wallet'));
    await user.click(screen.getByTestId('m01-wallet-meteor'));
    await user.click(screen.getByTestId('m01-connect'));
    expect(await screen.findByTestId('m01-error')).toHaveTextContent(/linked to another player/);
    expect(screen.getByTestId('s16-near-none')).toBeInTheDocument();
  });

  it('opens M01 from Connect wallet and closes it with Escape', async () => {
    const { user } = renderWithProviders(<ProfileScreen />, { handle: 'ada', api: base });
    await user.click(await screen.findByTestId('s16-connect-wallet'));
    expect(screen.getByTestId('m01-connect-wallet')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('m01-connect-wallet')).not.toBeInTheDocument();
    expect(screen.getByTestId('s16-connect-wallet')).toHaveFocus();
  });

  it('shows Joined and Royalties earned from /me', async () => {
    renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      api: {
        ...base,
        me: async () => ({
          ...meFixture({ account: { id: 'acc', handle: 'ada', nearAccountId: null, createdAt: '2026-11-10T08:00:00.000Z' } }),
          // 0.12 NEAR plus 1 yocto: bigint formatting, never a float.
          royaltiesYocto: '120000000000000000000001',
        }),
      },
    });
    expect(await screen.findByTestId('s16-joined')).toHaveTextContent('10 Nov 2026');
    expect(screen.getByTestId('s16-royalties')).toHaveTextContent('0.12 NEAR');
  });

  it('saves settings through usePreferences', async () => {
    const { user } = renderWithProviders(<ProfileScreen />, { handle: 'ada', api: base });
    const card = await screen.findByTestId('s16-settings');
    expect(within(card).getByLabelText(/Sound effects/)).toBeChecked();
    expect(within(card).getByLabelText('Replay speed')).toHaveValue('1');
    expect(within(card).getByLabelText(/Show action probabilities/)).toBeChecked();
    expect(within(card).getByLabelText(/Show tag names/)).not.toBeChecked();
    expect(screen.getByTestId('s16-reduced-motion-note')).toHaveTextContent('Follows your device setting (off)');
    expect(screen.getByTestId('s16-save-settings')).toBeDisabled();

    await user.click(within(card).getByLabelText(/Sound effects/));
    await user.selectOptions(within(card).getByLabelText('Replay speed'), '2');
    await user.click(within(card).getByLabelText(/Reduce board motion/));
    await user.click(within(card).getByLabelText(/Show action probabilities/));
    await user.click(within(card).getByLabelText(/Show tag names/));
    // Nothing is stored before Save settings.
    expect(preferencesStore().get().prefs.sfx).toBe(true);
    await user.click(screen.getByTestId('s16-save-settings'));
    expect(preferencesStore().get().prefs).toEqual({
      sfx: false,
      replaySpeed: 2,
      reducedMotion: true,
      showProbabilities: false,
      showTagNames: true,
    });
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_KEY)!)).toMatchObject({ sfx: false, replaySpeed: 2 });
    expect(screen.getByTestId('toasts')).toHaveTextContent('Settings saved');
    expect(screen.getByTestId('s16-save-settings')).toBeDisabled();

    await user.click(within(card).getByRole('button', { name: 'Follow the device setting' }));
    await user.click(screen.getByTestId('s16-save-settings'));
    expect(preferencesStore().get().prefs.reducedMotion).toBeNull();
  });

  it('disconnects the NEAR wallet with DELETE /me/near', async () => {
    let linked: string | null = 'ada.testnet';
    const { user, api } = renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      api: {
        ...base,
        me: async () => meFixture({ account: { id: 'acc', handle: 'ada', nearAccountId: linked } }),
        unlinkNear: async () => {
          linked = null;
          return { account: { id: 'acc', handle: 'ada', nearAccountId: null } };
        },
      },
    });
    expect(await screen.findByTestId('s16-near-account')).toHaveTextContent('ada.testnet');
    await user.click(screen.getByTestId('s16-disconnect-wallet'));
    await waitFor(() => expect(api.unlinkNear).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('s16-near-none')).toHaveTextContent('Not connected');
    expect(screen.queryByTestId('s16-disconnect-wallet')).not.toBeInTheDocument();
    expect(screen.getByTestId('toasts')).toHaveTextContent('NEAR wallet disconnected');
  });

  it('explains listing_active when the wallet cannot be disconnected', async () => {
    const { user } = renderWithProviders(<ProfileScreen />, {
      handle: 'ada',
      api: {
        ...base,
        me: async () => meFixture({ account: { id: 'acc', handle: 'ada', nearAccountId: 'ada.testnet' } }),
        unlinkNear: async () => {
          throw new ApiError(409, 'listing_active', 'active listing');
        },
      },
    });
    await user.click(await screen.findByTestId('s16-disconnect-wallet'));
    const alert = await screen.findByTestId('s16-unlink-blocked');
    expect(alert).toHaveTextContent('Listing still open');
    expect(within(alert).getByRole('link', { name: 'Open My skills' })).toHaveAttribute('href', '/skills');
    expect(screen.getByTestId('s16-near-account')).toHaveTextContent('ada.testnet');
  });

  it('signs out and returns to sign in', async () => {
    const { user, credentials, router } = renderWithProviders(<ProfileScreen />, { handle: 'ada', api: base });
    await user.click(await screen.findByTestId('s16-sign-out'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'));
    expect(credentials.get()).toBeNull();
  });
});
