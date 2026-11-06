import { act, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_PRACTICE, PRACTICE_MAPS } from '@skirm/engine/v2';
import { TUTORIAL_MATCH, TUTORIAL_STEPS, tutorialStepsIn } from '@skirm/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeScreen } from '@/features/play/HomeScreen';
import { MySkillsScreen } from '@/features/skills/MySkillsScreen';
import type { Onboarding, SkillTemplateView, TutorialUpdate } from '@/lib/api/types';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { testRouter } from '@/test/router';
import { tutorialMatch } from './hooks';
import { TutorialCoach } from './TutorialCoach';
import { TutorialScreen } from './TutorialScreen';

const BRIEF = tutorialStepsIn('brief').length;

function onboarding(o: { status?: Onboarding['tutorial']['status']; step?: number; done?: Partial<Record<string, boolean>>; dismissed?: boolean } = {}): Onboarding {
  const ids = ['tutorial', 'practice', 'skill', 'equip', 'pvp'] as const;
  const items = ids.map((id) => ({ id, done: o.done?.[id] ?? false }));
  const allDone = items.every((i) => i.done);
  return {
    tutorial: {
      status: o.status ?? 'new',
      step: o.step ?? 0,
      steps: TUTORIAL_STEPS.length,
      match: { ...TUTORIAL_MATCH },
      completedAt: null,
      skippedAt: null,
    },
    checklist: { items, done: allDone, dismissed: !!o.dismissed },
    showChecklist: !allDone && !o.dismissed,
  };
}

const MATCH = 'mat_01JB7Z3K9QX4M2T8V6N5R1C0DE';

afterEach(() => tutorialMatch.set(null));

describe('the tutorial board', () => {
  it('is the default practice board, one the greedy bot plays cleanly', () => {
    expect(TUTORIAL_MATCH.mapId).toBe(DEFAULT_PRACTICE.mapId);
    expect(TUTORIAL_MATCH.difficulty).toBe(DEFAULT_PRACTICE.difficulty);
    expect(PRACTICE_MAPS).toContain(TUTORIAL_MATCH.mapId);
  });
});

