// Outside dev mode (here: privy auth) M01 links with a NEP-413 proof and S10 signs buy / list in the
// wallet before telling the api. FakeWallet stands in for NEAR Connect.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { config } from '@/lib/config';
import { buyTx, listTx } from '@/lib/wallet/contracts';
import { meFixture } from '@/test/fixtures';
import { FakeWallet } from '@/test/fakeWallet';
import { renderWithProviders } from '@/test/render';
import { ConnectWalletModal } from './ConnectWalletModal';
import { SkillDetailScreen } from './SkillDetailScreen';
import { ME_ID, SKILL_ID, marketCardFixture, marketDetailFixture } from './testFixtures';

const c = config.near.contracts;
const linked = () =>
  meFixture({ account: { ...meFixture().account, nearAccountId: 'ada.testnet' } });
const privy = { authMode: 'privy' as const, token: 'jwt_1' };

function base(o: Partial<ApiClient> = {}): Partial<ApiClient> {
  return {
    me: async () => linked(),
    marketSkill: async () => marketDetailFixture(),
    ...o,
  };
}

describe('M01 with a NEAR wallet', () => {
  it('connects a two-step wallet in one click: sign in, sign the link message, link', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet' });
    const onConnected = vi.fn();
    const { user, api } = renderWithProviders(
      <ConnectWalletModal open reason="buy" onClose={() => {}} onConnected={onConnected} />,
      {
        ...privy,
        wallet,
        api: {
          me: async () => meFixture(),
          createSession: async () => ({
            account: { id: ME_ID, handle: 'ada', nearAccountId: 'ada.testnet' },
            created: false,
          }),
        },
      },
    );
    // No dev account field and no extra "Choose a wallet" step: the wallets are listed at once.
    expect(screen.queryByTestId('m01-account-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('m01-unavailable')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('m01-wallet-mynearwallet'));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('ada.testnet'));
    expect(screen.queryByTestId('m01-connect')).not.toBeInTheDocument();
    expect(wallet.connect).toHaveBeenCalledWith('mynearwallet');
    expect(wallet.signed[0]).toMatchObject({
      message: `skirm:link-near:${ME_ID}:ada.testnet`,
      recipient: window.location.host,
    });
    expect(wallet.signed[0]!.nonce).toHaveLength(32);
    expect(api.createSession).toHaveBeenCalledWith({
      nearAccountId: 'ada.testnet',
      nearProof: {
        publicKey: 'ed25519:11111111111111111111111111111111',
        signature: btoa('\0'.repeat(64)),
        nonce: expect.stringMatching(/^[A-Za-z0-9+/]{43}=$/),
        recipient: window.location.host,
      },
    });
  });

  it('signs in and signs in one approval with a wallet that supports it', async () => {
    const wallet = new FakeWallet({ account: 'bo.testnet' });
    const onConnected = vi.fn();
    const { user, api } = renderWithProviders(
      <ConnectWalletModal open onClose={() => {}} onConnected={onConnected} />,
      {
        ...privy,
        wallet,
        api: {
          me: async () => meFixture(),
          createSession: async () => ({
            account: { id: ME_ID, handle: 'ada', nearAccountId: 'bo.testnet' },
            created: false,
          }),
        },
      },
    );
    await user.click(await screen.findByTestId('m01-wallet-hot-wallet'));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('bo.testnet'));
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.signMessage).not.toHaveBeenCalled();
    expect(wallet.connectAndSign).toHaveBeenCalledWith(
      'hot-wallet',
      expect.objectContaining({ message: `skirm:link-near:${ME_ID}`, recipient: window.location.host }),
    );
    expect(api.createSession).toHaveBeenLastCalledWith({
      nearAccountId: 'bo.testnet',
      nearProof: expect.objectContaining({ publicKey: 'ed25519:11111111111111111111111111111111' }),
    });
  });

  it('falls back to the NEAR Connect picker when no wallet list loads', async () => {
    const wallet = new FakeWallet();
    wallet.options = [];
    const onConnected = vi.fn();
    const { user } = renderWithProviders(
      <ConnectWalletModal open onClose={() => {}} onConnected={onConnected} />,
      {
        ...privy,
        wallet,
        api: {
          me: async () => meFixture(),
          createSession: async () => ({
            account: { id: ME_ID, handle: 'ada', nearAccountId: 'ada.testnet' },
            created: false,
          }),
        },
      },
    );
    await user.click(await screen.findByTestId('m01-connect'));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('ada.testnet'));
    expect(wallet.connect).toHaveBeenCalledWith(undefined);
  });

  it('says so when the player cancels in the wallet, and links nothing', async () => {
    const wallet = new FakeWallet();
    wallet.reject('signMessage');
    const { user, api } = renderWithProviders(
      <ConnectWalletModal open onClose={() => {}} onConnected={() => {}} />,
      {
        ...privy,
        wallet,
        api: { me: async () => meFixture() },
      },
    );
    await user.click(await screen.findByTestId('m01-wallet-mynearwallet'));
    expect(await screen.findByTestId('m01-error')).toHaveTextContent(
      'Cancelled in the wallet. Nothing was linked.',
    );
    expect(api.createSession).toHaveBeenCalledTimes(1); // the session check on load only
    // The list stays: a click on a wallet tries again.
    expect(screen.getByTestId('m01-wallet-mynearwallet')).toBeEnabled();
  });

  it('explains a proof the api refused', async () => {
    const { user } = renderWithProviders(
      <ConnectWalletModal open onClose={() => {}} onConnected={() => {}} />,
      {
        ...privy,
        api: {
          me: async () => meFixture(),
          createSession: vi
            .fn()
            .mockResolvedValueOnce({
              account: { id: ME_ID, handle: 'ada', nearAccountId: null },
              created: false,
            })
            .mockRejectedValueOnce(
              new ApiError(
                422,
                'near_proof_invalid',
                'that key is not a full-access key of the account',
              ),
            ),
        },
      },
    );
    await user.click(await screen.findByTestId('m01-wallet-hot-wallet'));
    expect(await screen.findByTestId('m01-error')).toHaveTextContent(
      'The wallet has to sign to prove the account is yours',
    );
  });
});

