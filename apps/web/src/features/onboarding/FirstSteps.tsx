'use client';
// "First steps" on home: five things a new player should do once (@skirm/shared FIRST_STEPS), each
// ticked from the api (GET /onboarding), with a link to where it is done. Shown until every item is
// done or the player dismisses it; nothing at all while it loads or when the api does not answer.
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

export function FirstSteps({ lead }: { lead: Agent | undefined }) {
  const q = useOnboarding();
  const dismiss = useDismissChecklist();
  const toast = useToast();
  const data = q.data;
  if (!data?.showChecklist) return null;
  const done = new Map(data.checklist.items.map((i) => [i.id, i.done]));
  const count = data.checklist.items.filter((i) => i.done).length;
  const tutorialLabel =
    data.tutorial.status === 'in_progress' ? 'Resume ▸' : data.tutorial.status === 'skipped' ? 'Play it ▸' : 'Start ▸';
  return (
    <aside className={o.steps} aria-labelledby="first-steps-title" data-testid="first-steps">
      <header className={o.stepsHead}>
        <div>
          <span className="sk-kick">New here</span>
          <h2 id="first-steps-title" className={o.stepsTitle}>
            First steps
          </h2>
        </div>
        <span className={o.count} data-testid="first-steps-count">
          {count}/{data.checklist.items.length}
        </span>
      </header>
      <ol className={o.list}>
        {FIRST_STEPS.map((s) => {
          const ok = done.get(s.id) ?? false;
          return (
            <li key={s.id} className={o.item} data-done={ok || undefined} data-testid={`first-step-${s.id}`}>
              <span className={o.check} aria-hidden="true">
                {ok ? '✓' : ''}
              </span>
              <span className={o.itemText}>
                <Link href={hrefOf(s.id, lead)} className={o.itemTitle}>
                  {s.title}
                  <span className="sk-sr-only">{ok ? ' (done)' : ' (to do)'}</span>
                </Link>
                <span className={o.itemHint}>{s.hint}</span>
              </span>
              {s.id === 'tutorial' && !ok ? (
                <Link href={routes.tutorial()} className={o.go} data-testid="first-steps-tutorial">
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
        Hide the checklist
      </Button>
    </aside>
  );
}
