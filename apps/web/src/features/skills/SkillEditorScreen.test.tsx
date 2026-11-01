import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { NEEDS_MODEL } from './lib';
import { SkillEditorScreen, benchmarkText, unsavedKey } from './SkillEditorScreen';
import {
  ME_ID,
  SECRET_PROMPT,
  SECRET_REFLEXES,
  SKILL_ID,
  benchmarkFixture,
  marketDetailFixture,
  offlineBenchmark,
  skillRowFixture,
  skillWithTextFixture,
} from './testFixtures';

function base(o: Partial<ApiClient> = {}): Partial<ApiClient> {
  return {
    me: async () => meFixture(),
    ...o,
  };
}

describe('S08 Skill editor', () => {
  it('validates a new skill against the api limits before saving', async () => {
    const { user, api } = renderWithProviders(<SkillEditorScreen skillId={null} />, { handle: 'ada', api: base() });
    await user.click(await screen.findByTestId('s08-save'));
    expect(await screen.findByText("3 to 32 letters, digits, spaces, - and '.")).toBeInTheDocument();
    expect(screen.getByText('Write the prompt the planner reads.')).toBeInTheDocument();
    expect(screen.getByText('Pick at least one tag the skill handles.')).toBeInTheDocument();
    expect(api.createSkill).not.toHaveBeenCalled();
  });

  it('flags a prompt over 1,200 characters as you type', async () => {
    const { user } = renderWithProviders(<SkillEditorScreen skillId={null} />, { handle: 'ada', api: base() });
    const prompt = await screen.findByTestId('s08-prompt');
    await user.click(prompt);
    await user.paste('x'.repeat(1201));
    expect(screen.getByTestId('s08-prompt-count')).toHaveTextContent('1,201 / 1,200');
    expect(screen.getByText('At most 1,200 characters.')).toBeInTheDocument();
  });

  it('creates v1 with the body the api expects, then opens the editor URL', async () => {
    const { user, api, router } = renderWithProviders(<SkillEditorScreen skillId={null} />, {
      handle: 'ada',
      api: base({ createSkill: async () => skillRowFixture() }),
    });
    await user.type(await screen.findByLabelText('Name'), 'Dam First');
    await user.type(screen.getByTestId('s08-prompt'), 'Block the gap first.');
    await user.click(screen.getByTestId('s08-unlock-builder'));
    await user.click(screen.getByTestId('s08-tag-liquid'));
    await user.click(screen.getByTestId('s08-tag-spreads'));
    await user.click(screen.getByTestId('s08-save'));
    await waitFor(() =>
      expect(api.createSkill).toHaveBeenCalledWith({
        name: 'Dam First',
        summary: null,
        prompt: 'Block the gap first.',
        reflexes: null,
        requires_actions: ['place_block'],
        handles_tags: ['spreads', 'liquid'],
        royalty_bps: 500,
      }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/skills/${SKILL_ID}/edit`));
  });

  it('reads back the creator’s own prompt and saves an edit as the next version', async () => {
    const { user, api } = renderWithProviders(<SkillEditorScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({ skill: async () => skillWithTextFixture(), updateSkill: async () => skillRowFixture({ version: 2 }) }),
    });
    expect(await screen.findByTestId('s08-prompt')).toHaveValue(SECRET_PROMPT);
    expect(screen.getByTestId('s08-reflexes')).toHaveValue(SECRET_REFLEXES);
    expect(screen.getByTestId('s08-save')).toBeDisabled();
    await user.type(screen.getByTestId('s08-reflexes'), ' Always.');
    expect(screen.getByTestId('s08-save')).toHaveTextContent('Save as v2');
    expect(screen.getByTestId('s08-save-state')).toHaveTextContent('Unsaved changes');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() =>
      expect(api.updateSkill).toHaveBeenCalledWith(SKILL_ID, expect.objectContaining({ reflexes: `${SECRET_REFLEXES} Always.` })),
    );
  });

  it('keeps the text on this device when the save fails', async () => {
    const { user } = renderWithProviders(<SkillEditorScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        skill: async () => skillWithTextFixture(),
        updateSkill: async () => {
          throw new ApiError(0, 'network', 'Failed to fetch');
        },
      }),
    });
    await user.type(await screen.findByTestId('s08-reflexes'), '!');
    await user.click(screen.getByTestId('s08-save'));
    expect(await screen.findByTestId('s08-local-banner')).toHaveTextContent('Not saved. Your text is kept on this device.');
    expect(window.localStorage.getItem(unsavedKey(ME_ID, SKILL_ID))).toContain(`${SECRET_REFLEXES}!`);
  });

  it('never restores another account’s unsaved text on a shared browser (new-skill key)', async () => {
    // ada writes a new skill, the save fails, the text is kept on this device...
    const ada = renderWithProviders(<SkillEditorScreen skillId={null} />, {
      handle: 'ada',
      api: base({
        createSkill: async () => {
          throw new ApiError(0, 'network', 'Failed to fetch');
        },
      }),
    });
    await ada.user.type(await screen.findByLabelText('Name'), 'Dam First');
    await ada.user.click(screen.getByTestId('s08-prompt'));
    await ada.user.paste(SECRET_PROMPT);
    await ada.user.click(screen.getByTestId('s08-tag-liquid'));
    await ada.user.click(screen.getByTestId('s08-save'));
    expect(await screen.findByTestId('s08-local-banner')).toHaveTextContent('kept on this device');
    ada.unmount();
    // ...then bob signs in on the same browser and opens New skill.
    renderWithProviders(<SkillEditorScreen skillId={null} />, {
      handle: 'bob',
      api: base({ me: async () => meFixture({ account: { id: 'acc_01J000000000000000000000BB', handle: 'bob', nearAccountId: null } }) }),
    });
    expect(await screen.findByTestId('s08-prompt')).toHaveValue('');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('s08-prompt')).toHaveValue('');
    expect(screen.queryByTestId('s08-local-banner')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET_PROMPT);
  });

  it('restores the same account’s unsaved text for a new skill', async () => {
    window.localStorage.setItem(unsavedKey(ME_ID, null), JSON.stringify({ name: 'Dam First', prompt: SECRET_PROMPT, tags: ['liquid'] }));
    renderWithProviders(<SkillEditorScreen skillId={null} />, { handle: 'ada', api: base() });
    expect(await screen.findByTestId('s08-local-banner')).toHaveTextContent('Restored text that was not saved');
    expect(screen.getByTestId('s08-prompt')).toHaveValue(SECRET_PROMPT);
  });

  it('shows no text to someone who is not the creator', async () => {
    renderWithProviders(<SkillEditorScreen skillId={SKILL_ID} />, {
      handle: 'bob',
      api: base({ skill: async () => skillRowFixture() }),
    });
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('Only the creator can edit Dam First');
    expect(screen.queryByTestId('s08-prompt')).not.toBeInTheDocument();
  });

  it('has no private test: no Test button, map picker or test history', async () => {
    renderWithProviders(<SkillEditorScreen skillId={SKILL_ID} />, { handle: 'ada', api: base({ skill: async () => skillWithTextFixture() }) });
    expect(await screen.findByTestId('s08-mint')).toBeInTheDocument();
    for (const id of ['s08-test', 's08-test-map', 's08-test-reason', 's08-tests', 's08-no-tests']) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Test privately' })).not.toBeInTheDocument();
  });

  it('connects a wallet before minting, then shows the queued benchmark', async () => {
    const { user, api } = renderWithProviders(<SkillEditorScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        skill: async () => skillWithTextFixture(),
        createSession: async () => ({ account: { id: 'a', handle: 'ada', nearAccountId: 'ada.testnet' }, created: false }),
        mintSkill: async () => ({ tokenId: `${SKILL_ID}:1`, status: 'pending', benchmark: { status: 'queued' } }),
      }),
    });
    expect(await screen.findByTestId('s08-benchmark')).toHaveTextContent('Runs at mint');
    await user.click(screen.getByTestId('s08-mint'));
    expect(await screen.findByTestId('m01-connect-wallet')).toBeInTheDocument();
    await user.click(screen.getByTestId('m01-wallet-mynearwallet'));
    expect(screen.getByTestId('m01-account-input')).toHaveValue('ada.testnet');
    await user.click(screen.getByTestId('m01-connect'));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith({ nearAccountId: 'ada.testnet' }));
    await waitFor(() => expect(api.mintSkill).toHaveBeenCalledWith(SKILL_ID, 1));
    expect(await screen.findByText(/Dam First is minted/)).toBeInTheDocument();
    expect(screen.getByTestId('s08-benchmark')).toHaveTextContent('Queued: the platform plays it on hidden seeds');
  });

  it('mints a saved version straight away: no test gate', async () => {
    const { user, api } = renderWithProviders(<SkillEditorScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        me: async () => meFixture({ account: { ...meFixture().account, nearAccountId: 'ada.testnet' } }),
        skill: async () => skillWithTextFixture(),
        mintSkill: async () => ({ tokenId: `${SKILL_ID}:1`, status: 'minted', benchmark: { status: 'needs_model' } }),
      }),
    });
    await screen.findByTestId('s08-prompt');
    expect(screen.getByTestId('s08-mint')).toBeEnabled();
    await user.click(screen.getByTestId('s08-mint'));
    await waitFor(() => expect(api.mintSkill).toHaveBeenCalledWith(SKILL_ID, 1));
    expect(await screen.findByTestId('s08-benchmark')).toHaveTextContent(NEEDS_MODEL);
    expect(screen.queryByTestId('s08-mint-error')).not.toBeInTheDocument();
  });

  it('shows the benchmark of a minted version from the market detail', async () => {
    const { api } = renderWithProviders(<SkillEditorScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({
        skill: async () => skillWithTextFixture({ status: 'Minted', tokenId: `${SKILL_ID}:1` }),
        marketSkill: async () => marketDetailFixture({ benchmark: benchmarkFixture() }),
      }),
    });
    expect(await screen.findByText('Done · score 56%')).toBeInTheDocument();
    expect(api.marketSkill).toHaveBeenCalledWith(SKILL_ID, 1);
  });

  it('shows the lock notice for a minted version', async () => {
    renderWithProviders(<SkillEditorScreen skillId={SKILL_ID} />, {
      handle: 'ada',
      api: base({ skill: async () => skillWithTextFixture({ status: 'Minted', tokenId: `${SKILL_ID}:1` }) }),
    });
    expect(await screen.findByTestId('s08-locked')).toHaveTextContent('v1 is minted and locked. Saving writes v2');
    expect(screen.getByTestId('s08-view-market')).toHaveAttribute('href', `/market/${SKILL_ID}`);
  });
});

describe('benchmarkText', () => {
  it('says each benchmark state, the offline note included', () => {
    expect(benchmarkText({ status: 'queued' })).toBe('Queued: the platform plays it on hidden seeds');
    expect(benchmarkText({ status: 'running' })).toBe('Running now');
    expect(benchmarkText(offlineBenchmark())).toBe(NEEDS_MODEL);
    expect(benchmarkText({ status: 'failed' })).toBe('Did not finish');
    expect(benchmarkText({ status: 'done', score: null })).toBe('Done');
    expect(benchmarkText({ status: 'done', score: 0.71 })).toBe('Done · score 71%');
  });
});
