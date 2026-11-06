'use client';
// "First steps" on home, kept out of the way: a lightbulb button with how many of the five things a
// new player should do once are done (@skirm/shared FIRST_STEPS, ticked from GET /onboarding). It
// opens a small checklist with a link to where each is done; Escape or a click outside closes it.
// Shown until every item is done or the player hides it; nothing while it loads or when the api
// does not answer.
import { DEFAULT_PRACTICE } from '@skirm/engine/v2';
import { FIRST_STEPS, type FirstStepId } from '@skirm/shared';
import { Button } from '@skirm/ui';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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

function Bulb() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={o.bulbIcon}>
      <path
        d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FirstSteps({ lead }: { lead: Agent | undefined }) {
  const q = useOnboarding();
  const dismiss = useDismissChecklist();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  const data = q.data;
  if (!data?.showChecklist) return null;
  const done = new Map(data.checklist.items.map((i) => [i.id, i.done]));
  const count = data.checklist.items.filter((i) => i.done).length;
  const total = data.checklist.items.length;
  const tutorialLabel =
    data.tutorial.status === 'in_progress' ? 'Resume ▸' : data.tutorial.status === 'skipped' ? 'Play it ▸' : 'Start ▸';
  return (
    <div className={o.bulbWrap} ref={root}>
      <button
        type="button"
        className={o.bulb}
        aria-expanded={open}
        aria-controls="first-steps"
        onClick={() => setOpen((v) => !v)}
        data-testid="first-steps-open"
      >
        <Bulb />
        <span>First steps</span>
        <b className={o.bulbCount} data-testid="first-steps-count">
          {count}/{total}
        </b>
      </button>
      <aside id="first-steps" className={o.steps} hidden={!open} aria-label="First steps" data-testid="first-steps">
        <ol className={o.list}>
          {FIRST_STEPS.map((s) => {
            const ok = done.get(s.id) ?? false;
            return (
              <li key={s.id} className={o.item} data-done={ok || undefined} data-testid={`first-step-${s.id}`}>
                <span className={o.check} aria-hidden="true">
                  {ok ? '✓' : ''}
                </span>
                <span className={o.itemText}>
                  <Link href={hrefOf(s.id, lead)} className={o.itemTitle} title={s.hint} onClick={() => setOpen(false)}>
                    {s.title}
                    <span className="sk-sr-only">{ok ? ' (done)' : ' (to do)'}</span>
                  </Link>
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
          Hide for good
        </Button>
      </aside>
    </div>
  );
}
