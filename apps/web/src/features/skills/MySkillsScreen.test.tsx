import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { renderWithProviders } from '@/test/render';
import { MySkillsScreen } from './MySkillsScreen';
import { SECRET_PROMPT, SKILL_ID, skillRowFixture, skillWithTextFixture } from './testFixtures';

const written = [
  skillRowFixture({ status: 'Draft' }),
  skillRowFixture({ id: 'skl_01J000000000000000000FIRE1', name: 'Firebreak First', status: 'Listed', handles_tags: ['spreads', 'flammable'], requiredUnlocks: [], requires_actions: [] }),
];

describe('S07 My skills', () => {
  it('lists written skills with status, tags and needs', async () => {
    renderWithProviders(<MySkillsScreen />, {
      handle: 'ada',
      api: { skills: async (tab) => (tab === 'owned' ? [] : written) },
    });
    const row = await screen.findByTestId(`s07-skill-row-${SKILL_ID}`);
    expect(within(row).getByTestId('s07-status')).toHaveTextContent('Draft');
    expect(within(row).getByText('Builder')).toBeInTheDocument();
    expect(within(row).getByTestId(`s07-edit-${SKILL_ID}`)).toHaveAttribute('href', `/skills/${SKILL_ID}/edit`);

    const listed = screen.getByTestId('s07-skill-row-skl_01J000000000000000000FIRE1');
    expect(within(listed).getByTestId('s07-status')).toHaveTextContent('Listed');
    expect(within(listed).getByText('None')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Written by me/ })).toHaveTextContent('2');
  });

  it('shows royalties earned per written skill from the row, and a dash without it or on Owned', async () => {
    const { user } = renderWithProviders(<MySkillsScreen />, {
      handle: 'ada',
      api: {
        skills: async (tab) =>
          tab === 'owned'
            ? [skillRowFixture({ id: 'skl_owned', status: 'Minted', royaltiesYocto: '5' })]
            : [skillRowFixture({ status: 'Listed', royaltiesYocto: '125000000000000000000000' }), written[1]!],
      },
    });
    const row = await screen.findByTestId(`s07-skill-row-${SKILL_ID}`);
    expect(within(row).getByTestId('s07-royalties')).toHaveTextContent('0.125 NEAR');
    // A row without the field.
    expect(within(screen.getByTestId('s07-skill-row-skl_01J000000000000000000FIRE1')).getByTestId('s07-royalties')).toHaveTextContent('–');
    await user.click(screen.getByRole('tab', { name: /Owned/ }));
    const owned = await screen.findByTestId('s07-skill-row-skl_owned');
    expect(within(owned).getByTestId('s07-royalties')).toHaveTextContent('–');
  });

  it('switches to Owned with the keyboard and updates the URL', async () => {
    const { user, router } = renderWithProviders(<MySkillsScreen />, {
      handle: 'ada',
      api: { skills: async (tab) => (tab === 'owned' ? [] : written) },
    });
    await screen.findByTestId(`s07-skill-row-${SKILL_ID}`);
    screen.getByRole('tab', { name: /Written by me/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Owned/ })).toHaveAttribute('aria-selected', 'true');
    expect(router.replace).toHaveBeenCalledWith('/skills?tab=owned', { scroll: false });
    expect(await screen.findByText(/You own no skills yet/)).toBeInTheDocument();
  });

  it('opens on the Owned tab from ?tab=owned', async () => {
    renderWithProviders(<MySkillsScreen />, {
      handle: 'ada',
      search: '?tab=owned',
      api: { skills: async (tab) => (tab === 'owned' ? [skillRowFixture({ status: 'Minted' })] : []) },
    });
    expect(await screen.findByTestId('s07-panel-owned')).toBeInTheDocument();
    expect(await screen.findByTestId(`s07-view-${SKILL_ID}`)).toHaveAttribute('href', `/market/${SKILL_ID}`);
  });

  it('shows the written empty state with a New skill action', async () => {
    renderWithProviders(<MySkillsScreen />, { handle: 'ada', api: { skills: async () => [] } });
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('You have not written a skill yet');
    expect(screen.getByTestId('s07-new-skill')).toHaveAttribute('href', '/skills/new');
  });

  it('shows skeleton rows while loading and an error card with Retry', async () => {
    let fail = true;
    const { user, api } = renderWithProviders(<MySkillsScreen />, {
      handle: 'ada',
      api: {
        skills: async () => {
          if (fail) throw new ApiError(0, 'network', 'Failed to fetch');
          return written;
        },
      },
    });
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(await screen.findByTestId('error-card')).toHaveTextContent('Offline');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId(`s07-skill-row-${SKILL_ID}`)).toBeInTheDocument();
    expect(api.skills).toHaveBeenCalled();
  });

  it('never renders prompt text, even if a row carried it', async () => {
    renderWithProviders(<MySkillsScreen />, {
      handle: 'ada',
      api: { skills: async () => [skillWithTextFixture()] },
    });
    await screen.findByTestId(`s07-skill-row-${SKILL_ID}`);
    expect(document.body.textContent).not.toContain(SECRET_PROMPT);
  });

  it('asks signed-out visitors to sign in', async () => {
    renderWithProviders(<MySkillsScreen />);
    await waitFor(() => expect(screen.getByTestId('signin-required')).toBeInTheDocument());
  });
});
