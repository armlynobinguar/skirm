'use client';
// The atlas's Community tab (/maps?tab=community): published community maps, newest or most
// played, each with its thumbnail, author, plays and likes, and Practice / Unranked buttons that open
// the crew screen on it (community maps never play ranked). Signed-in players also see their own
// drafts and a link to the map editor.
import { Button } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MiniMap } from '@/features/arena/MiniMap';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useSession } from '@/lib/auth/session';
import type { CommunityMap } from '@/lib/api/communityMapTypes';
import { qk } from '@/lib/api/queries';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { communityToV2Map } from './convert';
import styles from './maps.module.css';

export function CommunityMaps() {
  const api = useApi();
  const session = useSession();
  const [sort, setSort] = useState<'new' | 'popular'>('new');
  const list = useQuery({ queryKey: qk.communityMaps.list(sort), queryFn: () => api.communityMaps(sort) });
  const signedIn = session.status === 'signedIn';
  const mine = useQuery({ queryKey: qk.communityMaps.mine, queryFn: () => api.myCommunityMaps(), enabled: signedIn, retry: false });
  const drafts = (mine.data?.maps ?? []).filter((m) => m.status === 'draft');

  return (
    <section className={styles.community} aria-labelledby="community-h" data-testid="atlas-community">
      <header className={styles.head}>
        <div>
          <span className="sk-kick">Made by players · practice and unranked only</span>
          <h2 id="community-h" className="sk-disp">
            Community maps
          </h2>
        </div>
        <div className={styles.tools}>
          <div className={styles.seg} role="group" aria-label="Sort">
            {(['new', 'popular'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)} data-testid={`community-sort-${s}`}>
                {s === 'new' ? 'Newest' : 'Popular'}
              </button>
            ))}
          </div>
          <Link href={routes.mapEditor()} className="sk-btn sk-btn-primary" data-testid="community-new">
            Make a map
          </Link>
        </div>
      </header>

      {signedIn && drafts.length ? (
        <div className={styles.drafts} data-testid="community-drafts">
          <span className="sk-kick">Your drafts</span>
          {drafts.map((d) => (
            <Link key={d.id} href={routes.mapEditor(d.id)} className={styles.draft}>
              {d.name}
            </Link>
          ))}
        </div>
      ) : null}

      {list.data === undefined ? (
        list.isError ? (
          <ErrorCard error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Skeleton rows={4} label="Loading community maps" />
        )
      ) : !list.data.maps.length ? (
        <EmptyState action={<Link href={routes.mapEditor()}>Open the map editor</Link>}>No community maps yet. Be the first to publish one.</EmptyState>
      ) : (
        <div className={styles.grid}>
          {list.data.maps.map((m) => (
            <CommunityCard key={m.id} map={m} canLike={signedIn} />
          ))}
        </div>
      )}
    </section>
  );
}

function CommunityCard({ map: m, canLike }: { map: CommunityMap; canLike: boolean }) {
  const api = useApi();
  const qc = useQueryClient();
  const look = useMemo(() => communityToV2Map(m.map, m.theme), [m.map, m.theme]);
  const like = useMutation({
    mutationFn: (on: boolean) => api.likeCommunityMap(m.id, on),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.communityMaps.all }),
  });
  const w = m.map.rows[0]?.length ?? 0;
  return (
    <article className={styles.card} data-testid={`community-map-${m.id}`}>
      <div className={styles.art}>
        <MiniMap map={look} className={styles.mini} />
      </div>
      <div className={styles.body}>
        <b>{m.name}</b>
        <small>
          by {m.author} · {w}×{m.map.rows.length} · difficulty {m.map.difficulty}
        </small>
        <small>
          {m.plays} play{m.plays === 1 ? '' : 's'} · {m.likes} like{m.likes === 1 ? '' : 's'}
        </small>
        {m.map.blurb ? <p>{m.map.blurb}</p> : null}
        <div className={styles.actions}>
          <Link href={routes.practice({ mapId: m.id, difficulty: 'easy' })} className="sk-btn sk-btn-secondary sk-btn-sm" data-testid={`community-practice-${m.id}`}>
            Practice
          </Link>
          <Link href={routes.crew(m.id, 'normal')} className="sk-btn sk-btn-ghost sk-btn-sm">
            Unranked
          </Link>
          {canLike ? (
            <Button size="sm" variant="ghost" aria-pressed={!!m.liked} disabled={like.isPending} onClick={() => like.mutate(!m.liked)} data-testid={`community-like-${m.id}`}>
              {m.liked ? 'Liked' : 'Like'}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
