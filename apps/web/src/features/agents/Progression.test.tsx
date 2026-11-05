import { TRAITS, progressionOf, xpForLevel } from '@skirm/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AgentProgressionInfo } from '@/lib/api/types';
import { agentFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { ProgressionPanel, XpBar, levelPct } from './Progression';

const info = (xp: number, traits: string[] = []): AgentProgressionInfo => ({
  agentId: 'agt_wick',
  progression: progressionOf(xp, traits),
  traits: Object.values(TRAITS),
  traitLevels: [3, 6],
  maxTraits: 2,
  rankedTraits: false,
});

describe('agent progression', () => {
  it('measures the way through a level', () => {
    expect(levelPct(progressionOf(0, []))).toBe(0);
    expect(levelPct(progressionOf(175, []))).toBe(50);
    expect(levelPct(progressionOf(xpForLevel(10) + 5, []))).toBe(100);
  });

  it('shows the level and XP bar, and nothing for an agent without progression', () => {
    const wick = agentFixture({ id: 'agt_wick', progression: progressionOf(175, []) });
    const { unmount } = renderWithProviders(<XpBar agent={wick} />);
    expect(screen.getByTestId('agent-xp-agt_wick')).toHaveTextContent('LV 2');
    expect(screen.getByTestId('agent-xp-agt_wick')).toHaveTextContent('175/250 XP');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    unmount();
    renderWithProviders(<XpBar agent={agentFixture({ id: 'agt_old' })} />);
    expect(screen.queryByTestId('agent-xp-agt_old')).toBeNull();
  });

  it('offers the trait picker when a pick is earned and picks one', async () => {
    const wick = agentFixture({ id: 'agt_wick', name: 'Wick', progression: progressionOf(260, []) });
    const { api } = renderWithProviders(<ProgressionPanel agent={wick} />, {
      handle: 'ada',
      api: {
        agentProgression: async () => info(260),
        pickTrait: async () => ({ ...wick, progression: progressionOf(260, ['keen']) }),
      },
    });
    expect(screen.getByTestId('agent-xp-agt_wick')).toHaveTextContent('Trait ready');
    fireEvent.click(await screen.findByTestId('trait-pick-keen'));
    await waitFor(() => expect(api.pickTrait).toHaveBeenCalledWith('agt_wick', 'keen'));
  });

  it('lists the traits held and when the next one unlocks', async () => {
    const wick = agentFixture({ id: 'agt_wick', progression: progressionOf(300, ['calm']) });
    renderWithProviders(<ProgressionPanel agent={wick} />, { handle: 'ada', api: { agentProgression: async () => info(300, ['calm']) } });
    expect(screen.getByTestId('agent-trait-calm')).toHaveTextContent('Calm');
    expect(screen.queryByTestId('trait-picker')).toBeNull();
    expect(await screen.findByText(/Next trait at level 6\. Ranked plays base stats\./)).toBeInTheDocument();
  });
});
