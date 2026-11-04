'use client';
// /replays/[shareId]: a replay a player shared (GET /replays/:shareId). Anyone can open it, signed in
// or not. A cover first (the result, who shared it, the highlight moments with the caster's lines),
// then the playback of the whole board (or of the clip the link was made for) at ¼×–4× with jump
// buttons. Only the watch view is ever sent: no crew's plans, inner voice or orders.
// The frames of a match are kept 6 h, so an older link shows the cover without playback.
import { mapV2 } from '@skirm/engine/v2';
import { Button } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { arenaStore } from '@/features/arena/store';
import { MAPS, mapById } from '@/features/arena/world';
import { qk } from '@/lib/api/queries';
import type { ReplayHighlight } from '@/lib/api/types';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { Replay } from '../v2/hud/Replay';
import { replayView } from '../v2/v2Store';
import { HighlightList, tickClock } from './Highlights';
import r from './replays.module.css';
import { sharedSummary } from './summary';

export function SharedReplayScreen({ shareId }: { shareId: string }) {
  const api = useApi();
  const q = useQuery({ queryKey: qk.matches.shared(shareId), queryFn: () => api.sharedReplay(shareId), retry: false, staleTime: 5 * 60_000 });
  const [play, setPlay] = useState<{ tick?: number } | null>(null);
  const d = q.data;
  const mapId = d?.match.mapId;
  useEffect(() => {
    const idx = mapId ? MAPS.findIndex((m) => m.id === mapId) : -1;
    if (idx >= 0) arenaStore().setMap(idx);
  }, [mapId]);
  const view = useMemo(() => {
    if (!d?.frames?.length) return null;
    const base = replayView(d.match.id, d.frames);
    return { ...base, ranked: d.match.ranked, practice: !!(d.match as { practice?: boolean }).practice, difficulty: d.match.difficulty };
  }, [d]);

  if (!d) {
    if (q.isError) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} title="This replay link is not available" />;
    return <Skeleton rows={6} label="Loading the replay" />;
  }
  if (play && view)
    return <Replay key={play.tick ?? 'start'} view={view} highlights={d.highlights} caster={d.caster} {...(play.tick !== undefined ? { startTick: play.tick } : {})} onExit={() => setPlay(null)} />;

  const def = mapV2(d.match.mapId);
  const clip = d.share.clip;
  const watch = (h?: ReplayHighlight) => setPlay(h ? { tick: h.start } : {});
  return (
    <section className={r.shared} data-testid="shared-replay">
      <span className="sk-kick">
        <b>{def?.code ?? d.match.mapId}</b> · {def?.name ?? mapById(d.match.mapId)?.name ?? d.match.mapId} · {d.match.ranked ? 'ranked' : 'casual'}
        {d.share.by ? ` · shared by ${d.share.by}` : ''}
      </span>
      <h1 className="app-h2" data-testid="shared-replay-title">
        {sharedSummary(d)}
      </h1>
      {clip ? <p className={r.clipTag}>Clip {tickClock(clip.start)}–{tickClock(clip.end)}</p> : null}
      {view ? (
        <div className={r.form}>
          <Button variant="primary" onClick={() => watch()} data-testid="shared-replay-play">
            {clip ? 'Play the clip' : 'Play the replay'}
          </Button>
          <ButtonLink href={routes.matchResult(d.match.id)}>Match result</ButtonLink>
        </div>
      ) : (
        <>
          <p className="sk-muted" data-testid="shared-replay-expired">
            The replay frames of this match are no longer kept; the result and highlights stay.
          </p>
          <ButtonLink href={routes.matchResult(d.match.id)}>Match result</ButtonLink>
        </>
      )}
      {d.highlights.length ? (
        <>
          <span className="sk-kick">
            <b>Highlights</b> · {d.caster === 'model' ? 'called by the AI caster' : 'called by the house caster'}
          </span>
          <HighlightList highlights={d.highlights} {...(view ? { onJump: watch } : {})} />
        </>
      ) : null}
    </section>
  );
}
