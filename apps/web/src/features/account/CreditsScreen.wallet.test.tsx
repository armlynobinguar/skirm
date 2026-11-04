// S15 outside dev mode: the linked wallet signs deposits.deposit() with the amount attached and the
// tx hash goes to POST /credits/deposits. FakeWallet stands in for NEAR Connect.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { CreditsWithRows } from '@/lib/api/types';
import { config } from '@/lib/config';
import { depositTx } from '@/lib/wallet/contracts';
import { meFixture } from '@/test/fixtures';
import { FakeWallet } from '@/test/fakeWallet';
import { renderWithProviders } from '@/test/render';
import { CreditsScreen } from './CreditsScreen';

const credits = (o: Partial<CreditsWithRows> = {}): CreditsWithRows => ({
  balance: 0,
  held: 0,
  allowanceLeft: 60,
  allowanceResetAt: new Date(Math.floor(Date.now() / 86_400_000 + 1) * 86_400_000).toISOString(),
  available: 60,
  rows: [],
  ...o,
});
const linkedMe = () =>
  meFixture({ account: { ...meFixture().account, nearAccountId: 'ada.testnet' } });
const base = {
  me: async () => linkedMe(),
  myMatches: async () => [],
  credits: async () => credits(),
};
const ONE_NEAR = '1000000000000000000000000';

describe('S15 top-up with a NEAR wallet', () => {
  it('signs deposits.deposit() with 1 NEAR attached, then sends the tx hash', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    const { user, api } = renderWithProviders(<CreditsScreen />, {
      authMode: 'privy',
      token: 'jwt_1',
      wallet,
      api: {
        ...base,
        deposit: async () => ({ credited: 1000, balance: 1000, amountYocto: ONE_NEAR }),
      },
    });
    await screen.findByTestId('s15-balance-available');
    expect(screen.queryByTestId('s15-dev-note')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    expect(screen.getByTestId('m02-account')).toHaveTextContent('ada.testnet');
    await user.click(screen.getByTestId('m02-confirm'));
    await waitFor(() => expect(api.deposit).toHaveBeenCalledWith('tx_1'));
    expect(wallet.sent).toEqual([depositTx(config.near.contracts, ONE_NEAR)]);
    expect(await screen.findByTestId('m02-done')).toHaveTextContent(
      '1,000 credits are in your balance.',
    );
  });

  it('re-sends the signed hash on Try again instead of paying twice', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    let calls = 0;
    const { user, api } = renderWithProviders(<CreditsScreen />, {
      authMode: 'privy',
      token: 'jwt_1',
      wallet,
      api: {
        ...base,
        deposit: async () => {
          calls += 1;
          if (calls === 1) throw new ApiError(404, 'not_found', 'transaction not found');
          return { credited: 1000, balance: 1000, amountYocto: ONE_NEAR };
        },
      },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('s15-topup-error')).toHaveTextContent('Deposit not found yet');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('m02-done')).toBeInTheDocument();
    expect(wallet.sent).toHaveLength(1);
    expect(api.deposit.mock.calls).toEqual([['tx_1'], ['tx_1']]);
  });

  it('says Cancelled when the wallet refuses, and sends nothing to the api', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    wallet.reject('signAndSendTransaction');
    const { user, api } = renderWithProviders(<CreditsScreen />, {
      authMode: 'privy',
      token: 'jwt_1',
      wallet,
      api: { ...base },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-failed')).toHaveTextContent(
      'Cancelled. Nothing was sent.',
    );
    expect(screen.getByTestId('s15-topup-error')).toHaveTextContent('Cancelled in the wallet');
    expect(api.deposit).not.toHaveBeenCalled();
  });

  it('asks for a wallet (M01) first when no NEAR account is linked', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet' });
    const { user } = renderWithProviders(<CreditsScreen />, {
      authMode: 'privy',
      token: 'jwt_1',
      wallet,
      api: { ...base, me: async () => meFixture() },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    expect(await screen.findByTestId('m01-connect-wallet')).toBeInTheDocument();
    // The wallets are listed at once: one click on a wallet connects it.
    expect(await screen.findByTestId('m01-wallet-hot-wallet')).toBeInTheDocument();
  });
});
