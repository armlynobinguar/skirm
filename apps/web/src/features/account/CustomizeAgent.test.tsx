import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentPatch, SkillRow } from '@/lib/api/types';
import { FREE_OUTFIT_COUNT } from '@skirm/shared';
import { ApiError } from '@/lib/api/errors';
import { agentFixture, cosmeticsFixture, meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { ProfileScreen } from './ProfileScreen';
import { missingUnlocks } from './SkillLoadout';

const rook = agentFixture({ unlocks: ['builder'], skills: [] });

const skillRow = (id: string, name: string, requiredUnlocks: SkillRow['requiredUnlocks'] = []) =>
  ({ id, version: 1, name, summary: `${name} summary`, requiredUnlocks }) as unknown as SkillRow;

function setup(
  patchAgent = vi.fn(async (_id: string, p: AgentPatch) => ({ ...rook, ...p }) as never),
  owned: string[] = [],
) {
  const ownedSkills = [
    skillRow('skl_a', 'Sandbag Line', ['builder']),
    skillRow('skl_b', 'Tunnel Rat', ['digger']),
    skillRow('skl_c', 'Supply Runner'),
    skillRow('skl_d', 'Ember Guard'),
  ];
  renderWithProviders(<ProfileScreen />, {
    handle: 'ada',
    path: '/account',
    api: {
      me: async () => meFixture({ agents: [rook] }),
      myMatches: async () => [],
      skills: async () => ownedSkills,
      cosmetics: async () => cosmeticsFixture({ owned }),
      patchAgent,
    },
  });
  return { patchAgent };
}

describe('Customize agent', () => {
  it('saves a new look from the Look tab', async () => {
    const user = userEvent.setup();
    const { patchAgent } = setup();
    await user.click(await screen.findByTestId(`s16-agent-look-${rook.id}`));
    const dialog = await screen.findByRole('dialog', { name: 'Customize Rook' });
    await within(dialog).findByTestId('look-editor');
    expect(within(dialog).getByTestId('look-save')).toBeDisabled();
    await user.click(within(dialog).getByTestId('look-skin-5'));
    await user.click(within(dialog).getByTestId('look-hair-ponytail'));
    await user.click(within(dialog).getByTestId('look-headgear-bandana'));
    await user.click(within(dialog).getByTestId('look-save'));
    await waitFor(() => expect(patchAgent).toHaveBeenCalledTimes(1));
    const [id, patch] = patchAgent.mock.calls[0]!;
    expect(id).toBe(rook.id);
    expect(patch.appearance).toMatchObject({ skin: 5, hair: 'ponytail', headgear: 'bandana' });
    expect(patch.skills).toBeUndefined();
  });

  it('saves an owned premium outfit, and says so when the api refuses an unowned one', async () => {
    const user = userEvent.setup();
    const refuse = vi.fn(async () => {
      throw new ApiError(403, 'cosmetic_not_owned', 'premium look not owned');
    });
    const { patchAgent } = setup(refuse as never, ['outfit_gold']);
    await user.click(await screen.findByTestId(`s16-agent-look-${rook.id}`));
    const dialog = await screen.findByRole('dialog', { name: 'Customize Rook' });
    const gold = await within(dialog).findByTestId(`look-outfit-${FREE_OUTFIT_COUNT}`);
    await waitFor(() => expect(gold).toHaveAttribute('data-premium', 'owned'));
    await user.click(gold);
    await user.click(within(dialog).getByTestId('look-save'));
    await waitFor(() => expect(patchAgent).toHaveBeenCalledTimes(1));
    expect(patchAgent.mock.calls[0]![1].appearance).toMatchObject({ outfit: FREE_OUTFIT_COUNT });
    expect(await screen.findByText('Buy the premium colour first, or pick a free one.')).toBeInTheDocument();
  });

  it('equips owned skills from the Skills tab, three at most, and links to writing or the directory', async () => {
    const user = userEvent.setup();
    const { patchAgent } = setup();
    await user.click(await screen.findByTestId(`s16-agent-look-${rook.id}`));
    const dialog = await screen.findByRole('dialog', { name: 'Customize Rook' });
    await user.click(within(dialog).getByTestId('s16-customize-skills'));
    await within(dialog).findByTestId('skill-loadout');
    expect(within(dialog).getByTestId('skill-loadout-write')).toHaveAttribute(
      'href',
      '/skills/new',
    );
    expect(within(dialog).getByTestId('skill-loadout-directory')).toHaveAttribute(
      'href',
      '/market',
    );
    expect(within(dialog).getByText(/Needs/)).toBeInTheDocument(); // Tunnel Rat needs Digger
    for (const id of ['skl_a', 'skl_b', 'skl_c'])
      await user.click(within(dialog).getByTestId(`skill-loadout-${id}`));
    expect(within(dialog).getByTestId('skill-loadout-skl_d')).toBeDisabled();
    await user.click(within(dialog).getByTestId('skill-loadout-save'));
    await waitFor(() => expect(patchAgent).toHaveBeenCalledTimes(1));
    expect(patchAgent.mock.calls[0]![1]).toEqual({
      skills: [
        { id: 'skl_a', version: 1 },
        { id: 'skl_b', version: 1 },
        { id: 'skl_c', version: 1 },
      ],
    });
  });

  it('flags skills that need an unlock the agent lacks', () => {
    expect(missingUnlocks({ requiredUnlocks: ['builder', 'digger'] }, ['builder'])).toEqual([
      'digger',
    ]);
    expect(missingUnlocks({ requiredUnlocks: [] }, [])).toEqual([]);
  });
});