describe('First steps on home', () => {
  it('keeps the checklist behind a lightbulb, with what is done and links to each step', async () => {
    const { user } = renderWithProviders(<HomeScreen />, {
      handle: 'ada',
      path: '/play',
      api: { me: async () => meFixture(), onboarding: async () => onboarding({ status: 'in_progress', step: 2, done: { practice: true } }) },
    });
    const bulb = await screen.findByTestId('first-steps-open');
    expect(screen.getByTestId('first-steps-count')).toHaveTextContent('1/5');
    expect(screen.getByTestId('first-steps')).not.toBeVisible();
    await user.click(bulb);
    expect(bulb).toHaveAttribute('aria-expanded', 'true');
    const card = screen.getByTestId('first-steps');
    expect(card).toBeVisible();
    expect(within(card).getByTestId('first-step-practice')).toHaveAttribute('data-done', 'true');
    expect(within(card).getByTestId('first-step-skill')).not.toHaveAttribute('data-done');
    expect(within(card).getByTestId('first-steps-tutorial')).toHaveAttribute('href', '/tutorial');
    expect(within(card).getByTestId('first-steps-tutorial')).toHaveTextContent('Resume');
    expect(within(card).getByRole('link', { name: /Write a skill/ })).toHaveAttribute('href', '/skills');
    // The deck still renders under it.
    expect(screen.getByTestId('s02-deck')).toBeInTheDocument();
    // Escape closes it.
    await user.keyboard('{Escape}');
    expect(card).not.toBeVisible();
  });

  it('hides once every step is done or it was dismissed, and when the api fails', async () => {
    const all = { tutorial: true, practice: true, skill: true, equip: true, pvp: true };
    const { unmount } = renderWithProviders(<HomeScreen />, { handle: 'ada', path: '/play', api: { me: async () => meFixture(), onboarding: async () => onboarding({ done: all }) } });
    await screen.findByTestId('s02-deck');
    await waitFor(() => expect(screen.queryByTestId('first-steps')).not.toBeInTheDocument());
    unmount();
    renderWithProviders(<HomeScreen />, { handle: 'ada', path: '/play', api: { me: async () => meFixture() } });
    await screen.findByTestId('s02-deck');
    expect(screen.queryByTestId('first-steps')).not.toBeInTheDocument();
  });

  it('dismisses the checklist', async () => {
    const { user, api } = renderWithProviders(<HomeScreen />, {
      handle: 'ada',
      path: '/play',
      api: { me: async () => meFixture(), onboarding: async () => onboarding(), dismissChecklist: async () => onboarding({ dismissed: true }) },
    });
    await user.click(await screen.findByTestId('first-steps-open'));
    await user.click(screen.getByTestId('first-steps-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('first-steps')).not.toBeInTheDocument());
    expect(api.dismissChecklist).toHaveBeenCalledTimes(1);
  });
});

describe('Tutorial briefing (/tutorial)', () => {
  const api = (o: Parameters<typeof onboarding>[0] = {}) => ({
    me: async () => meFixture(),
    onboarding: async () => onboarding(o),
    updateTutorial: async (b: TutorialUpdate) => onboarding({ status: b.status === 'skipped' ? 'skipped' : 'in_progress', step: b.step ?? 0 }),
  });

  it('walks the briefing tips, records each one, then queues practice vs the bot on the tutorial board', async () => {
    const { user, api: fake, realtime } = renderWithProviders(<TutorialScreen />, { handle: 'ada', path: '/tutorial', api: api() });
    expect(await screen.findByRole('heading', { name: 'The goal' })).toBeInTheDocument();
    for (let k = 1; k < BRIEF; k++) {
      await user.click(screen.getByTestId('tutorial-next'));
      expect(screen.getByTestId('tutorial-step-count')).toHaveTextContent(`Tip ${k + 1} of ${TUTORIAL_STEPS.length}`);
    }
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.getByTestId('tutorial-facts')).toHaveTextContent('Copper Hollow · Easy');
    expect(screen.getByTestId('tutorial-facts')).toHaveTextContent('Greedy bot');
    expect(fake.updateTutorial).toHaveBeenLastCalledWith({ step: BRIEF - 1 });

    await user.click(screen.getByTestId('tutorial-start'));
    expect(realtime.sentOf('v2_queue')).toEqual([
      { type: 'v2_queue', ranked: false, crew: [{ agentId: meFixture().agents[0]!.id, tier: 'standard' }], mapId: 'copper-hollow', difficulty: 'easy', opponent: 'bot' },
    ]);
    act(() => realtime.emit({ type: 'v2_found', matchId: MATCH, team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, difficulty: 'easy', practice: true, free: true, rivalHandle: 'Greedy bot' }));
    expect(testRouter.push).toHaveBeenCalledWith(`/matches/${MATCH}`);
    expect(tutorialMatch.get()).toBe(MATCH);
  });

  it('resumes where the player left the briefing', async () => {
    renderWithProviders(<TutorialScreen />, { handle: 'ada', path: '/tutorial', api: api({ status: 'in_progress', step: 3 }) });
    expect(await screen.findByRole('heading', { name: 'Talk tiers' })).toBeInTheDocument();
  });

  it('says why the match did not start', async () => {
    const { user, realtime } = renderWithProviders(<TutorialScreen />, { handle: 'ada', path: '/tutorial', api: api({ status: 'in_progress', step: BRIEF }) });
    await user.click(await screen.findByTestId('tutorial-start'));
    act(() => realtime.emit({ type: 'error', code: 'in_match', message: 'already in a match' }));
    expect(await screen.findByTestId('tutorial-error')).toHaveTextContent('already in a match');
    expect(screen.getByTestId('tutorial-start')).not.toBeDisabled();
  });

  it('skips the tutorial and goes home', async () => {
    const { user, api: fake } = renderWithProviders(<TutorialScreen />, { handle: 'ada', path: '/tutorial', api: api() });
    await user.click(await screen.findByTestId('tutorial-skip'));
    await waitFor(() => expect(testRouter.push).toHaveBeenCalledWith('/play'));
    expect(fake.updateTutorial).toHaveBeenCalledWith({ status: 'skipped' });
  });
});

describe('Tutorial coach over the guided match', () => {
  const found = { type: 'v2_found', matchId: MATCH, team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, difficulty: 'easy', practice: true, free: true, rivalHandle: 'Greedy bot' } as const;
  const api = { updateTutorial: async (b: TutorialUpdate) => onboarding({ status: b.status === 'done' ? 'done' : b.status === 'skipped' ? 'skipped' : 'in_progress', step: b.step ?? 0 }) };

  it('shows nothing on a match this tab did not start as the tutorial', async () => {
    const { realtime } = renderWithProviders(<TutorialCoach matchId={MATCH} />, { handle: 'ada', api });
    act(() => realtime.emit(found));
    expect(screen.queryByTestId('tutorial-coach')).not.toBeInTheDocument();
  });

  it('shows the lock-in tip, records it as seen and can skip the rest', async () => {
    tutorialMatch.set(MATCH);
    const { realtime, user, api: fake } = renderWithProviders(<TutorialCoach matchId={MATCH} />, { handle: 'ada', api });
    act(() => realtime.emit(found));
    const coach = await screen.findByTestId('tutorial-coach');
    expect(coach).toHaveTextContent('Accept and lock in');
    const lockin = tutorialStepsIn('lockin')[0]!;
    expect(within(coach).getByTestId('tutorial-coach-step')).toHaveTextContent(`Tip ${lockin.index + 1}/${TUTORIAL_STEPS.length}`);
    await user.click(within(coach).getByTestId('tutorial-coach-next'));
    expect(fake.updateTutorial).toHaveBeenCalledWith({ step: lockin.index + 1 });
    expect(screen.queryByTestId('tutorial-coach')).not.toBeInTheDocument();
  });

  it('skips from the coach and forgets the match', async () => {
    tutorialMatch.set(MATCH);
    const { realtime, user, api: fake } = renderWithProviders(<TutorialCoach matchId={MATCH} />, { handle: 'ada', api });
    act(() => realtime.emit(found));
    await user.click(await screen.findByTestId('tutorial-coach-skip'));
    await waitFor(() => expect(screen.queryByTestId('tutorial-coach')).not.toBeInTheDocument());
    expect(fake.updateTutorial).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
    expect(tutorialMatch.get()).toBeNull();
  });

  it('finishes the tutorial on the debrief', async () => {
    tutorialMatch.set(MATCH);
    const { user, api: fake } = renderWithProviders(<TutorialCoach matchId={MATCH} ended />, { handle: 'ada', api });
    const coach = await screen.findByTestId('tutorial-coach');
    expect(coach).toHaveTextContent('Read the debrief');
    await user.click(within(coach).getByTestId('tutorial-coach-finish'));
    await waitFor(() => expect(fake.updateTutorial).toHaveBeenCalledWith({ step: TUTORIAL_STEPS.length, status: 'done' }));
    await waitFor(() => expect(screen.queryByTestId('tutorial-coach')).not.toBeInTheDocument());
  });
});

describe('Starter templates on My skills', () => {
  const TPL: SkillTemplateView = {
    id: 'flood-plug',
    name: 'Flood Plug',
    summary: 'Seals the gap the water reaches first.',
    bestFor: 'A Builder (needs place_block)',
    lesson: 'Read the hazard.',
    prompt: 'Find every spreads+liquid tile.',
    reflexes: 'Place a block.',
    requires_actions: ['place_block'],
    handles_tags: ['spreads', 'liquid'],
  };

  it('copies a template into a draft and opens it in the editor', async () => {
    const { user, api } = renderWithProviders(<MySkillsScreen />, {
      handle: 'ada',
      path: '/skills',
      api: {
        skills: async () => [],
        skillTemplates: async () => [TPL],
        copyTemplate: async () => ({ id: 'skl_new', name: 'Flood Plug' }) as never,
      },
    });
    const card = await screen.findByTestId('template-flood-plug');
    expect(card).toHaveTextContent('A Builder (needs place_block)');
    await user.click(within(card).getByTestId('template-read-flood-plug'));
    expect(screen.getByTestId('template-text-flood-plug')).toHaveTextContent('Find every spreads+liquid tile.');
    await user.click(within(card).getByTestId('template-copy-flood-plug'));
    await waitFor(() => expect(testRouter.push).toHaveBeenCalledWith('/skills/skl_new/edit'));
    expect(api.copyTemplate).toHaveBeenCalledWith('flood-plug');
  });
});
