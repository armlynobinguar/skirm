'use client';
// S02 Home quests panel: today's and this week's quests (GET /quests), the play streak, and Claim,
// which refills free credits spent today (POST /quests/:id/claim; 409 allowance_full when there is
// nothing to refill yet). Progress comes from match results, so it moves when a match ends.
// It stays quiet when the quests do not load: the Command deck is the screen's job. It sits in the
// home hub (HomeHub, the lightbulb), which drops the card chrome (`bare`).
import { Button, Meter } from '@skirm/ui';
import { useToast } from '@/components/toast/ToastProvider';
import { isApiError } from '@/lib/api/errors';
import { useClaimQuest, useQuests } from '@/lib/api/queries';
import type { QuestView } from '@/lib/api/types';
import s from './quests.module.css';

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/** Quests finished and not yet claimed (0 while they load): the hub's badge counts them. */
export function useClaimableQuests(): number {
  const board = useQuests().data;
  if (!board) return 0;
  return [...board.daily.quests, ...board.weekly.quests].filter((q) => q.claimable && !q.claimed).length;
}

export function QuestsPanel({ bare = false }: { bare?: boolean }) {
  const quests = useQuests();
  const claim = useClaimQuest();
  const toast = useToast();
  const board = quests.data;
  if (!board) return null;

  const onClaim = (q: QuestView) =>
    claim.mutate(q.id, {
      onSuccess: (r) =>
        toast.show({
          tone: 'good',
          title: `${q.title}: done`,
          message: `+${r.credited} free credits · ${r.allowanceLeft} free left today`,
        }),
      onError: (err) =>
        isApiError(err) && err.code === 'allowance_full'
          ? toast.show({
              tone: 'neutral',
              title: 'Your free credits are full',
              message: 'The reward refills free credits you spend today. Play a match, then claim it.',
            })
          : toast.error(err),
    });

  const list = (title: string, items: QuestView[], testid: string) => (
    <div className={s.group} data-testid={testid}>
      <h3 className={s.groupTitle}>{title}</h3>
      <ul className={s.list}>
        {items.map((q) => (
          <li key={q.id} className={s.quest} data-testid={`quest-${q.id}`}>
            <div className={s.questTop}>
              <span className={s.questTitle}>{q.title}</span>
              <span className={s.reward}>+{q.rewardCredits} free</span>
            </div>
            <Meter value={q.progress} max={q.target} tone={q.done ? 'good' : null} label={`${q.title}: ${q.progress} of ${q.target}`} />
            <div className={s.questFoot}>
              <span className={s.count}>
                {q.progress} / {q.target}
              </span>
              {q.claimed ? (
                <span className={s.claimed} data-testid={`quest-${q.id}-claimed`}>
                  Claimed{q.credited !== null ? ` · +${q.credited}` : ''}
                </span>
              ) : q.claimable ? (
                <Button
                  size="sm"
                  variant="primary"
                  data-testid={`quest-${q.id}-claim`}
                  loading={claim.isPending && claim.variables === q.id}
                  onClick={() => onClaim(q)}
                >
                  Claim
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  const { streak } = board;
  return (
    <section aria-labelledby="s02-quests" className={bare ? s.bare : s.panel} data-testid="s02-quests">
      <div className={s.head}>
        <h2 id="s02-quests" className={s.title}>
          Quests
        </h2>
        <span className={s.streak} data-testid="s02-streak">
          {streak.current > 0
            ? `Streak ${days(streak.current)}${streak.playedToday ? '' : ' · play today to keep it'}`
            : 'Play a match to start a streak'}
          {streak.best > streak.current ? ` · best ${days(streak.best)}` : ''}
        </span>
      </div>
      <div className={s.groups}>
        {list('Today', board.daily.quests, 's02-quests-daily')}
        {list('This week', board.weekly.quests, 's02-quests-weekly')}
      </div>
      <p className={s.note}>Rewards refill free credits you spent today, up to the daily allowance. Resets 00:00 UTC; weekly quests on Monday.</p>
    </section>
  );
}
