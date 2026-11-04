'use client';
// /tutorial: the guided first match. A short briefing (the goal, crew, roles, talk tiers, skills),
// one tip at a time, then "Start guided match" queues practice against the greedy bot on the
// tutorial board (TUTORIAL_MATCH: Copper Hollow, Easy) with the lead agent alone at Standard. The
// match screen takes over on v2_found, with the rest of the tips in its corner (TutorialCoach).
// Skippable at any point; how far the player got is stored per account (PUT /onboarding/tutorial).
import { BOT_HANDLE, DIFF_MODS, holdFor } from '@skirm/engine/v2';
import { TUTORIAL_MATCH, TUTORIAL_STEPS, tutorialStepsIn } from '@skirm/shared';
import { Button, DisplayHeading } from '@skirm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { arenaStore } from '@/features/arena/store';
import { MAPS, mapById } from '@/features/arena/world';
import { v2StoreFor } from '@/features/v2/v2Store';
import { qk, useMe } from '@/lib/api/queries';
import type { Me, Onboarding } from '@/lib/api/types';
import { useRealtimeMessage } from '@/lib/realtime/hooks';
import { routes } from '@/lib/routes';
import { useRealtime } from '@/lib/services';
import { tutorialMatch, useOnboarding, useUpdateTutorial } from './hooks';
import o from './onboarding.module.css';

const BRIEF = tutorialStepsIn('brief');
/** Errors of other screens' watches on the shared socket, not about the queue. */
const NOT_QUEUE_ERRORS = new Set(['not_found', 'too_many_subscriptions']);

function queueError(code: string): string {
  switch (code) {
    case 'in_match':
    case 'already_queued':
      return 'You are already in a match or searching for one. Finish it, then start the guided match.';
    case 'agent_busy':
      return 'Your lead agent is still in a match. Wait for it to end, then try again.';
    case 'insufficient_credits':
      return 'Not enough credits for the guided match today. It is free again when the allowance resets.';
    case 'unavailable':
      return 'Matches are paused for a moment. Try again shortly.';
    default:
      return 'Could not start the guided match. Try again in a moment.';
  }
}

export function TutorialScreen() {
  return (
    <div data-testid="screen-tutorial" className={o.brief}>
      <RequireSession>
        <TutorialData />
      </RequireSession>
    </div>
  );
}

function TutorialData() {
  const me = useMe();
  const onboarding = useOnboarding();
  if (me.data === undefined)
    return me.isError ? <ErrorCard error={me.error} onRetry={() => void me.refetch()} /> : <Skeleton rows={6} label="Loading the tutorial" />;
  if (!me.data.agents.length)
    return <EmptyState action={<ButtonLink href={routes.home()}>Back to Play</ButtonLink>}>No agents on this account yet.</EmptyState>;
  // The tutorial plays without its progress (a failing api only loses the resume point).
  if (onboarding.isPending && onboarding.fetchStatus !== 'idle') return <Skeleton rows={6} label="Loading the tutorial" />;
  return <Briefing me={me.data} progress={onboarding.data} />;
}

