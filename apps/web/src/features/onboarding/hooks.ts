'use client';
// Onboarding data (GET /onboarding, /onboarding/templates) and the one bit of tab state the guided
// match needs: which match this tab started as the tutorial, so the match screen shows its tips.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/queries';
import type { Onboarding, TutorialUpdate } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { useApi } from '@/lib/services';

/** Under `me`, so a match end (qk.me invalidated) refreshes the checklist too. */
export const onboardingKey = ['me', 'onboarding'] as const;
export const templatesKey = ['onboarding', 'templates'] as const;

/** GET /onboarding (signed in). Not retried: home and the match screen work without it. */
export function useOnboarding(opts: { enabled?: boolean } = {}) {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: onboardingKey,
    queryFn: () => api.onboarding(),
    enabled: status === 'signedIn' && (opts.enabled ?? true),
    staleTime: 15_000,
    retry: false,
  });
}

/** PUT /onboarding/tutorial; stores the answer, so every screen sees the new step at once. */
export function useUpdateTutorial() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TutorialUpdate) => api.updateTutorial(body),
    onSuccess: (o) => qc.setQueryData<Onboarding>(onboardingKey, o),
  });
}

export function useDismissChecklist() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.dismissChecklist(),
    onSuccess: (o) => qc.setQueryData<Onboarding>(onboardingKey, o),
  });
}

export function useSkillTemplates() {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: templatesKey,
    queryFn: () => api.skillTemplates(),
    enabled: status === 'signedIn',
    staleTime: Infinity,
    retry: false,
  });
}

/** POST /onboarding/templates/:id/copy: a new draft; refreshes the skill lists and the checklist. */
export function useCopyTemplate() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => api.copyTemplate(templateId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.skills.all });
      void qc.invalidateQueries({ queryKey: onboardingKey });
    },
  });
}

const TUTORIAL_MATCH_KEY = 'skirm.tutorial.matchId';
let memoryMatchId: string | null = null;

/** The match this tab queued as the guided match (sessionStorage, so a reload keeps the tips). */
export const tutorialMatch = {
  get(): string | null {
    try {
      return window.sessionStorage.getItem(TUTORIAL_MATCH_KEY) ?? memoryMatchId;
    } catch {
      return memoryMatchId;
    }
  },
  set(matchId: string | null): void {
    memoryMatchId = matchId;
    try {
      if (matchId) window.sessionStorage.setItem(TUTORIAL_MATCH_KEY, matchId);
      else window.sessionStorage.removeItem(TUTORIAL_MATCH_KEY);
    } catch {
      /* storage blocked: memory only */
    }
  },
};
