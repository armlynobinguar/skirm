// Renting outside dev mode (privy auth): with rentals onchain the shelf signs `market.rent` in the
// wallet (FakeWallet stands in for NEAR Connect) and hands the tx hash to the api; with rentals
// offchain it pays in credits. A payment the api has not recorded yet is re-sent, never paid twice.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { RentalOffer, RentalPass } from '@/lib/api/types';
import { config } from '@/lib/config';
import { GAS } from '@/lib/wallet/contracts';
import { FakeWallet } from '@/test/fakeWallet';
import { renderWithProviders } from '@/test/render';
import { RentShelf } from './RentShelf';

const PRICE = '500000000000000000000000';
const OFFER: RentalOffer = {
  offerId: 'rof_9',
  agentId: 'agt_x',
  name: 'Rook II',
  role: 'Builder',
  vision: 3,
  comms: 3,
  tier: 'standard',
  ownerId: 'acc_k',
  ownerHandle: 'kai',
  ownerNearAccountId: 'kai.testnet',
  priceYocto: PRICE,
  payWith: 'near',
  priceCredits: 500,
};
const PASS: RentalPass = {
  rentalId: 'rnt_1',
  offerId: 'rof_9',
  agentId: 'agt_x',
  agent: null,
  priceYocto: PRICE,
  matchId: null,
  createdAt: '2026-11-03T00:00:00.000Z',
};

function setup(offer: RentalOffer, api: Partial<ApiClient>, wallet = new FakeWallet({ account: 'ada.testnet', connected: true })) {
  const r = renderWithProviders(<RentShelf passes={[]} picked={[]} onToggle={() => {}} nearId="ada.testnet" />, {
    authMode: 'privy',
    token: 'jwt_1',
    wallet,
    api: { rentalOffers: async () => [offer], myRentals: async () => ({ offers: [], passes: [] }), ...api },
  });
  return { ...r, wallet };
}

afterEach(() => localStorage.clear());

describe('RentShelf with rentals onchain', () => {
  it('signs market.rent for the offer and owner, then records the tx hash', async () => {
    const { user, api, wallet } = setup(OFFER, { rent: async () => ({ pass: PASS }) });
    const btn = await screen.findByTestId('s04-rent-rof_9');
    expect(btn).toHaveTextContent('Rent · 0.5 NEAR');
    await user.click(btn);
    await waitFor(() => expect(api.rent).toHaveBeenCalledWith('rof_9', 'tx_1'));
    expect(wallet.sent).toHaveLength(1);
    const tx = wallet.sent[0]!;
    expect(tx.receiverId).toBe(config.near.contracts.market);
    expect(tx.actions).toEqual([
      {
        type: 'FunctionCall',
        params: {
          methodName: 'rent',
          args: { rental_id: expect.stringMatching(/^rof_9:[a-z0-9]+$/), owner_id: 'kai.testnet', price: PRICE },
          gas: GAS.rent,
          deposit: PRICE,
        },
      },
    ]);
    expect(await screen.findByText('Rook II is yours for one match')).toBeInTheDocument();
    expect(localStorage.getItem('skirm:rent:pending')).toBeNull();
  });

  it('re-sends a signed tx after a dropped request instead of paying again, even after a reload', async () => {
    let calls = 0;
    const rent = async () => {
      if (++calls === 1) throw new ApiError(0, 'network', 'offline');
      return { pass: PASS };
    };
    const first = setup(OFFER, { rent });
    await first.user.click(await screen.findByTestId('s04-rent-rof_9'));
    await waitFor(() => expect(first.api.rent).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem('skirm:rent:pending')!)).toEqual({ offerId: 'rof_9', txHash: 'tx_1' });
    first.unmount();

    // A fresh page: the pending tx comes back from storage and is sent as is.
    const second = setup(OFFER, { rent });
    await second.user.click(await screen.findByTestId('s04-rent-rof_9'));
    await waitFor(() => expect(second.api.rent).toHaveBeenCalledWith('rof_9', 'tx_1'));
    expect(second.wallet.sent).toHaveLength(0);
    expect(localStorage.getItem('skirm:rent:pending')).toBeNull();
  });

  it('drops a refused payment so the next click signs a new one', async () => {
    let calls = 0;
    const { user, api, wallet } = setup(OFFER, {
      rent: async () => {
        if (++calls === 1) throw new ApiError(422, 'failed', 'rental transaction failed');
        return { pass: PASS };
      },
    });
    await user.click(await screen.findByTestId('s04-rent-rof_9'));
    expect(await screen.findByText('rental transaction failed')).toBeInTheDocument();
    await user.click(screen.getByTestId('s04-rent-rof_9'));
    await waitFor(() => expect(api.rent).toHaveBeenLastCalledWith('rof_9', 'tx_2'));
    expect(wallet.sent).toHaveLength(2);
  });

  it('tells the api nothing when the wallet is cancelled', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    wallet.reject('signAndSendTransaction');
    const { user, api } = setup(OFFER, { rent: async () => ({ pass: PASS }) }, wallet);
    await user.click(await screen.findByTestId('s04-rent-rof_9'));
    expect(await screen.findByText('Cancelled in the wallet.')).toBeInTheDocument();
    expect(api.rent).not.toHaveBeenCalled();
  });
});

describe('RentShelf with rentals offchain', () => {
  it('pays in credits with no wallet, retrying a dropped request with the same key', async () => {
    let calls = 0;
    const { user, api, wallet } = setup(
      { ...OFFER, payWith: 'credits', ownerNearAccountId: null },
      {
        rentWithCredits: async () => {
          if (++calls === 1) throw new ApiError(0, 'network', 'offline');
          return { pass: PASS, credits: 500 };
        },
      },
    );
    const btn = await screen.findByTestId('s04-rent-rof_9');
    expect(btn).toHaveTextContent('Rent · 500 credits');
    expect(btn).toBeEnabled();
    await user.click(btn);
    await waitFor(() => expect(api.rentWithCredits).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId('s04-rent-rof_9'));
    await waitFor(() => expect(api.rentWithCredits).toHaveBeenCalledTimes(2));
    const [k1, k2] = api.rentWithCredits.mock.calls.map((c) => c[1]);
    expect(k1).toMatch(/^[a-z0-9]+$/);
    expect(k2).toBe(k1);
    expect(wallet.sent).toHaveLength(0);
    expect(api.rent).not.toHaveBeenCalled();
    expect(await screen.findByText('Rook II is yours for one match')).toBeInTheDocument();
  });

  it('asks for a top-up when paid credits are short', async () => {
    const { user } = setup(
      { ...OFFER, payWith: 'credits' },
      {
        rentWithCredits: async () => {
          throw new ApiError(402, 'insufficient_credits', 'rentals are paid with paid credits; top up first', undefined, { need: 500, have: 0 });
        },
      },
    );
    await user.click(await screen.findByTestId('s04-rent-rof_9'));
    expect(await screen.findByText(/Top up on the Credits page/)).toBeInTheDocument();
    expect(localStorage.getItem('skirm:rent:pending')).toBeNull();
  });
});
