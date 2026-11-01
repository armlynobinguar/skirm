import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { renderWithProviders } from '@/test/render';
import { ConfirmTransactionModal } from './ConfirmTransactionModal';
import { ConnectWalletModal } from './ConnectWalletModal';

describe('M02 Confirm transaction', () => {
  it('works with the stub props only (S15 top-up): price + network fee, no royalty or fee lines', async () => {
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <ConfirmTransactionModal open item="Top up 1,000 credits" priceYocto="1000000000000000000000000" onConfirm={onConfirm} onClose={onClose} />,
      { handle: 'ada' },
    );
    expect(screen.getByRole('dialog', { name: 'Confirm transaction' })).toBeInTheDocument();
    expect(screen.getByTestId('m02-price')).toHaveTextContent('1 NEAR');
    expect(screen.queryByTestId('m02-royalty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('m02-fee')).not.toBeInTheDocument();
    expect(screen.getByTestId('m02-total')).toHaveTextContent('1.001 NEAR');
    await user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-done')).toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('m02-done-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows pending while the wallet signs, then a cancelled message on rejection', async () => {
    let reject!: (e: unknown) => void;
    const { user } = renderWithProviders(
      <ConfirmTransactionModal
        open
        item="Buy Dam First"
        priceYocto="1500000000000000000000000"
        feeYocto="75000000000000000000000"
        royaltyYocto="0"
        networkFeeYocto="2000000000000000000000"
        onConfirm={() => new Promise<void>((_, r) => (reject = r))}
        onClose={() => {}}
      />,
      { handle: 'ada' },
    );
    expect(screen.getByTestId('m02-total')).toHaveTextContent('1.502 NEAR');
    expect(screen.getByTestId('m02-seller')).toHaveTextContent('1.425 NEAR');
    await user.click(screen.getByTestId('m02-confirm'));
    expect(screen.getByTestId('m02-pending')).toBeInTheDocument();
    expect(screen.getByTestId('m02-confirm')).toHaveTextContent('Waiting for wallet');
    expect(screen.getByTestId('m02-cancel')).toBeDisabled();
    reject(new ApiError(0, 'wallet_rejected', 'User rejected'));
    expect(await screen.findByTestId('m02-failed')).toHaveTextContent('Cancelled. Nothing was sent.');
  });

  it('closes on Escape when idle', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <ConfirmTransactionModal open item="x" priceYocto="1" onConfirm={async () => {}} onClose={onClose} />,
      { handle: 'ada' },
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('M01 Connect wallet', () => {
  it('links a dev testnet account and reports it', async () => {
    const onConnected = vi.fn();
    const { user, api } = renderWithProviders(
      <ConnectWalletModal open reason="top_up" summary="Top up 1 NEAR for 1,000 credits" onClose={() => {}} onConnected={onConnected} />,
      {
        handle: 'ada',
        api: { createSession: async () => ({ account: { id: 'a', handle: 'ada', nearAccountId: 'ada.testnet' }, created: false }) },
      },
    );
    expect(screen.getByText(/To top up credits you need a NEAR wallet/)).toBeInTheDocument();
    expect(screen.getByText('Top up 1 NEAR for 1,000 credits')).toBeInTheDocument();
    await user.click(screen.getByTestId('m01-wallet-here'));
    await user.clear(screen.getByTestId('m01-account-input'));
    await user.type(screen.getByTestId('m01-account-input'), 'ada.testnet{Enter}');
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('ada.testnet'));
    expect(api.createSession).toHaveBeenCalledWith({ nearAccountId: 'ada.testnet' });
  });

  it('refuses a malformed id without calling the api, and explains a taken account', async () => {
    const { user, api } = renderWithProviders(<ConnectWalletModal open onClose={() => {}} onConnected={() => {}} />, {
      handle: 'ada',
      api: {
        createSession: async (body) => {
          if (body?.nearAccountId) throw new ApiError(409, 'near_account_taken', 'taken');
          return { account: { id: 'a', handle: 'ada', nearAccountId: null }, created: false };
        },
      },
    });
    await user.click(screen.getByTestId('m01-wallet-mynearwallet'));
    await user.clear(screen.getByTestId('m01-account-input'));
    await user.type(screen.getByTestId('m01-account-input'), 'Not Valid!');
    await user.click(screen.getByTestId('m01-connect'));
    expect(screen.getByTestId('m01-error')).toHaveTextContent('That is not a NEAR account id');
    expect(api.createSession).not.toHaveBeenCalledWith(expect.objectContaining({ nearAccountId: expect.anything() }));
    await user.clear(screen.getByTestId('m01-account-input'));
    await user.type(screen.getByTestId('m01-account-input'), 'bob.testnet');
    await user.click(screen.getByTestId('m01-connect'));
    expect(await screen.findByTestId('m01-error')).toHaveTextContent('linked to another player');
  });

  it('Not now and Escape close it', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<ConnectWalletModal open onClose={onClose} onConnected={() => {}} />, { handle: 'ada' });
    await user.click(screen.getByTestId('m01-cancel'));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
