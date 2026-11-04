'use client';
// S16 Achievements card: permanent milestones from GET /achievements (progress, unlock date, the
// cosmetic some of them grant) and Mint badge, which mints an unlocked one as a soulbound badge on
// the `badges` contract (POST /achievements/:id/badge). Without a NEAR signer the api records it as
// `local`; with one it needs a linked NEAR account (422 near_account_required).
import { Badge, Button, Meter } from '@skirm/ui';
import { useToast } from '@/components/toast/ToastProvider';
import { useAchievements, useMintBadge } from '@/lib/api/queries';
import type { AchievementView } from '@/lib/api/types';
import s from './account.module.css';
import a from './achievements.module.css';
import { formatUtcDate } from './format';

const BADGE_LABEL = { pending: 'Minting…', minted: 'Badge on NEAR', local: 'Badge (local)', failed: 'Mint failed' } as const;

export function AchievementsCard() {
  const q = useAchievements();
  const mint = useMintBadge();
  const toast = useToast();
  const list = q.data?.achievements;
  const done = list?.filter((x) => x.unlocked).length ?? 0;

  const onMint = (x: AchievementView) =>
    mint.mutate(x.id, {
      onSuccess: (r) =>
        toast.show({
          tone: 'good',
          title: `${x.title} badge minted`,
          message: r.badge?.status === 'local' ? 'Recorded locally: no NEAR signer on this server' : 'Soulbound to your NEAR account',
        }),
      onError: (err) => toast.error(err),
    });

  return (
    <section aria-labelledby="s16-achievements" className={s.card} data-testid="s16-achievements">
      <div className={s.headRow}>
        <h2 id="s16-achievements" className={s.h2Display}>
          Achievements
        </h2>
        {list ? (
          <span className={s.note}>
            {done} of {list.length} · best streak {q.data!.streak.best}
          </span>
        ) : null}
      </div>
      {!list ? (
        q.isError ? (
          <p className={s.note}>
            Achievements did not load.{' '}
            <Button size="sm" variant="ghost" onClick={() => void q.refetch()}>
              Retry
            </Button>
          </p>
        ) : (
          <p className={s.note}>Loading achievements…</p>
        )
      ) : (
        <ul className={a.grid}>
          {list.map((x) => (
            <li key={x.id} className={x.unlocked ? `${a.item} ${a.unlocked}` : a.item} data-testid={`achievement-${x.id}`}>
              <div className={a.top}>
                <span className={a.title}>{x.title}</span>
                {x.unlocked ? <Badge tone="good">Unlocked</Badge> : null}
              </div>
              <span className={s.note}>{x.detail}</span>
              {x.unlocked ? (
                <span className={a.meta}>{x.unlockedAt ? `Unlocked ${formatUtcDate(x.unlockedAt)}` : 'Unlocked'}</span>
              ) : (
                <Meter value={x.progress} max={x.target} label={`${x.title}: ${x.progress} of ${x.target}`} />
              )}
              {x.cosmetic ? <span className={a.meta}>Reward: {x.cosmetic.name}</span> : null}
              {x.unlocked ? (
                x.badge && x.badge.status !== 'failed' ? (
                  <span className={a.badge} data-testid={`achievement-${x.id}-badge`}>
                    {BADGE_LABEL[x.badge.status]}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    className={a.mint}
                    data-testid={`achievement-${x.id}-mint`}
                    loading={mint.isPending && mint.variables === x.id}
                    onClick={() => onMint(x)}
                  >
                    {x.badge?.status === 'failed' ? 'Retry mint' : 'Mint badge'}
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className={s.note}>Badges are soulbound: they stay on the NEAR account they are minted to and can never be sold or moved.</p>
    </section>
  );
}
