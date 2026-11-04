'use client';
// The tips over the guided match (@skirm/shared TUTORIAL_STEPS): a small card in the corner of the
// match screen and the result screen, showing the tips of the phase the match is in (accept and
// lock-in, live, the debrief) one at a time. Only on the match this tab queued from /tutorial;
// every other match, and every spectator, sees nothing. Next records the tip as seen; Skip ends the
// tutorial; the debrief tip finishes it.
import { TUTORIAL_STEPS, tutorialStepsIn, type TutorialPhase } from '@skirm/shared';
import { Button } from '@skirm/ui';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { useToast } from '@/components/toast/ToastProvider';
import { useV2Match, type V2Phase } from '@/features/v2/v2Store';
import { routes } from '@/lib/routes';
import { tutorialMatch, useUpdateTutorial } from './hooks';
import o from './onboarding.module.css';

const PHASE_OF: Record<V2Phase, TutorialPhase> = { found: 'lockin', lockin: 'lockin', live: 'live', ended: 'ended' };

export interface TutorialCoachProps {
  matchId: string;
  /** The result screen: the debrief tips, whatever this tab's store holds. */
  ended?: boolean;
}

export function TutorialCoach({ matchId, ended }: TutorialCoachProps) {
  const view = useV2Match(matchId);
  // Read after mount: sessionStorage is not there on the server render.
  const [mine, setMine] = useState(false);
  useEffect(() => setMine(tutorialMatch.get() === matchId), [matchId]);
  const phase: TutorialPhase | null = ended ? 'ended' : view && !view.watch ? PHASE_OF[view.phase] : null;
  if (!mine || !phase) return null;
  return <Coach key={phase} phase={phase} onClose={() => setMine(false)} />;
}

function Coach({ phase, onClose }: { phase: TutorialPhase; onClose: () => void }) {
  const steps = tutorialStepsIn(phase);
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(false);
  const update = useUpdateTutorial();
  const toast = useToast();
  const cur = steps[i];
  if (hidden || !cur) return null;
  const last = i === steps.length - 1;
  const finishing = phase === 'ended' && last;

  const seen = (index: number) => update.mutate({ step: index + 1 });
  const next = () => {
    seen(cur.index);
    if (last) setHidden(true);
    else setI(i + 1);
  };
  const end = (status: 'done' | 'skipped') =>
    update.mutate(
      { step: cur.index + 1, status },
      {
        onSuccess: () => {
          tutorialMatch.set(null);
          onClose();
          if (status === 'done') toast.show({ tone: 'good', title: 'Tutorial done', message: 'Next: copy a starter skill on Skills.' });
        },
        onError: (e) => toast.error(e),
      },
    );

  return (
    <aside className={o.coach} role="dialog" aria-modal="false" aria-labelledby="tutorial-coach-title" data-testid="tutorial-coach">
      <div className={o.coachHead}>
        <h2 id="tutorial-coach-title" className={o.coachTitle}>
          {cur.step.title}
        </h2>
        <span className={o.coachStep} data-testid="tutorial-coach-step">
          Tip {cur.index + 1}/{TUTORIAL_STEPS.length}
        </span>
      </div>
      <p className={o.coachBody}>{cur.step.body}</p>
      <div className={o.row}>
        {finishing ? (
          <>
            <Button variant="primary" size="sm" onClick={() => end('done')} disabled={update.isPending} data-testid="tutorial-coach-finish">
              Finish tutorial
            </Button>
            <ButtonLink href={routes.skills()} size="sm" variant="ghost" onClick={() => end('done')}>
              Starter skills
            </ButtonLink>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={next} data-testid="tutorial-coach-next">
              {last ? 'Got it' : 'Next'}
            </Button>
            <span className={o.spacer} />
            <Button variant="ghost" size="sm" onClick={() => end('skipped')} disabled={update.isPending} data-testid="tutorial-coach-skip">
              Skip tutorial
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}
