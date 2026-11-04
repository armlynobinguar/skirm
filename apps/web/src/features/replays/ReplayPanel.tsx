'use client';
// The debrief's Highlights panel: the match's highlight moments with caster lines (each opens the
// replay there) and, for a player of the match, sharing: a public link to the whole replay or to a
// clip (a highlight's, or any start and end tick), copy and end each link. A link shows the whole
// board only, as a spectator saw it: no plans, inner voice or live commands of either crew.
import { Button } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { qk } from '@/lib/api/queries';
import type { ReplayShare } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { HighlightList, tickClock } from './Highlights';
import r from './replays.module.css';

export const shareUrl = (s: Pick<ReplayShare, 'id'>) => `${config.siteUrl}${routes.replay(s.id)}`;

export function ReplayPanel({ matchId, ticks, canShare }: { matchId: string; ticks: number; canShare: boolean }) {
  const api = useApi();
  const highlights = useQuery({
    queryKey: qk.matches.highlights(matchId),
    queryFn: () => api.v2Highlights(matchId),
    staleTime: 60_000,
    retry: false,
    // Realtime stores the frames just after v2_end: a debrief opened at once may ask before they land.
    refetchInterval: (q) => (q.state.data && !q.state.data.framesKept && q.state.dataUpdateCount < 4 ? 3000 : false),
  });
  const list = highlights.data?.highlights ?? [];
  const kept = highlights.data?.framesKept ?? false;
  if (!highlights.data) return null;
  if (!list.length && !(canShare && kept)) return null;
  return (
    <section className={`sk-panel ${r.panel}`} aria-label="Highlights" data-testid="v2-highlights">
      <span className="sk-kick">
        <b>Highlights</b> · {highlights.data.caster === 'model' ? 'called by the AI caster' : 'called by the house caster'}
        {kept ? '' : ' · the replay frames are no longer kept'}
      </span>
      {list.length ? <HighlightList highlights={list} {...(kept ? { hrefOf: (h) => routes.matchReplay(matchId, h.start) } : {})} /> : <p className="sk-muted">No standout moments this match.</p>}
      {canShare && kept ? <SharePanel matchId={matchId} ticks={ticks} presets={list.map((h) => ({ id: h.id, label: `${tickClock(h.tick)} ${h.title}`, start: h.start, end: h.end }))} /> : null}
    </section>
  );
}

interface Preset {
  id: string;
  label: string;
  start: number;
  end: number;
}

function SharePanel({ matchId, ticks, presets }: { matchId: string; ticks: number; presets: Preset[] }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const { status } = useSession();
  const shares = useQuery({ queryKey: qk.matches.shares(matchId), queryFn: () => api.replayShares(matchId), enabled: status === 'signedIn' });
  const [start, setStart] = useState(presets[0]?.start ?? 0);
  const [end, setEnd] = useState(presets[0]?.end ?? Math.min(ticks, 10));
  const bad = !(start >= 0 && end > start && end <= ticks);
  const done = () => void qc.invalidateQueries({ queryKey: qk.matches.shares(matchId) });
  const create = useMutation({
    mutationFn: (clip: { start: number; end: number } | null) => api.createReplayShare(matchId, clip),
    onSuccess: async ({ share }) => {
      done();
      const copied = await copy(shareUrl(share));
      toast.show({ tone: 'good', title: 'Link ready', message: copied ? 'Copied to the clipboard.' : shareUrl(share) });
    },
    onError: (e) => toast.show({ tone: 'warning', title: 'No link', message: e instanceof Error ? e.message : 'The link could not be made.' }),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeReplayShare(id), onSuccess: done });
  if (status !== 'signedIn') return null;
  return (
    <div className={r.panel} data-testid="v2-share">
      <span className="sk-kick">
        <b>Share</b> · a public link shows the whole board, never either crew’s plans or orders
      </span>
      <div className={r.form}>
        <Button variant="primary" size="sm" onClick={() => create.mutate(null)} disabled={create.isPending} data-testid="v2-share-full">
          Share the replay
        </Button>
        {presets.length ? (
          <label>
            Clip
            <select
              aria-label="Clip a highlight"
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                if (p) (setStart(p.start), setEnd(p.end));
              }}
              data-testid="v2-share-preset"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          From tick
          <input type="number" min={0} max={ticks - 1} value={start} onChange={(e) => setStart(Number(e.target.value))} data-testid="v2-share-start" />
        </label>
        <label>
          To tick
          <input type="number" min={1} max={ticks} value={end} onChange={(e) => setEnd(Number(e.target.value))} data-testid="v2-share-end" />
        </label>
        <Button size="sm" onClick={() => create.mutate({ start, end })} disabled={bad || create.isPending} data-testid="v2-share-clip">
          Share clip {bad ? '' : `${tickClock(start)}–${tickClock(end)}`}
        </Button>
      </div>
      {shares.data?.shares.length ? (
        <ul className={r.links} data-testid="v2-share-links">
          {shares.data.shares.map((s) => (
            <li key={s.id}>
              <code>{shareUrl(s)}</code>
              <span className={r.clipTag}>{s.clip ? `clip ${tickClock(s.clip.start)}–${tickClock(s.clip.end)}` : 'whole match'}</span>
              <Button size="sm" variant="ghost" onClick={() => void copy(shareUrl(s))}>
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending} data-testid={`v2-share-revoke-${s.id}`}>
                End link
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