describe('S10 with a NEAR wallet', () => {
  it('buys: market.buy with the price attached, then POST purchase with the tx hash', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      ...privy,
      wallet,
      api: base({ purchaseSkill: async () => ({ owned: true, sale: {} as never }) }),
    });
    await user.click(await screen.findByTestId('s10-buy'));
    await user.click(await screen.findByTestId('m02-confirm'));
    await waitFor(() =>
      expect(api.purchaseSkill).toHaveBeenCalledWith(SKILL_ID, { txHash: 'tx_1', version: 1 }),
    );
    expect(wallet.sent).toEqual([buyTx(c, `${SKILL_ID}:1`, '1500000000000000000000000')]);
    expect(await screen.findByTestId('m02-done')).toHaveTextContent('Dam First is yours');
  });

  it('opens the wallet when it is not connected yet, and re-sends the signed tx after a failed POST', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet' });
    let calls = 0;
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      ...privy,
      wallet,
      api: base({
        purchaseSkill: async () => {
          calls += 1;
          if (calls === 1)
            throw new ApiError(503, 'rpc_unavailable', 'NEAR RPC is unavailable, try again');
          return { owned: true, sale: {} as never };
        },
      }),
    });
    await user.click(await screen.findByTestId('s10-buy'));
    await user.click(await screen.findByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-failed')).toBeInTheDocument();
    expect(wallet.connect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-done')).toBeInTheDocument();
    // Paid once: the second attempt only re-sent the hash.
    expect(wallet.sent).toHaveLength(1);
    expect(api.purchaseSkill).toHaveBeenNthCalledWith(2, SKILL_ID, { txHash: 'tx_1', version: 1 });
  });

  it('keeps a paid purchase after the drawer closes, and finishes it without paying again', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    let up = false;
    const purchaseSkill = async () => {
      if (!up) throw new ApiError(503, 'rpc_unavailable', 'NEAR RPC is unavailable, try again');
      return { owned: true as const, sale: {} as never };
    };
    const first = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, { ...privy, wallet, api: base({ purchaseSkill }) });
    await first.user.click(await screen.findByTestId('s10-buy'));
    await first.user.click(await screen.findByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-failed')).toBeInTheDocument();
    first.unmount();
    up = true;
    const again = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, { ...privy, wallet, api: base({ purchaseSkill }) });
    expect(await screen.findByTestId('s10-unrecorded')).toHaveTextContent('You paid for this skill');
    await again.user.click(screen.getByTestId('s10-unrecorded-finish'));
    await waitFor(() => expect(again.api.purchaseSkill).toHaveBeenCalledWith(SKILL_ID, { txHash: 'tx_1', version: 1 }));
    await waitFor(() => expect(screen.queryByTestId('s10-unrecorded')).not.toBeInTheDocument());
    expect(wallet.sent).toHaveLength(1);
  });

  it('says the buyer was refunded when the market recorded no sale, and lets them buy afresh', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    let calls = 0;
    const { user } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      ...privy,
      wallet,
      api: base({
        purchaseSkill: async () => {
          calls += 1;
          if (calls === 1) throw new ApiError(422, 'purchase_unverified', 'the market recorded no sale of this token', { reason: 'failed' });
          return { owned: true, sale: {} as never };
        },
      }),
    });
    await user.click(await screen.findByTestId('s10-buy'));
    await user.click(await screen.findByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-failed')).toHaveTextContent('your NEAR came back');
    // A refused hash is not re-sent: Try again signs a new purchase.
    await user.click(screen.getByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-done')).toBeInTheDocument();
    expect(wallet.sent).toHaveLength(2);
  });

  it('refuses to sign from another account than the linked one', async () => {
    const wallet = new FakeWallet({ account: 'mallory.testnet', connected: true });
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      ...privy,
      wallet,
      api: base(),
    });
    await user.click(await screen.findByTestId('s10-buy'));
    await user.click(await screen.findByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-failed')).toHaveTextContent(
      'signed in as mallory.testnet',
    );
    expect(wallet.sent).toHaveLength(0);
    expect(wallet.disconnect).toHaveBeenCalled();
    expect(api.purchaseSkill).not.toHaveBeenCalled();
  });

  it('shows "Cancelled. Nothing was sent." when the wallet refuses', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    wallet.reject('signAndSendTransaction');
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      ...privy,
      wallet,
      api: base(),
    });
    await user.click(await screen.findByTestId('s10-buy'));
    await user.click(await screen.findByTestId('m02-confirm'));
    expect(await screen.findByTestId('m02-failed')).toHaveTextContent(
      'Cancelled. Nothing was sent.',
    );
    expect(api.purchaseSkill).not.toHaveBeenCalled();
  });

  it('lists: nft_approve to the market with the price, then POST listing {priceYocto, txHash}', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    const mine = marketCardFixture().skill;
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      ...privy,
      wallet,
      api: base({
        marketSkill: async () =>
          marketDetailFixture({
            owned: true,
            listing: undefined,
            skill: {
              ...mine,
              status: 'Minted',
              creatorAccount: { id: ME_ID, handle: 'ada', nearAccountId: 'ada.testnet' },
            },
          }),
        listSkill: async () => ({ id: 'lst_2' }) as never,
      }),
    });
    await user.type(await screen.findByLabelText('Resale price'), '2');
    await user.click(screen.getByTestId('s10-list'));
    const m02 = await screen.findByTestId('m02-confirm-transaction');
    expect(within(m02).getByTestId('m02-account')).toHaveTextContent('ada.testnet');
    await user.click(screen.getByTestId('m02-confirm'));
    await waitFor(() =>
      expect(api.listSkill).toHaveBeenCalledWith(SKILL_ID, {
        priceYocto: '2000000000000000000000000',
        version: 1,
        txHash: 'tx_1',
      }),
    );
    expect(wallet.sent).toEqual([listTx(c, `${SKILL_ID}:1`, '2000000000000000000000000')]);
  });

  it('dev mode keeps the dev: hash and never touches the wallet', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      wallet,
      api: base({ purchaseSkill: async () => ({ owned: true, sale: {} as never }) }),
    });
    await user.click(await screen.findByTestId('s10-buy'));
    await user.click(await screen.findByTestId('m02-confirm'));
    await waitFor(() =>
      expect(api.purchaseSkill).toHaveBeenCalledWith(SKILL_ID, {
        txHash: expect.stringMatching(/^dev:/),
        version: 1,
      }),
    );
    expect(wallet.signAndSendTransaction).not.toHaveBeenCalled();
    expect(wallet.connect).not.toHaveBeenCalled();
  });
});
