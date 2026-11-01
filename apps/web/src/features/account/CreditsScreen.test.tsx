import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { CreditsWithRows, LedgerRow } from '@/lib/api/types';
import { meFixture, myMatchFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { CreditsScreen } from './CreditsScreen';

// M01/M02 are the Skills+Market builder's real modals (features/skills); S15 drives them by their
// testids (m02-confirm, m02-done-close, m02-cancel).

const credits = (o: Partial<CreditsWithRows> = {}): CreditsWithRows => ({
  balance: 0,
  held: 0,
  allowanceLeft: 60,
  // The next 00:00 UTC from the (possibly faked) clock, so the reset is never already past.
  allowanceResetAt: new Date(Math.floor(Date.now() / 86_400_000 + 1) * 86_400_000).toISOString(),
  available: 60,
  rows: [],
  ...o,
});

const row = (o: Partial<LedgerRow>): LedgerRow => ({
  id: 'l1',
  type: 'topup',
  amount: 0,
  source: 'paid',
  note: null,
  matchId: null,
  txHash: null,
  createdAt: '2026-10-25T10:41:00.000Z',
  ...o,
});

const base = {
  me: async () => meFixture(),
  myMatches: async () => [],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('S15 Credits', () => {
  it('shows a fresh account: 0 paid, 60 free, no transactions', async () => {
    renderWithProviders(<CreditsScreen />, { handle: 'ada', path: '/account/credits', api: { ...base, credits: async () => credits() } });
    expect(await screen.findByTestId('screen-s15')).toBeInTheDocument();
    expect(await screen.findByTestId('s15-balance-available')).toHaveTextContent('0');
    expect(screen.getByTestId('s15-balance-held')).toHaveTextContent('0');
    expect(screen.getByTestId('s15-allowance')).toHaveTextContent('60 / 60');
    expect(screen.getByRole('progressbar', { name: 'Free allowance left' })).toHaveAttribute('aria-valuenow', '60');
    expect(screen.getByTestId('s15-balance-empty')).toBeInTheDocument();
    expect(within(screen.getByTestId('s15-ledger')).getByText('No transactions yet.')).toBeInTheDocument();
    expect(screen.getByTestId('s15-wallet-none')).toHaveTextContent('Connect a wallet to top up.');
    expect(screen.getByTestId('s15-dev-note')).toBeInTheDocument();
    expect(screen.getByTestId('s15-rates')).toHaveTextContent(
      "1 credit costs US$0.001. A match holds credits for every tick at your crew's talk rates (Quiet 0.20, Standard 0.20, Open 0.40 credits per agent per tick); what is not used comes back.",
    );
  });

  it('shows a skeleton while loading, and a retry card on error', async () => {
    let fail = true;
    const { user, api } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        credits: async () => {
          if (fail) throw new ApiError(500, 'internal', 'boom');
          return credits({ balance: 12 });
        },
      },
    });
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    const cards = await screen.findAllByTestId('error-card');
    expect(cards[0]).toHaveTextContent('Balance did not load');
    fail = false;
    await user.click(within(cards[0]!).getByRole('button', { name: /retry/i }));
    expect(await screen.findByTestId('s15-balance-available')).toHaveTextContent('12');
    expect(api.credits).toHaveBeenCalledTimes(2);
  });

  it('counts down to the 00:00 UTC reset with the clock', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-25T18:48:00Z'));
    renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: { ...base, credits: async () => credits({ allowanceLeft: 33 }) },
    });
    expect(await screen.findByTestId('s15-allowance-reset')).toHaveTextContent('Resets in 5 h 12 m (00:00 UTC)');
    expect(screen.getByTestId('s15-allowance')).toHaveTextContent('33 / 60');
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByTestId('s15-allowance-reset')).toHaveTextContent('Resets in 5 h 11 m');
  });

  it('refetches after 00:00 UTC until the server reports the new day', async () => {
    // Regression: it refetched once per resetAt, so a device clock ahead of the server's left the
    // old allowance on screen until something else refetched.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-25T23:59:30Z'));
    let state = credits({ allowanceLeft: 0 });
    const { api } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: { ...base, credits: async () => state },
    });
    expect(await screen.findByTestId('s15-allowance')).toHaveTextContent('0 / 60');
    expect(api.credits).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(30_000); // 00:00:00 on this device; the server still answers yesterday
    });
    await waitFor(() => expect(api.credits).toHaveBeenCalledTimes(2));
    state = credits({ allowanceLeft: 60, allowanceResetAt: '2026-10-27T00:00:00.000Z' });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await waitFor(() => expect(screen.getByTestId('s15-allowance')).toHaveTextContent('60 / 60'));
    expect(screen.getByTestId('s15-allowance-reset')).toHaveTextContent('Resets in 23 h 59 m');
  });

  it('says when the free allowance is used up', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-25T19:00:00Z'));
    renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: { ...base, credits: async () => credits({ allowanceLeft: 0, balance: 40 }) },
    });
    expect(await screen.findByTestId('s15-allowance-reset')).toHaveTextContent(
      '0 of 60 free credits left. Resets in 5 h 0 m.',
    );
  });

  it('lists ledger rows with signs, sources, match and transaction links, and pages them', async () => {
    const rows: LedgerRow[] = [
      row({ id: 'a', type: 'refund', amount: 33, source: 'free', matchId: 'mat_1' }),
      row({ id: 'b', type: 'charge', amount: 27, source: 'free', matchId: 'mat_1' }),
      row({ id: 'c', type: 'free', amount: 60, source: 'free', matchId: 'mat_1' }),
      row({ id: 'd', type: 'topup', amount: 500, txHash: 'dev:500000000000000000000000:abc' }),
      row({ id: 'e', type: 'topup', amount: 1000, txHash: '9QxRk7uX2bQh1Tz8nD3mF5vW6aY4cE9sJ0pLrGtHk2Lm' }),
      ...Array.from({ length: 20 }, (_, i) => row({ id: `p${i}`, type: 'hold', amount: 5, matchId: 'mat_2' })),
    ];
    const { user } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        credits: async () => credits({ balance: 1500, rows }),
        myMatches: async () => [myMatchFixture({ id: 'mat_1', mapId: 'copper-hollow' })],
      },
    });
    const refund = await screen.findByTestId('s15-ledger-row-a');
    await waitFor(() => expect(refund).toHaveTextContent('Copper Hollow match · unused credits returned'));
    expect(refund).toHaveTextContent('Refund');
    expect(refund).toHaveTextContent('Free allowance');
    expect(refund).toHaveTextContent('+33');
    expect(within(refund).getByRole('link', { name: 'Match' })).toHaveAttribute('href', '/matches/mat_1/result');
    // A match not in the recent list still links, under a plain name.
    expect(screen.getByTestId('s15-ledger-row-p0')).toHaveTextContent('Match · held up front');
    expect(screen.getByTestId('s15-ledger-row-c')).toHaveTextContent('−60');
    expect(screen.getByTestId('s15-ledger-row-b')).toHaveTextContent('Charge');
    const dev = screen.getByTestId('s15-ledger-row-d');
    expect(dev).toHaveTextContent('0.5 NEAR at 1,000 credits per NEAR');
    expect(dev).toHaveTextContent('+500');
    expect(dev).toHaveTextContent('dev deposit');
    const real = screen.getByTestId('s15-ledger-row-e');
    expect(within(real).getByRole('link', { name: '9QxR…k2Lm' })).toHaveAttribute(
      'href',
      'https://testnet.nearblocks.io/txns/9QxRk7uX2bQh1Tz8nD3mF5vW6aY4cE9sJ0pLrGtHk2Lm',
    );
    expect(screen.getByTestId('s15-balance-available')).toHaveTextContent('1,500');

    // 25 rows: 20 shown, then the rest.
    expect(screen.queryByTestId('s15-ledger-row-p19')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('s15-ledger-more'));
    expect(screen.getByTestId('s15-ledger-row-p19')).toBeInTheDocument();
    expect(screen.queryByTestId('s15-ledger-more')).not.toBeInTheDocument();
  });

  it('tops up 0.5 NEAR with a dev deposit through M02', async () => {
    let state = credits();
    const { user, api } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        credits: async () => state,
        deposit: async (txHash) => {
          state = credits({
            balance: 500,
            rows: [row({ id: 'n1', type: 'topup', amount: 500, txHash })],
          });
          return { credited: 500, balance: 500, amountYocto: '500000000000000000000000' };
        },
      },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('radio', { name: /0\.5 NEAR/ }));
    await user.click(screen.getByRole('button', { name: 'Top up 0.5 NEAR' }));
    expect(screen.getByTestId('m02-item')).toHaveTextContent('Top up 500 credits');
    expect(screen.getByTestId('m02-price')).toHaveTextContent('0.5 NEAR');
    expect(screen.getByTestId('m02-total')).toHaveTextContent('0.501 NEAR');
    await user.click(screen.getByTestId('m02-confirm'));
    await waitFor(() => expect(api.deposit).toHaveBeenCalledTimes(1));
    expect(api.deposit.mock.calls[0]![0]).toMatch(/^dev:500000000000000000000000:[0-9a-f]+$/);
    await waitFor(() => expect(screen.getByTestId('s15-balance-available')).toHaveTextContent('500'));
    expect(await screen.findByTestId('s15-ledger-row-n1')).toHaveTextContent('+500');
    expect(screen.getByTestId('toasts')).toHaveTextContent('+500 credits for 0.5 NEAR');
    expect(screen.getByTestId('m02-done')).toHaveTextContent('500 credits are in your balance.');
    await user.click(screen.getByTestId('m02-done-close'));
    expect(screen.queryByTestId('m02-confirm-transaction')).not.toBeInTheDocument();
  });

  it('re-sends the same receipt on Try again, so a lost response cannot credit twice', async () => {
    // Every attempt reuses one dev:<yocto>:<nonce>, so a retry after a response lost in transit is
    // never a second deposit.
    let state = credits();
    let calls = 0;
    const { user, api } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        credits: async () => state,
        deposit: async () => {
          calls += 1;
          if (calls === 1) {
            state = credits({ balance: 1000 }); // credited server-side, response lost
            throw new ApiError(0, 'network', 'Failed to fetch');
          }
          throw new ApiError(409, 'duplicate_receipt', 'this deposit was already credited');
        },
      },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('s15-topup-error')).toHaveTextContent('Already credited');
    expect(api.deposit).toHaveBeenCalledTimes(2);
    expect(api.deposit.mock.calls[1]![0]).toBe(api.deposit.mock.calls[0]![0]);
    // The balance that includes the deposit is fetched again.
    await waitFor(() => expect(screen.getByTestId('s15-balance-available')).toHaveTextContent('1,000'));
  });

  it('says what the server credited, not the client estimate', async () => {
    const { user } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        credits: async () => credits(),
        deposit: async () => ({ credited: 2000, balance: 2000, amountYocto: '1000000000000000000000000' }),
      },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-done')).toHaveTextContent('2,000 credits are in your balance.');
  });

  it('shows a pending deposit row while the deposit is verified', async () => {
    let resolve!: (v: { credited: number; balance: number; amountYocto: string }) => void;
    const { user } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        credits: async () => credits(),
        deposit: () => new Promise((r) => (resolve = r)),
      },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('s15-ledger-pending')).toHaveTextContent('Waiting for NEAR to confirm 1 NEAR');
    for (const b of screen.getAllByRole('button', { name: /Waiting for wallet/ })) expect(b).toBeDisabled();
    await act(async () => resolve({ credited: 1000, balance: 1000, amountYocto: '1000000000000000000000000' }));
    await waitFor(() => expect(screen.queryByTestId('s15-ledger-pending')).not.toBeInTheDocument());
  });

  it.each([
    [new ApiError(503, 'rpc_unavailable', 'NEAR RPC is unavailable'), 'Top-ups paused'],
    [new ApiError(403, 'dev_disabled', 'dev deposits are disabled'), 'Test deposits are off'],
    [new ApiError(409, 'duplicate_receipt', 'already credited'), 'Already credited'],
    [new ApiError(422, 'invalid_amount', 'balance cannot exceed'), 'That amount cannot be credited'],
    [new ApiError(0, 'network', 'Failed to fetch'), 'Offline'],
  ])('explains a failed deposit (%s)', async (err, title) => {
    const { user } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        credits: async () => credits({ balance: 7 }),
        deposit: async () => {
          throw err;
        },
      },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await user.click(screen.getByTestId('m02-confirm'));
    const card = await screen.findByTestId('s15-topup-error');
    expect(card).toHaveTextContent(title);
    expect(card).toHaveTextContent(err.code);
    expect(screen.getByTestId('m02-failed')).toBeInTheDocument();
    if (err.code === 'rpc_unavailable') {
      expect(screen.getByTestId('s15-topups-paused')).toHaveTextContent('Top-ups paused. Your balance is safe.');
      expect(screen.getByTestId('s15-topups-paused')).toHaveTextContent(/Balance as of \d\d:\d\d UTC/);
    }
    // The balance stays as it was.
    expect(screen.getByTestId('s15-balance-available')).toHaveTextContent('7');
    await user.click(within(card).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('s15-topup-error')).not.toBeInTheDocument();
  });

  it('validates a typed amount before opening M02, then converts it exactly', async () => {
    const { user, api } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: { ...base, credits: async () => credits() },
    });
    await screen.findByTestId('s15-balance-available');
    const field = screen.getByLabelText('Other amount');
    await user.type(field, 'abc');
    await user.click(screen.getByTestId('s15-custom-submit'));
    expect(await screen.findByText(/Enter a NEAR amount like 0.5/)).toBeInTheDocument();
    expect(screen.queryByTestId('m02-confirm-transaction')).not.toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '0.0001');
    await user.click(screen.getByTestId('s15-custom-submit'));
    expect(await screen.findByText(/less than 1 credit/)).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '2.345');
    expect(screen.getByText('2,345 credits')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('m02-item')).toHaveTextContent('Top up 2,345 credits');
    expect(screen.getByTestId('m02-price')).toHaveTextContent('2.345 NEAR');
    await user.click(screen.getByTestId('m02-cancel'));
    expect(screen.queryByTestId('m02-confirm-transaction')).not.toBeInTheDocument();
    expect(api.deposit).not.toHaveBeenCalled();
  });

  it('uses the server rate from GET /credits (or /me) instead of the default', async () => {
    const { user } = renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        me: async () => ({ ...meFixture(), creditsPerNear: 500 }),
        credits: async () =>
          credits({ creditsPerNear: 2000, rows: [row({ id: 'd1', amount: 1000, txHash: 'dev:500000000000000000000000:x' })] }),
      },
    });
    expect(await screen.findByTestId('s15-ledger-row-d1')).toHaveTextContent('0.5 NEAR at 2,000 credits per NEAR');
    expect(screen.getByText('2,000 credits per NEAR on testnet')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /1 NEAR/ })).toHaveTextContent('2,000 credits');
    await user.type(screen.getByLabelText('Other amount'), '0.25');
    expect(screen.getByText('500 credits')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('m02-item')).toHaveTextContent('Top up 500 credits');
  });

  it('falls back to /me creditsPerNear, then the default, when /credits has none', async () => {
    renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: { ...base, me: async () => ({ ...meFixture(), creditsPerNear: 250 }), credits: async () => credits() },
    });
    expect(await screen.findByText('250 credits per NEAR on testnet')).toBeInTheDocument();
  });

  it('shows the linked NEAR account', async () => {
    renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        me: async () => meFixture({ account: { id: 'acc', handle: 'ada', nearAccountId: 'ada.testnet' } }),
        credits: async () => credits(),
      },
    });
    expect(await screen.findByTestId('s15-wallet-account')).toHaveTextContent('ada.testnet');
    expect(screen.getByTestId('s15-connect-wallet')).toHaveTextContent('Change wallet');
  });

  it('reads a premium look purchase without a match link', async () => {
    renderWithProviders(<CreditsScreen />, {
      handle: 'ada',
      api: {
        ...base,
        credits: async () =>
          credits({ balance: 400, rows: [row({ id: 's', type: 'spend', amount: 100, note: 'cosmetic' })] }),
      },
    });
    const spend = await screen.findByTestId('s15-ledger-row-s');
    expect(spend).toHaveTextContent('Purchase');
    expect(spend).toHaveTextContent('Premium look');
    expect(spend).toHaveTextContent('−100');
    expect(within(spend).queryByRole('link', { name: 'Match' })).not.toBeInTheDocument();
  });

  it('asks signed-out visitors to sign in', async () => {
    renderWithProviders(<CreditsScreen />, { path: '/account/credits' });
    expect(await screen.findByTestId('signin-required')).toBeInTheDocument();
  });
});