function Briefing({ me, progress }: { me: Me; progress: Onboarding | undefined }) {
  const rt = useRealtime();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const update = useUpdateTutorial();
  const lead = me.agents[0]!;
  const map = mapById(TUTORIAL_MATCH.mapId);
  const diff = DIFF_MODS[TUTORIAL_MATCH.difficulty];
  const hold = holdFor([{ tier: 'standard' }], false, diff.ticks);
  // Resume where the player left the briefing.
  const [i, setI] = useState(() => (progress?.tutorial.status === 'in_progress' ? Math.min(progress.tutorial.step, BRIEF.length - 1) : 0));
  const [phase, setPhase] = useState<'brief' | 'starting'>('brief');
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const cur = BRIEF[i]!;
  const last = i === BRIEF.length - 1;
  const done = progress?.tutorial.status === 'done';

  useEffect(() => {
    const idx = MAPS.findIndex((m) => m.id === TUTORIAL_MATCH.mapId);
    if (idx >= 0) arenaStore().setMap(idx);
  }, []);

  useRealtimeMessage((m) => {
    if (phaseRef.current !== 'starting') return;
    if (m.type === 'v2_found') {
      tutorialMatch.set(m.matchId);
      void qc.invalidateQueries({ queryKey: qk.me });
      router.push(routes.match(m.matchId));
    } else if (m.type === 'error' && !NOT_QUEUE_ERRORS.has(m.code)) {
      setError(queueError(m.code));
      setPhase('brief');
    }
  });

  const seen = (index: number) => update.mutate({ step: index + 1 });
  const next = () => {
    seen(cur.index);
    setI(i + 1);
  };
  const start = () => {
    seen(cur.index);
    setError(null);
    setPhase('starting');
    v2StoreFor(rt).queued = [{ agentId: lead.id, name: lead.name, tier: 'standard' }];
    rt.send({
      type: 'v2_queue',
      ranked: false,
      crew: [{ agentId: lead.id, tier: 'standard' }],
      mapId: TUTORIAL_MATCH.mapId,
      difficulty: TUTORIAL_MATCH.difficulty,
      opponent: 'bot',
    });
  };
  const skip = () =>
    update.mutate(
      { status: 'skipped' },
      {
        onSuccess: () => {
          toast.show({ tone: 'neutral', title: 'Tutorial skipped', message: 'It stays on your first steps checklist on home.' });
          router.push(routes.home());
        },
        onError: (e) => toast.error(e),
      },
    );

  return (
    <>
      <header>
        <span className="sk-kick">Guided first match</span>
        <DisplayHeading level={1}>Tutorial</DisplayHeading>
      </header>
      {done ? (
        <div className="app-banner" role="status" data-testid="tutorial-done">
          You finished the tutorial already. Play it again any time.
        </div>
      ) : null}
      <section className={o.briefCard} aria-labelledby="tutorial-step-title" data-testid="tutorial-step">
        <div className={o.dots} aria-hidden="true">
          {TUTORIAL_STEPS.map((s, k) => (
            <span key={s.id} className={o.dot} data-on={k <= cur.index || undefined} />
          ))}
        </div>
        <span className="sk-kick" data-testid="tutorial-step-count">
          Tip {cur.index + 1} of {TUTORIAL_STEPS.length}
        </span>
        <h2 id="tutorial-step-title" className={o.briefTitle}>
          {cur.step.title}
        </h2>
        <p className={o.briefBody}>{cur.step.body}</p>
        {last ? (
          <dl className={o.facts} data-testid="tutorial-facts">
            <dt>Map</dt>
            <dd>
              {map ? `${map.code} ${map.name}` : TUTORIAL_MATCH.mapId} · {diff.name}
            </dd>
            <dt>Rival</dt>
            <dd>{BOT_HANDLE}: the offline greedy brain, no Elo at stake</dd>
            <dt>Your crew</dt>
            <dd>{lead.name}, talk Standard</dd>
            <dt>Credits</dt>
            <dd>None on the offline brain; at most {hold} from your free allowance otherwise</dd>
          </dl>
        ) : null}
        {error ? (
          <div className="app-banner is-critical" role="alert" data-testid="tutorial-error">
            {error}
          </div>
        ) : null}
        <div className={o.row}>
          {i > 0 ? (
            <Button variant="ghost" onClick={() => setI(i - 1)} disabled={phase === 'starting'} data-testid="tutorial-back">
              Back
            </Button>
          ) : null}
          {last ? (
            <Button variant="primary" onClick={start} loading={phase === 'starting'} disabled={phase === 'starting'} data-testid="tutorial-start">
              Start guided match ▸
            </Button>
          ) : (
            <Button variant="primary" onClick={next} data-testid="tutorial-next">
              Next
            </Button>
          )}
          <span className={o.spacer} />
          {!done ? (
            <Button variant="ghost" onClick={skip} disabled={update.isPending || phase === 'starting'} data-testid="tutorial-skip">
              Skip tutorial
            </Button>
          ) : null}
        </div>
      </section>
    </>
  );
}
