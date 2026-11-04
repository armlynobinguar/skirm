import { act, screen, within } from '@testing-library/react';
import { CAMPAIGN_CHAPTERS, missionUnlocked, objectiveLabel } from '@skirm/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { HomeScreen } from '@/features/play/HomeScreen';
import type { Campaign, CampaignStart } from '@/lib/api/campaignTypes';
import { ApiError } from '@/lib/api/errors';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { testRouter } from '@/test/router';
import { CampaignScreen } from './CampaignScreen';

const MATCH = 'mat_01JB7Z3K9QX4M2T8V6N5R1C0DE';

/** GET /campaign as the api answers it for these cleared missions. */
function campaign(clearedIds: string[] = [], granted: string[] = []): Campaign {
  const cleared = new Set(clearedIds);
  const chapters = CAMPAIGN_CHAPTERS.map((c, i) => {
    const missions = c.missions.map((m) => ({
      id: m.id,
      title: m.title,
      briefing: m.briefing,
      mapId: m.mapId,
      mapName: m.mapId,
      difficulty: m.difficulty,
      crewSize: m.crewSize,
      objective: { ...m.objective, label: objectiveLabel(m.objective) },
      rival: { handle: 'Greedy bot', size: m.crewSize, tier: 'standard' as const },
      costCredits: 0,
      status: cleared.has(m.id) ? ('cleared' as const) : missionUnlocked(m.id, cleared) ? ('open' as const) : ('locked' as const),
      attempts: cleared.has(m.id) ? 1 : 0,
      bestTicks: cleared.has(m.id) ? 40 : null,
      clearedAt: null,
    }));
    return {
      id: c.id,
      index: i + 1,
      title: c.title,
      blurb: c.blurb,
      unlocked: missions[0]!.status !== 'locked',
      complete: missions.every((m) => m.status === 'cleared'),
      cleared: missions.filter((m) => m.status === 'cleared').length,
      missions,
      rewards: {
        skill: { id: c.rewards.skill.id, version: 1, name: c.rewards.skill.name, summary: c.rewards.skill.summary, requires_actions: [], handles_tags: [] },
        cosmetic: c.rewards.cosmetic ? { id: c.rewards.cosmetic, name: 'Obsidian outfit', kind: 'outfit' as const } : null,
        granted: granted.includes(c.id),
        grantedAt: null,
      },
    };
  });
  const total = chapters.reduce((n, c) => n + c.missions.length, 0);
  return { brain: 'greedy', free: true, progress: { cleared: cleared.size, total }, chapters };
}

const startOf = (id: string): CampaignStart => {
  const m = campaign().chapters.flatMap((c) => c.missions).find((x) => x.id === id)!;
  return { mission: m, queue: { type: 'v2_queue', ranked: false, opponent: 'bot', mapId: m.mapId, difficulty: m.difficulty, mission: id } };
};

describe('Campaign (/campaign)', () => {
  // The briefing writes its mission into the URL hash; start each test from a clean URL.
  beforeEach(() => window.history.replaceState(null, '', '/campaign'));

  it('shows chapters with locked and open missions, then starts the first one', async () => {
    const { user, realtime, api } = renderWithProviders(<CampaignScreen />, {
      handle: 'ada',
      path: '/campaign',
      api: { me: async () => meFixture(), campaign: async () => campaign(), startMission: async (id: string) => startOf(id) },
    });
    expect(await screen.findByTestId('campaign-progress')).toHaveTextContent('0 of 10 missions cleared');
    expect(screen.getByTestId('campaign-mission-c1-m1')).not.toBeDisabled();
    expect(screen.getByTestId('campaign-mission-c1-m2')).toBeDisabled();
    expect(screen.getByTestId('campaign-chapter-c2-state')).toHaveTextContent('Locked');
    expect(within(screen.getByTestId('campaign-reward-c1')).getByText(/Levee Line/)).toBeInTheDocument();

    const brief = screen.getByTestId('campaign-briefing');
    expect(within(brief).getByRole('heading', { name: 'Weir Watch' })).toBeInTheDocument();
    expect(screen.getByTestId('campaign-objective')).toHaveTextContent('Win the match');
    await user.click(screen.getByTestId('campaign-start'));
    expect(api.startMission).toHaveBeenCalledWith('c1-m1');
    expect(realtime.sentOf('v2_queue')).toEqual([
      { type: 'v2_queue', ranked: false, opponent: 'bot', mapId: 'saltmarsh-weir', difficulty: 'easy', mission: 'c1-m1', crew: [{ agentId: meFixture().agents[0]!.id, tier: 'standard' }] },
    ]);
    act(() => realtime.emit({ type: 'v2_found', matchId: MATCH, team: 'A', mapId: 'saltmarsh-weir', ranked: false, acceptMs: 10_000, difficulty: 'easy', practice: true, free: true, rivalHandle: 'Greedy bot' }));
    expect(testRouter.push).toHaveBeenCalledWith(`/matches/${MATCH}`);
  });

  it('shows a granted reward and explains a locked mission refused by the api', async () => {
    const c1 = CAMPAIGN_CHAPTERS[0]!.missions.map((m) => m.id);
    const { user } = renderWithProviders(<CampaignScreen />, {
      handle: 'ada',
      path: '/campaign',
      api: {
        me: async () => meFixture(),
        campaign: async () => campaign(c1, ['c1']),
        startMission: async () => {
          throw new ApiError(403, 'mission_locked', 'locked');
        },
      },
    });
    expect(await screen.findByTestId('campaign-chapter-c1-state')).toHaveTextContent('Complete');
    expect(within(screen.getByTestId('campaign-reward-c1')).getByText('Unlocked')).toBeInTheDocument();
    // The first open mission is the next chapter's first.
    expect(within(screen.getByTestId('campaign-briefing')).getByRole('heading', { name: 'Orchard Burn' })).toBeInTheDocument();
    await user.click(screen.getByTestId('campaign-start'));
    expect(await screen.findByTestId('campaign-error')).toHaveTextContent('still locked');
  });

  it('links from home', async () => {
    renderWithProviders(<HomeScreen />, { handle: 'ada', path: '/play', api: { me: async () => meFixture(), campaign: async () => campaign(['c1-m1']) } });
    expect(await screen.findByText(/Next: Chapter 1 · Lamp Oil Run/)).toBeInTheDocument();
    expect(screen.getByTestId('campaign-strip-go')).toHaveAttribute('href', '/campaign#c1-m2');
  });
});
