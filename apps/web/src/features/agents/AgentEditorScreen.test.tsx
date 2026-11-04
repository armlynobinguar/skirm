import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { skillRowFixture } from '@/features/skills/testFixtures';
import { ApiError } from '@/lib/api/errors';
import type { AgentPatch, AgentRecord, SkillWithText } from '@/lib/api/types';
import { agentFixture, meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { AgentEditorScreen } from './AgentEditorScreen';

const WICK = agentFixture({
  id: 'agt_wick',
  name: 'Wick',
  role: 'Builder',
  vision: 4,
  comms: 3,
  tier: 'standard',
  matchesPlayed: 4,
  wins: 3,
  losses: 1,
  systemPrompt: 'Speak calmly.',
  skills: [{ id: 'skl_mine', version: 2, name: 'Dam First' }],
});
const MOSS = agentFixture({ id: 'agt_moss', name: 'Moss', role: 'Runner', tier: 'open', skills: [{ id: 'skl_bought', version: 5, name: 'Clean Sweep' }] });
const PIKE = agentFixture({ id: 'agt_pike', name: 'Pike', role: 'Digger' });

const MINE = skillRowFixture({ id: 'skl_mine', version: 2, name: 'Dam First' });
const BOUGHT = skillRowFixture({ id: 'skl_bought', version: 5, name: 'Clean Sweep', creatorAccount: { id: 'acc_k', handle: 'kai.testnet', nearAccountId: null } });

const COUNTS = { matches: 5, wins: 3, losses: 1, draws: 1, delivered: 9, bluffsTold: 4, bluffsLanded: 1, seenThrough: 2 };

function setup(
  agentId = WICK.id,
  o: { mapId?: string; difficulty?: string; patch?: (id: string, p: AgentPatch) => Promise<never> | ReturnType<typeof agentFixture>; record?: AgentRecord } = {},
) {
  return renderWithProviders(<AgentEditorScreen agentId={agentId} mapId={o.mapId} difficulty={o.difficulty} />, {
    handle: 'ada',
    path: `/agents/${agentId}`,
    api: {
      me: async () => meFixture({ agents: [WICK, MOSS, PIKE] }),
      skills: async (tab) => (tab === 'written' ? [MINE] : [MINE, BOUGHT]),
      skill: async () => ({ ...MINE, prompt: 'Dam the left channel first.', reflexes: null }) as SkillWithText,
      patchAgent: async (id, p) => (o.patch ? o.patch(id, p) : { ...WICK, ...p, id }) as never,
      ...(o.record ? { agentRecord: async () => o.record! } : {}),
    },
  });
}

describe('agent editor', () => {
  it('offers the agent for rent at a price per match, shows the share after the fee, and stops', async () => {
    let offers: { offerId: string; agentId: string; priceYocto: string; active: boolean }[] = [];
    const { api, user } = renderWithProviders(<AgentEditorScreen agentId={WICK.id} />, {
      handle: 'ada',
      path: `/agents/${WICK.id}`,
      api: {
        me: async () => meFixture({ account: { id: 'acc_me', handle: 'ada', nearAccountId: 'ada.testnet' }, agents: [WICK, MOSS, PIKE] }),
        skills: async () => [],
        myRentals: async () => ({ offers, passes: [] }),
        setRentalOffer: async (agentId: string, priceYocto: string | null) => {
          offers = priceYocto ? [{ offerId: 'rof_1', agentId, priceYocto, active: true }] : [];
          return { offer: offers[0] ?? null };
        },
      },
    });
    expect(await screen.findByTestId('agent-rent-state')).toHaveTextContent('Not offered');
    await user.type(screen.getByTestId('agent-rent-price'), '0.5');
    expect(screen.getByTestId('agent-rent-note')).toHaveTextContent('You get 0.475 NEAR a match after the 5% platform fee.');
    await user.click(screen.getByTestId('agent-rent-offer'));
    expect(api.setRentalOffer).toHaveBeenCalledWith(WICK.id, '500000000000000000000000');
    expect(await screen.findByText('0.5 NEAR')).toBeInTheDocument();
    await user.click(screen.getByTestId('agent-rent-stop'));
    expect(api.setRentalOffer).toHaveBeenLastCalledWith(WICK.id, null);
    expect(await screen.findByText('Not offered')).toBeInTheDocument();
  });

  it('asks for a NEAR account before renting an agent out', async () => {
    setup();
    expect(await screen.findByTestId('agent-rent-note')).toHaveTextContent('Link a NEAR account');
    expect(screen.queryByTestId('agent-rent-price')).toBeNull();
  });

  it('shows the season record from the record endpoint, bluffs included', async () => {
    setup(WICK.id, { record: { allTime: { ...COUNTS, matches: 8 }, season: { number: 2, endsAt: '2026-11-10T00:00:00.000Z', ...COUNTS } } });
    expect(await screen.findByTestId('agent-record-span')).toHaveTextContent('Season 2');
    const record = screen.getByTestId('agent-record');
    expect(record).toHaveTextContent('60% wins');
    expect(record).toHaveTextContent('Matches5');
    expect(record).toHaveTextContent('Deliv/match1.8');
    expect(record).toHaveTextContent('Bluffs1/4');
    expect(screen.getByTestId('agent-record-seen')).toHaveTextContent('Saw through 2 rival bluffs this season.');
    expect(within(record).queryByText('Soon')).toBeNull();
  });

  it('shows the all-time record when no season is open', async () => {
    setup(WICK.id, { record: { allTime: { ...COUNTS, matches: 0, wins: 0, losses: 0, draws: 0, delivered: 0, bluffsTold: 0, bluffsLanded: 0, seenThrough: 1 }, season: null } });
    expect(await screen.findByTestId('agent-record-span')).toHaveTextContent('All time');
    const record = screen.getByTestId('agent-record');
    expect(record).toHaveTextContent('No matches yet');
    expect(record).toHaveTextContent('Deliv/match–');
    expect(screen.getByTestId('agent-record-seen')).toHaveTextContent('Saw through 1 rival bluff all time.');
  });

  it('shows the system prompt, stats, skill prompt, tier, record and inner voice', async () => {
    setup(WICK.id, { mapId: 'copper-hollow', difficulty: 'hard' });
    const prompt = await screen.findByTestId('agent-prompt');
    expect(prompt).toHaveValue('Speak calmly.');
    expect(screen.getByTestId('agent-prompt-count')).toHaveTextContent('13/600');
    expect(screen.getByTestId('agent-prompt-save')).toBeDisabled();
    expect(screen.getByRole('img', { name: 'Vision 4 of 5' })).toBeInTheDocument();
    expect(screen.getByText('Sees 5 tiles · 4 at night')).toBeInTheDocument();
    expect(screen.getByText('Say reaches 5 tiles')).toBeInTheDocument();
    expect(screen.getByTestId('agent-meta')).toHaveTextContent('Dam First v2 · talk: Standard · voice: Calm');
    expect(await within(screen.getByTestId('agent-skill')).findByText('Dam the left channel first.')).toBeInTheDocument();
    expect(screen.getByTestId('agent-skill')).toHaveTextContent('yours');
    const record = screen.getByTestId('agent-record');
    expect(record).toHaveTextContent('75% wins');
    expect(within(record).getByLabelText('Season record: coming soon')).toBeInTheDocument();
    expect(within(record).getByLabelText('Bluff stats: coming soon')).toBeInTheDocument();
    expect(screen.getByTestId('agent-voice')).toHaveTextContent(/\w/);
    expect(screen.getByText(/dry run on Copper Hollow/i)).toBeInTheDocument();
    expect(screen.getByTestId('agent-back')).toHaveAttribute('href', '/maps/copper-hollow/crew?d=hard');
  });

  it('opens the system prompt panel from its tile and closes it with ✕ and Escape', async () => {
    const { user, router } = setup();
    const open = await screen.findByTestId('agent-prompt-open');
    expect(open).toHaveTextContent('13/600');
    const panel = document.getElementById(open.getAttribute('aria-controls')!)!;
    expect(panel).toHaveAttribute('aria-label', 'System prompt for Wick');
    expect(panel).not.toBeVisible();
    await user.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close the system prompt' }));
    expect(panel).not.toBeVisible();
    await user.click(open);
    await user.keyboard('{Escape}');
    expect(panel).not.toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('saves and resets the system prompt', async () => {
    const { user, api } = setup();
    await user.click(await screen.findByTestId('agent-prompt-open'));
    const prompt = await screen.findByTestId('agent-prompt');
    await user.clear(prompt);
    await user.type(prompt, '  Never say our route.  ');
    expect(screen.getByTestId('agent-prompt-count')).toHaveTextContent('24/600');
    await user.click(screen.getByTestId('agent-prompt-save'));
    expect(api.patchAgent).toHaveBeenCalledWith(WICK.id, { systemPrompt: 'Never say our route.' });
    expect(await screen.findByText(/Wick's system prompt is 20 characters/)).toBeInTheDocument();
    await user.click(screen.getByTestId('agent-prompt-reset'));
    expect(api.patchAgent).toHaveBeenLastCalledWith(WICK.id, { systemPrompt: null });
    expect(await screen.findByText(/the planner reads the skill alone/)).toBeInTheDocument();
    expect(screen.getByTestId('agent-prompt')).toHaveValue('');
    expect(screen.getByTestId('agent-prompt')).toHaveAttribute('placeholder', expect.stringMatching(/^You are Wick, a Builder/));
  });

  it('caps the prompt at 600 characters', async () => {
    setup();
    const prompt = await screen.findByTestId('agent-prompt');
    expect(prompt).toHaveAttribute('maxLength', '600');
  });

  it('shows a save error and keeps the draft', async () => {
    const { user } = setup(WICK.id, { patch: async () => Promise.reject(new ApiError(422, 'invalid_body', 'too long')) });
    await user.click(await screen.findByTestId('agent-prompt-open'));
    const prompt = await screen.findByTestId('agent-prompt');
    await user.type(prompt, ' Hold the switch.');
    await user.click(screen.getByTestId('agent-prompt-save'));
    expect(await screen.findByTestId('toasts')).toBeInTheDocument();
    expect(prompt).toHaveValue('Speak calmly. Hold the switch.');
    expect(screen.getByTestId('agent-prompt-save')).toBeEnabled();
  });

  it('keeps a bought skill encrypted, swaps skills and sets the default talk tier', async () => {
    const { user, api } = setup(MOSS.id);
    const skill = await screen.findByTestId('agent-skill');
    expect(await within(skill).findByText(/PROMPT ENCRYPTED · by kai\.testnet/)).toBeInTheDocument();
    expect(api.skill).not.toHaveBeenCalled();
    await user.click(within(skill).getByRole('button', { name: 'Dam First v2' }));
    expect(api.patchAgent).toHaveBeenCalledWith(MOSS.id, { skills: [{ id: 'skl_mine', version: 2 }] });
    const tiers = screen.getByRole('group', { name: 'Default talk tier' });
    expect(within(tiers).getAllByRole('button').map((b) => b.textContent)).toEqual(['Quiet · 0.20/T', 'Standard · 0.20/T', 'Open · 0.40/T']);
    await user.click(within(tiers).getByRole('button', { name: /Quiet/ }));
    expect(api.patchAgent).toHaveBeenLastCalledWith(MOSS.id, { tier: 'quiet' });
  });

  it('lists skills for another role last and disabled with the reason, and tags the equipped skill', async () => {
    const SCOUT = skillRowFixture({ id: 'skl_scout', version: 1, name: 'Scout Sweep', roles: ['Scout'] });
    const { user, api } = renderWithProviders(<AgentEditorScreen agentId={MOSS.id} />, {
      handle: 'ada',
      path: `/agents/${MOSS.id}`,
      api: {
        me: async () => meFixture({ agents: [WICK, MOSS, PIKE] }),
        skills: async (tab) => (tab === 'written' ? [MINE] : [SCOUT, MINE, { ...BOUGHT, roles: ['Runner'] }]),
        patchAgent: async (id, p) => ({ ...MOSS, ...p, id }) as never,
      },
    });
    const skill = await screen.findByTestId('agent-skill');
    const scout = await within(skill).findByTestId('agent-skill-slot-skl_scout');
    expect(scout).toBeDisabled();
    expect(scout).toHaveAttribute('title', 'Scout Sweep v1 · Scout. For Scout only; this agent is a Runner');
    const slots = within(screen.getByRole('group', { name: 'Swap skill' })).getAllByRole('button');
    expect(slots.at(-1)).toBe(scout);
    expect(within(skill).getByTestId('role-tag')).toHaveTextContent('Runner');
    await user.click(within(skill).getByRole('button', { name: 'Dam First v2' }));
    expect(api.patchAgent).toHaveBeenCalledWith(MOSS.id, { skills: [{ id: 'skl_mine', version: 2 }] });
  });

  it('steps through the roster with the buttons and the arrow keys, not while typing', async () => {
    const { user, router } = setup(WICK.id, { mapId: 'copper-hollow' });
    await screen.findByTestId('agent-prompt');
    await user.click(screen.getByRole('button', { name: 'Next agent' }));
    expect(router.replace).toHaveBeenLastCalledWith('/agents/agt_moss?map=copper-hollow');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(router.replace).toHaveBeenLastCalledWith('/agents/agt_pike?map=copper-hollow');
    router.replace.mockClear();
    fireEvent.keyDown(screen.getByTestId('agent-prompt'), { key: 'ArrowRight' });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says so for an agent that is not on the account', async () => {
    setup('agt_other');
    expect(await screen.findByText('This agent is not on your account.')).toBeInTheDocument();
  });

  it('needs a session', async () => {
    renderWithProviders(<AgentEditorScreen agentId={WICK.id} />, { api: {} });
    expect(await screen.findByTestId('signin-required')).toBeInTheDocument();
  });
});
