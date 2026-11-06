import { act, screen, within } from '@testing-library/react';
import { rankTitle } from '@skirm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preferencesStore } from '@/lib/preferences';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { AppShell } from './AppShell';
import { notesStore } from './notes';

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => notesStore.set(false));
});

/** A NEAR RPC that answers view_account with `amount` yoctoNEAR. */
function stubRpc(amount: string) {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 'skirm', result: { amount } })));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('TopBar', () => {
  it('shows Sign in when signed out', async () => {
    renderWithProviders(<AppShell>hi</AppShell>, { path: '/leaderboards' });
    const bar = screen.getByTestId('topbar');
    const dock = within(bar).getByTestId('account-dock');
    expect(await within(dock).findByTestId('topbar-signin')).toHaveAttribute('href', '/');
    expect(within(dock).getByText('Testnet')).toBeInTheDocument();
    expect(within(dock).queryByTestId('account-badge')).not.toBeInTheDocument();
    expect(within(dock).queryByTestId('topbar-credits')).not.toBeInTheDocument();
    expect(within(bar).getByTestId('nav-leaderboards')).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByTestId('topbar-crumb')).toHaveTextContent('/ Leaderboards');
    expect(within(bar).getByTestId('topbar-back')).toBeInTheDocument();
  });

  it('has no Back on the Command deck and toggles sound effects', async () => {
    const { user } = renderWithProviders(<AppShell>hi</AppShell>, { path: '/play' });
    expect(screen.queryByTestId('topbar-back')).not.toBeInTheDocument();
    expect(screen.getByTestId('topbar-crumb')).toHaveTextContent('/ Play');
    const sfx = screen.getByTestId('topbar-sfx');
    expect(sfx).toHaveAttribute('aria-pressed', 'true');
    await user.click(sfx);
    expect(sfx).toHaveAttribute('aria-pressed', 'false');
    expect(preferencesStore().get().prefs.sfx).toBe(false);
  });

  it('shows the balance, allowance, held credits and handle when signed in', async () => {
    const me = meFixture({ credits: { balance: 1240, held: 150, allowanceLeft: 12, allowanceResetAt: '', available: 1252 } });
    const { api } = renderWithProviders(<AppShell>hi</AppShell>, { handle: 'ada', path: '/maps/flood-gate', api: { me: async () => me } });
    expect(await screen.findByText('1,252')).toBeInTheDocument();
    expect(screen.getByTestId('topbar-allowance')).toHaveTextContent('1,240 paid · 12 free · 150 held');
    expect(screen.getByTestId('topbar-account')).toHaveTextContent('ada');
    expect(screen.getByTestId('nav-play')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-market')).not.toHaveAttribute('aria-current');
    expect(api.me).toHaveBeenCalledTimes(1);
  });

  it('shows the linked wallet with its NEAR balance and the ranked Elo with its title', async () => {
    const fetch = stubRpc('3204000000000000000000000');
    const me = meFixture({
      account: { id: 'acc_1', handle: 'ada', nearAccountId: 'ada.testnet' },
      rank: { elo: 1240, rankedMatches: 4, wins: 3, losses: 1, draws: 0, title: rankTitle(1240).title, position: null },
    });
    renderWithProviders(<AppShell>hi</AppShell>, { handle: 'ada', path: '/play', api: { me: async () => me } });
    const wallet = await screen.findByTestId('topbar-wallet');
    expect(await within(wallet).findByText('3.20 Ⓝ')).toBeInTheDocument();
    expect(within(wallet).getByText('ada.testnet')).toBeInTheDocument();
    expect(wallet).toHaveAttribute('href', '/account');
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.params).toMatchObject({ request_type: 'view_account', account_id: 'ada.testnet' });
    const elo = screen.getByTestId('topbar-elo');
    expect(elo).toHaveTextContent('Ranked Elo1240Placement 4/5 · Breach Runner II');
    expect(elo).toHaveAttribute('title', 'Placement 4/5 · Breach Runner II · Ranked Elo 1240');
    // The account badge carries the tier (placement until five ranked matches).
    expect(screen.getByTestId('topbar-tier')).toHaveTextContent('Placement 4/5');
    expect(elo).toHaveAttribute('href', '/pvp');
  });

  it('says Not linked without a NEAR account, and never calls the RPC', async () => {
    const fetch = stubRpc('0');
    renderWithProviders(<AppShell>hi</AppShell>, { handle: 'ada', path: '/play', api: { me: async () => meFixture() } });
    expect(await within(screen.getByTestId('topbar-wallet')).findByText('Not linked')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('puts the account badge in the top bar; a click opens the card, Escape and a link close it', async () => {
    const me = meFixture({ credits: { balance: 1240, held: 0, allowanceLeft: 60, allowanceResetAt: '', available: 1300 } });
    const { user, unmount } = renderWithProviders(<AppShell>hi</AppShell>, { handle: 'ada', path: '/market', api: { me: async () => me } });
    const bar = screen.getByTestId('topbar');
    const badge = within(bar).getByTestId('account-badge');
    expect(await within(badge).findByText('1,300 CR')).toBeInTheDocument();
    expect(badge).toHaveTextContent('ada');
    expect(badge).toHaveAttribute('aria-expanded', 'false');
    const card = document.getElementById(badge.getAttribute('aria-controls')!)!;
    expect(card).not.toBeVisible();
    expect(within(card).getByTestId('topbar-account')).toHaveTextContent('ada');

    await user.click(badge);
    expect(badge).toHaveAttribute('aria-expanded', 'true');
    expect(card).toBeVisible();
    expect(within(card).getByText('1,300')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(card).not.toBeVisible();

    await user.click(badge);
    await user.click(within(card).getByTestId('topbar-credits'));
    expect(badge).toHaveAttribute('aria-expanded', 'false');
    unmount();
    renderWithProviders(<AppShell>hi</AppShell>, { handle: 'ada', path: '/matches/m_1', api: { me: async () => me } });
    expect(screen.queryByTestId('account-dock')).not.toBeInTheDocument();
  });

  it('signs out from the account card, even when /me fails to load', async () => {
    const { user } = renderWithProviders(<AppShell>hi</AppShell>, {
      handle: 'ada',
      path: '/market',
      api: { me: async () => Promise.reject(new Error('down')) },
    });
    await user.click(screen.getByTestId('account-badge'));
    await user.click(screen.getByTestId('topbar-sign-out'));
    expect(await screen.findByTestId('topbar-signin')).toBeInTheDocument();
    expect(screen.queryByTestId('account-badge')).not.toBeInTheDocument();
  });

  it('toggles the design notes from the Notes button', async () => {
    const { user } = renderWithProviders(<AppShell>hi</AppShell>, { path: '/maps' });
    const notes = screen.getByTestId('topbar-notes');
    expect(notes).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('notes-aside')).not.toBeInTheDocument();
    await user.click(notes);
    expect(notes).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('notes-aside')).toHaveTextContent('Map atlas');
    await user.click(notes);
    expect(screen.queryByTestId('notes-aside')).not.toBeInTheDocument();
  });

  it('counts the free allowance on the badge, so a new player does not see 0 CR', async () => {
    const me = meFixture({ credits: { balance: 0, held: 0, allowanceLeft: 60, allowanceResetAt: '', available: 60 } });
    renderWithProviders(<AppShell>hi</AppShell>, { handle: 'ada', path: '/play', api: { me: async () => me } });
    const cr = await screen.findByTestId('topbar-cr');
    expect(cr).toHaveTextContent('60 CR');
    expect(cr).toHaveAttribute('title', expect.stringContaining('0 paid + 60 of'));
    expect(screen.getByTestId('topbar-allowance')).toHaveTextContent('0 paid · 60 free');
  });

  it('keeps a permanent Tutorial link in the account card', async () => {
    renderWithProviders(<AppShell>hi</AppShell>, { handle: 'ada', path: '/play', api: { me: async () => meFixture() } });
    expect(screen.getByTestId('topbar-tutorial')).toHaveAttribute('href', '/tutorial');
  });

  it('opens and closes the narrow-screen menu, which names the current section', async () => {
    const { user } = renderWithProviders(<AppShell>hi</AppShell>, { path: '/leaderboards' });
    const menu = screen.getByTestId('topbar-menu');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(menu).toHaveTextContent('Leaderboards');
    expect(menu).toHaveAttribute('aria-controls', nav.id);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(nav).not.toHaveAttribute('data-open');
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(nav).toHaveAttribute('data-open');
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
    await user.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});
