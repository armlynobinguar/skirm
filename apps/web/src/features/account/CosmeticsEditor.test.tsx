import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { Cosmetics } from '@/lib/api/types';
import { cosmeticsFixture, meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { CosmeticsEditor } from './CosmeticsEditor';

const AGENT = 'agt_01J0000000000000000000ROOK';

function setup(o: Partial<Cosmetics> = {}, api: Record<string, unknown> = {}) {
  const onDone = vi.fn();
  const r = renderWithProviders(<CosmeticsEditor agentId={AGENT} name="Rook" onDone={onDone} />, {
    handle: 'ada',
    api: { me: async () => meFixture(), cosmetics: async () => cosmeticsFixture(o), ...api },
  });
  return { ...r, onDone };
}

describe('Arena style (cosmetics editor)', () => {
  it('lists skins, trails and nameplates with prices; unowned ones cannot be equipped', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('style-buy-skin_ember')).toHaveTextContent('90'));
    expect(screen.getByTestId('style-slot-skin')).toBeInTheDocument();
    expect(screen.getByTestId('style-slot-trail')).toBeInTheDocument();
    expect(screen.getByTestId('style-slot-nameplate')).toBeInTheDocument();
    expect(screen.getByTestId('style-equip-skin_ember')).toBeDisabled();
    expect(screen.getByTestId('style-skin-none')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('style-mint-skin_ember')).not.toBeInTheDocument();
  });

  it('buys an item, then equips an owned one on this agent', async () => {
    const buyCosmetic = vi.fn(async () => ({ owned: ['trail_spark'] }));
    const equipCosmetic = vi.fn(async () => ({ cosmetics: { trail: 'trail_spark' } }));
    const { user } = setup({}, { buyCosmetic, equipCosmetic });
    await user.click(await screen.findByTestId('style-buy-trail_spark'));
    expect(buyCosmetic).toHaveBeenCalledWith('trail_spark');
    await waitFor(() => expect(screen.getByTestId('style-equip-trail_spark')).toBeEnabled());
    await user.click(screen.getByTestId('style-equip-trail_spark'));
    expect(equipCosmetic).toHaveBeenCalledWith(AGENT, 'trail', 'trail_spark');
    await waitFor(() => expect(screen.getByTestId('style-equip-trail_spark')).toHaveAttribute('aria-checked', 'true'));
    // Back to the default look.
    equipCosmetic.mockResolvedValueOnce({ cosmetics: {} } as never);
    await user.click(screen.getByTestId('style-trail-none'));
    expect(equipCosmetic).toHaveBeenLastCalledWith(AGENT, 'trail', null);
  });

  it('explains a paid-credit shortfall with a top-up link', async () => {
    const buyCosmetic = vi.fn(async () => {
      throw new ApiError(402, 'insufficient_credits', 'short', undefined, { need: 90, have: 10 });
    });
    const { user } = setup({}, { buyCosmetic });
    await user.click(await screen.findByTestId('style-buy-skin_ember'));
    expect(await screen.findByTestId('style-buy-error')).toHaveTextContent('need 90, have 10');
  });

  it('shows NEP-245 mints when the contract is on, and mints an owned item', async () => {
    const mintCosmetic = vi.fn(async () => ({ mint: { status: 'minted' as const, txHash: 'TX', owner: 'ada.testnet' } }));
    const { user } = setup(
      {
        owned: ['skin_ember', 'plate_gold'],
        equipped: { [AGENT]: { skin: 'skin_ember' } },
        mints: { skin_ember: { status: 'minted', txHash: 'TX0', owner: 'ada.testnet' } },
        onchain: { standard: 'nep245', contractId: 'cosmetics.playskirm.testnet' },
      },
      { mintCosmetic },
    );
    expect(await screen.findByTestId('style-mint-skin_ember')).toHaveTextContent('On NEAR');
    expect(screen.getByTestId('style-equip-skin_ember')).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByTestId('style-mint-plate_gold'));
    expect(mintCosmetic).toHaveBeenCalledWith('plate_gold');
  });

  it('says a minted item is on another NEAR account instead of offering a buy that does nothing', async () => {
    setup({
      owned: [],
      mints: { trail_spark: { status: 'minted', txHash: 'TX0', owner: 'old.testnet' } },
      onchain: { standard: 'nep245', contractId: 'cosmetics.playskirm.testnet' },
    });
    expect(await screen.findByTestId('style-elsewhere-trail_spark')).toHaveTextContent('Minted to old.testnet, not on your linked NEAR account now');
    expect(screen.queryByTestId('style-buy-trail_spark')).toBeNull();
    expect(screen.getByTestId('style-equip-trail_spark')).toBeDisabled();
  });
});
