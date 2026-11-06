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

  it('gasless onboarding: signs a delegate, the relay sends it, and says skirm paid the gas', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true, delegates: true });
    const { user, api } = renderWithProviders(<CreditsScreen />, {
      authMode: 'privy',
      token: 'jwt_1',
      wallet,
      api: {
        ...base,
        relayStatus: async () => ({ enabled: true, freeTxs: 3, used: 0, remaining: 3 }),
        relay: async () => ({ txHash: 'RELAYHASH', remaining: 2 }),
        deposit: async () => ({ credited: 1000, balance: 1000, amountYocto: ONE_NEAR }),
      },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await user.click(screen.getByTestId('m02-confirm'));
    await waitFor(() => expect(api.deposit).toHaveBeenCalledWith('RELAYHASH'));
    expect(wallet.delegated).toEqual([depositTx(config.near.contracts, ONE_NEAR)]);
    expect(wallet.sent).toEqual([]);
    expect(await screen.findByText('Gas paid by skirm')).toBeInTheDocument();
  });

  it('gasless onboarding off: the same wallet sends the usual transaction, with no note', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true, delegates: true });
    const { user, api } = renderWithProviders(<CreditsScreen />, {
      authMode: 'privy',
      token: 'jwt_1',
      wallet,
      api: {
        ...base,
        relayStatus: async () => ({ enabled: false, freeTxs: 0, used: 0, remaining: 0 }),
        deposit: async () => ({ credited: 1000, balance: 1000, amountYocto: ONE_NEAR }),
      },
    });
    await screen.findByTestId('s15-balance-available');
    await user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await user.click(screen.getByTestId('m02-confirm'));
    await waitFor(() => expect(api.deposit).toHaveBeenCalledWith('tx_1'));
    expect(wallet.delegated).toEqual([]);
    expect(api.relay).not.toHaveBeenCalled();
    expect(screen.queryByText('Gas paid by skirm')).not.toBeInTheDocument();
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

  it('keeps a signed deposit across a reload and finishes it before any new one, never paying twice', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    let up = false;
    const deposit = async () => {
      if (!up) throw new ApiError(503, 'rpc_unavailable', 'NEAR RPC is unavailable');
      return { credited: 1000, balance: 1000, amountYocto: ONE_NEAR };
    };
    const first = renderWithProviders(<CreditsScreen />, { authMode: 'privy', token: 'jwt_1', wallet, api: { ...base, deposit } });
    await screen.findByTestId('s15-balance-available');
    await first.user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await first.user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('s15-topups-paused')).toBeInTheDocument();
    expect(wallet.sent).toHaveLength(1);
    // The tab is closed and opened again: the paid deposit is still there to finish.
    first.unmount();
    up = true;
    const again = renderWithProviders(<CreditsScreen />, { authMode: 'privy', token: 'jwt_1', wallet, api: { ...base, deposit } });
    expect(await screen.findByTestId('s15-unrecorded')).toHaveTextContent('You sent 1 NEAR and it is not credited yet');
    // Picking another pack finishes the signed one instead of paying again.
    await again.user.click(screen.getByRole('button', { name: 'Top up 1 NEAR' }));
    await again.user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-done')).toBeInTheDocument();
    expect(wallet.sent).toHaveLength(1);
    expect(again.api.deposit.mock.calls).toEqual([['tx_1']]);
    await waitFor(() => expect(screen.queryByTestId('s15-unrecorded')).not.toBeInTheDocument());
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
