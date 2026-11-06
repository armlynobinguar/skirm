// S10: the seller's "Cancel listing" on their own listing: DELETE /market/:id/listing, then (outside
// dev mode) the market.delist call the api names, signed by the linked wallet.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import type { CancelListingResponse } from '@/lib/api/types';
import { meFixture } from '@/test/fixtures';
import { FakeWallet } from '@/test/fakeWallet';
import { renderWithProviders } from '@/test/render';
import { SkillDetailScreen } from './SkillDetailScreen';
import { ME_ID, SKILL_ID, marketDetailFixture } from './testFixtures';

const linked = () => meFixture({ account: { ...meFixture().account, nearAccountId: 'ada.testnet' } });
const mine = () => marketDetailFixture({ listing: { ...marketDetailFixture().listing!, sellerId: ME_ID } });

function cancelled(onchain: CancelListingResponse['onchain']): CancelListingResponse {
  return { cancelled: true, listing: { ...mine().listing!, status: 'cancelled' }, onchain };
}

describe('S10 cancel listing', () => {
  it('is shown only on your own listing', async () => {
    renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: { me: async () => meFixture(), marketSkill: async () => marketDetailFixture() } as Partial<ApiClient>,
    });
    expect(await screen.findByTestId('s10-price')).toBeInTheDocument();
    expect(screen.queryByTestId('s10-cancel-listing')).not.toBeInTheDocument();
  });

  it('dev mode: cancels through the api, no wallet', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      wallet,
      api: { me: async () => meFixture(), marketSkill: async () => mine(), cancelListing: async () => cancelled(null) },
    });
    await user.click(await screen.findByTestId('s10-cancel-listing'));
    await waitFor(() => expect(api.cancelListing).toHaveBeenCalledWith(SKILL_ID, mine().listing!.version));
    expect(wallet.sent).toEqual([]);
  });

  it('with a NEAR wallet: signs the market.delist the api names', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    const delist = {
      receiverId: 'market.playskirm.testnet',
      methodName: 'delist',
      args: { token_id: `${SKILL_ID}:1` },
      deposit: '1',
      gas: '30000000000000',
      required: true,
    };
    const revoke = { ...delist, receiverId: 'skills.playskirm.testnet', methodName: 'nft_revoke', required: false };
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      authMode: 'privy',
      token: 'jwt_1',
      wallet,
      api: { me: async () => linked(), marketSkill: async () => mine(), cancelListing: async () => cancelled({ calls: [delist, revoke] }) },
    });
    await user.click(await screen.findByTestId('s10-cancel-listing'));
    await waitFor(() => expect(api.cancelListing).toHaveBeenCalled());
    // The delist is signed once, before the api takes the listing down (no second delist).
    expect(wallet.sent).toHaveLength(1);
    expect(wallet.sent[0]).toEqual({
      receiverId: 'market.playskirm.testnet',
      actions: [{ type: 'FunctionCall', params: { methodName: 'delist', args: { token_id: `${SKILL_ID}:1` }, gas: '30000000000000', deposit: '1' } }],
    });
  });

  it('leaves the listing up when the wallet refuses the delist', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    wallet.reject('signAndSendTransaction');
    const { user, api } = renderWithProviders(<SkillDetailScreen skillId={SKILL_ID} />, {
      authMode: 'privy',
      token: 'jwt_1',
      wallet,
      api: { me: async () => linked(), marketSkill: async () => mine(), cancelListing: async () => cancelled({ calls: [] }) },
    });
    await user.click(await screen.findByTestId('s10-cancel-listing'));
    expect(await screen.findByTestId('toasts')).toBeInTheDocument();
    expect(api.cancelListing).not.toHaveBeenCalled();
    expect(screen.getByTestId('s10-cancel-listing')).toBeEnabled();
  });
});
