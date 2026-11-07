'use client';
// "First steps": the five things a new player should do once (@skirm/shared FIRST_STEPS, ticked
// from GET /onboarding), each a link to where it is done. Lives in the home hub (the lightbulb,
// features/play/HomeHub). Shown until every item is done or the player hides it; nothing while it
// loads or when the api does not answer.
import { DEFAULT_PRACTICE } from '@skirm/engine/v2';
import { FIRST_STEPS, type FirstStepId } from '@skirm/shared';
import { Button } from '@skirm/ui';
import Link from 'next/link';
import type { Agent } from '@/lib/api/types';
import { routes } from '@/lib/routes';
import { useToast } from '@/components/toast/ToastProvider';
import { useDismissChecklist, useOnboarding } from './hooks';
import o from './onboarding.module.css';

function hrefOf(id: FirstStepId, lead: Agent | undefined): string {
  switch (id) {
    case 'tutorial':
      return routes.tutorial();
    case 'practice':
      return routes.practice(DEFAULT_PRACTICE);
    case 'skill':
      return routes.skills();
    case 'equip':
      return lead ? routes.agent(lead.id) : routes.account();
    case 'pvp':
      return routes.atlas();
  }
}

/** How many first steps are left, or 0 when the checklist is hidden, done or not loaded. */
export function useFirstStepsLeft(): number {
  const data = useOnboarding().data;
  if (!data?.showChecklist) return 0;
  return data.checklist.items.filter((i) => !i.done).length;
}

export function FirstSteps({ lead, onNavigate }: { lead: Agent | undefined; onNavigate?: () => void }) {
  const q = useOnboarding();
  const dismiss = useDismissChecklist();
  const toast = useToast();
  const data = q.data;
  if (!data?.showChecklist) return null;
  const done = new Map(data.checklist.items.map((i) => [i.id, i.done]));
  const count = data.checklist.items.filter((i) => i.done).length;
  const total = data.checklist.items.length;
  const tutorialLabel =
    data.tutorial.status === 'in_progress' ? 'Resume ▸' : data.tutorial.status === 'skipped' ? 'Play it ▸' : 'Start ▸';
  return (
    <section className={o.hubSteps} aria-labelledby="first-steps-title" data-testid="first-steps">
      <div className={o.stepsHead}>
        <h3 id="first-steps-title" className={o.hubTitle}>
          First steps
        </h3>
        <b className={o.bulbCount} data-testid="first-steps-count">
          {count}/{total}
        </b>
      </div>
      <ol className={o.list}>
        {FIRST_STEPS.map((s) => {
          const ok = done.get(s.id) ?? false;
          return (
            <li key={s.id} className={o.item} data-done={ok || undefined} data-testid={`first-step-${s.id}`}>
              <span className={o.check} aria-hidden="true">
                {ok ? '✓' : ''}
              </span>
              <span className={o.itemText}>
                <Link href={hrefOf(s.id, lead)} className={o.itemTitle} title={s.hint} onClick={onNavigate}>
                  {s.title}
                  <span className="sk-sr-only">{ok ? ' (done)' : ' (to do)'}</span>
                </Link>
              </span>
              {s.id === 'tutorial' && !ok ? (
                <Link href={routes.tutorial()} className={o.go} data-testid="first-steps-tutorial" onClick={onNavigate}>
                  {tutorialLabel}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => dismiss.mutate(undefined, { onError: (e) => toast.error(e) })}
        disabled={dismiss.isPending}
        data-testid="first-steps-dismiss"
      >
        Hide for good
      </Button>
    </section>
  );
}
