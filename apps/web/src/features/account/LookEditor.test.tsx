import { FREE_HAIR_COUNT, FREE_OUTFIT_COUNT, HAIR_COLORS, OUTFIT_COLORS, defaultAppearance, type AgentAppearance } from '@skirm/shared';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { cosmeticsFixture, meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { LookEditor } from './LookEditor';

const AGENT = 'agt_01J0000000000000000000ROOK';
const GOLD = FREE_OUTFIT_COUNT; // outfit_gold, 100 credits
const PLATINUM = FREE_HAIR_COUNT; // hair_platinum, 40 credits

function setup(o: { owned?: string[]; initial?: AgentAppearance; buyCosmetic?: (id: string) => Promise<{ owned: string[] }> } = {}) {
  const onSave = vi.fn();
  const r = renderWithProviders(
    <LookEditor agentId={AGENT} name="Rook" unlocks={[]} initial={o.initial ?? defaultAppearance(AGENT)} saving={false} onSave={onSave} onCancel={() => {}} />,
    {
      handle: 'ada',
      api: {
        me: async () => meFixture(),
        cosmetics: async () => cosmeticsFixture({ owned: o.owned ?? [] }),
        ...(o.buyCosmetic ? { buyCosmetic: o.buyCosmetic } : {}),
      },
    },
  );
  return { ...r, onSave };
}

describe('Look editor premium colours', () => {
  it('shows free swatches plain and premium ones with a lock and a price', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId(`look-outfit-${GOLD}`)).toHaveAttribute('data-premium', 'locked'));
    for (let i = 0; i < FREE_OUTFIT_COUNT; i++) expect(screen.getByTestId(`look-outfit-${i}`)).not.toHaveAttribute('data-premium');
    for (let i = 0; i < FREE_HAIR_COUNT; i++) expect(screen.getByTestId(`look-haircolor-${i}`)).not.toHaveAttribute('data-premium');
    expect(screen.getAllByRole('radio', { name: /^Outfit / })).toHaveLength(OUTFIT_COLORS.length);
    expect(screen.getAllByRole('radio', { name: /^Hair colour / })).toHaveLength(HAIR_COLORS.length);
    expect(screen.getByTestId(`look-outfit-${GOLD}-price`)).toHaveTextContent('100');
    expect(screen.getByTestId(`look-haircolor-${PLATINUM}-price`)).toHaveTextContent('40');
    expect(screen.getByRole('radio', { name: `Outfit ${GOLD + 1}, Gold outfit, premium, 100 credits` })).toBeInTheDocument();
    expect(screen.queryByTestId('look-premium')).not.toBeInTheDocument();
  });

  it('previews an unowned premium colour but will not save it until bought', async () => {
    const { user, api, onSave } = setup({ buyCosmetic: async () => ({ owned: ['outfit_gold'] }) });
    await user.click(await screen.findByTestId(`look-outfit-${GOLD}`));
    expect(screen.getByTestId(`look-outfit-${GOLD}`)).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('look-premium')).toHaveTextContent('Gold outfit is premium: 100 paid credits. Buy it to save this look.');
    expect(screen.getByTestId('look-save')).toBeDisabled();

    await user.click(screen.getByTestId('look-buy-outfit_gold'));
    await waitFor(() => expect(api.buyCosmetic).toHaveBeenCalledWith('outfit_gold'));
    await waitFor(() => expect(screen.queryByTestId('look-premium')).not.toBeInTheDocument());
    expect(screen.getByTestId(`look-outfit-${GOLD}`)).toHaveAttribute('data-premium', 'owned');
    expect(screen.queryByTestId(`look-outfit-${GOLD}-price`)).not.toBeInTheDocument();
    expect(screen.getByTestId('look-save')).toBeEnabled();
    await user.click(screen.getByTestId('look-save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ outfit: GOLD }));
  });

  it('links to credits when the paid balance is short (402)', async () => {
    const { user } = setup({
      buyCosmetic: async () => {
        throw new ApiError(402, 'insufficient_credits', 'not enough paid credits', undefined, { need: 40, have: 10 });
      },
    });
    await user.click(await screen.findByTestId(`look-haircolor-${PLATINUM}`));
    await user.click(screen.getByTestId('look-buy-hair_platinum'));
    const err = await screen.findByTestId('look-buy-error');
    expect(err).toHaveTextContent('Not enough paid credits: need 40, have 10. Premium looks use paid credits, never the free allowance.');
    expect(screen.getByTestId('look-buy-topup')).toHaveAttribute('href', '/account/credits');
    expect(screen.getByTestId('look-save')).toBeDisabled();
  });

  it('saves a look with premium colours the account owns', async () => {
    const { user, onSave } = setup({ owned: ['outfit_gold', 'hair_platinum'] });
    await waitFor(() => expect(screen.getByTestId(`look-outfit-${GOLD}`)).toHaveAttribute('data-premium', 'owned'));
    await user.click(screen.getByTestId(`look-outfit-${GOLD}`));
    await user.click(screen.getByTestId(`look-haircolor-${PLATINUM}`));
    expect(screen.queryByTestId('look-premium')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('look-save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ outfit: GOLD, hairColor: PLATINUM }));
  });

  it('cannot save a stored premium look the account does not own, until a free colour replaces it', async () => {
    const initial = { ...defaultAppearance(AGENT), outfit: GOLD };
    const { user, onSave } = setup({ initial });
    await user.click(await screen.findByTestId('look-skin-2'));
    expect(screen.getByTestId('look-save')).toBeDisabled();
    await user.click(screen.getByTestId('look-outfit-1'));
    expect(screen.getByTestId('look-save')).toBeEnabled();
    await user.click(screen.getByTestId('look-save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ outfit: 1, skin: 2 }));
  });
});
