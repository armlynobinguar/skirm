'use client';
// /tournaments/[id]: one bracket (GET /tournaments/:id, public, polled). One column per round:
// each match shows its two players with their seeds, the winner once decided, and a link to the
// lobby for the two who play it (the caller's own match is outlined, with a Play button on top).
// While it takes players: join or leave, and the creator may cancel (the prize pool comes back).
// At the end: the places and the prizes paid.
import { Badge, Button, fmt } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ButtonLink } from '@/components/ButtonLink';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { useSession } from '@/lib/auth/session';
import type { BracketMatch, TournamentDetail } from '@/lib/api/lobbyTypes';
import { qk } from '@/lib/api/queries';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from '@/features/pvp/pvp.module.css';
import l from './lobbies.module.css';
import { settingsLine } from './LobbySettingsForm';
import { PRIZE_SPLIT_TEXT, bracketGrid, prizePreview, roundName } from './lobbyUtil';

const POLL_MS = 5000;

export function TournamentScreen({ id }: { id: string }) {
  const api = useApi();
  const t = useQuery({ queryKey: qk.tournaments.one(id), queryFn: () => api.tournament(id), refetchInterval: POLL_MS });
  return (
    <div className={s.page} data-testid="screen-tournament">
      {t.data ? <Bracket t={t.data} /> : t.isError ? <ErrorCard error={t.error} onRetry={() => void t.refetch()} /> : <Skeleton rows={6} label="Loading the bracket" />}
    </div>
  );
}

function Bracket({ t }: { t: TournamentDetail }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const { status: session } = useSession();
  const handles = new Map(t.entries.map((e) => [e.account.id, e]));
  const done = (d: TournamentDetail) => qc.setQueryData(qk.tournaments.one(t.id), d);
  const act = useMutation({
    mutationFn: (kind: 'join' | 'leave' | 'cancel') =>
      kind === 'join' ? api.joinTournament(t.id) : kind === 'leave' ? api.leaveTournament(t.id) : api.cancelTournament(t.id),
    onSuccess: (d) => {
      done(d);
      void qc.invalidateQueries({ queryKey: qk.tournaments.list });
      void qc.invalidateQueries({ queryKey: qk.lobbies.all });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (e) => toast.error(e),
  });
  const joined = !!t.you?.joined;
  const isCreator = !!t.you?.creator;
  const open = t.status === 'open';

  return (
    <>
      <div className={s.head}>
        <div className={s.headText}>
          <span className="sk-kick">
            Tournament · {t.size} players · by {t.creator.handle}
          </span>
          <h1 className="app-h1" data-testid="t-title">
            {t.name}
          </h1>
          <p className={s.lede}>{settingsLine(t)} · unranked</p>
        </div>
        <Badge tone={t.status === 'running' ? 'good' : 'neutral'} data-testid="t-status">
          {t.status === 'open' ? `${t.entrants}/${t.size} joined` : t.status}
        </Badge>
      </div>

      {t.you?.lobbyId ? (
        <div className="app-banner" role="status" data-testid="t-your-match">
          Your match is ready. <ButtonLink href={routes.lobby(t.you.lobbyId)} variant="primary" size="sm">Play it ▸</ButtonLink>
        </div>
      ) : null}
      {t.champion ? (
        <div className="app-banner" role="status" data-testid="t-champion">
          <b>{t.champion.handle}</b> won the tournament.
        </div>
      ) : null}

      <div className={s.cols}>
        <div className={s.colMain}>
          <section className={s.card} aria-labelledby="t-bracket">
            <h2 className={s.h2} id="t-bracket">
              Bracket
            </h2>
            {open ? <p className={s.note}>The bracket is drawn by Elo when the last place is taken.</p> : null}
            <div className={l.bracket} data-testid="t-grid">
              {bracketGrid(t).map((col) => (
                <div key={col.round} className={l.round} data-testid={`t-round-${col.round}`}>
                  <span className={l.roundName}>{roundName(t.size, col.round)}</span>
                  {col.slots.map((m, i) => (
                    <MatchBox key={i} m={m} handles={handles} you={t.you?.lobbyId ?? null} />
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className={s.colSide}>
          <section className={s.card} aria-labelledby="t-prize">
            <h2 className={s.h3} id="t-prize">
              Prize pool
            </h2>
            {t.prizePool ? (
              <>
                <b data-testid="t-pool">{fmt(t.prizePool)} credits</b>
                <p className={s.note}>
                  Split {PRIZE_SPLIT_TEXT}:{' '}
                  {prizePreview(t.prizePool)
                    .map((p) => `${p.place} ${fmt(p.credits)}`)
                    .join(' · ')}
                </p>
              </>
            ) : (
              <p className={s.note}>No prize pool: for the glory.</p>
            )}
          </section>
          <section className={s.card} aria-labelledby="t-players">
            <h2 className={s.h3} id="t-players">
              Players
            </h2>
            <ul className={l.list} data-testid="t-entries">
              {t.entries.map((e) => (
                <li key={e.account.id} className={l.item}>
                  <span>
                    {e.seed ? <span className={l.seed}>#{e.seed} </span> : null}
                    <b>{e.account.handle}</b> {e.elo ? <span className={l.muted}>Elo {e.elo}</span> : null}
                  </span>
                  <span className={l.muted}>
                    {e.place ? placeText(e.place) : open ? 'joined' : 'in'}
                    {e.prize ? ` · +${fmt(e.prize)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {session === 'signedIn' && open ? (
              <div className={l.row}>
                {joined ? (
                  <Button size="sm" variant="secondary" onClick={() => act.mutate('leave')} disabled={act.isPending} data-testid="t-leave">
                    Leave
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => act.mutate('join')} disabled={act.isPending || t.entrants >= t.size} data-testid="t-join-btn">
                    Join ▸
                  </Button>
                )}
                {isCreator ? (
                  <Button size="sm" variant="danger" onClick={() => act.mutate('cancel')} disabled={act.isPending} data-testid="t-cancel">
                    Cancel tournament
                  </Button>
                ) : null}
              </div>
            ) : session !== 'signedIn' && open ? (
              <p className={s.note}>
                <Link href={routes.signIn()}>Sign in</Link> to join.
              </p>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}

function placeText(p: number): string {
  if (p === 1) return 'champion';
  if (p === 2) return 'runner-up';
  if (p === 3) return 'semi-final';
  return `top ${2 * (p - 1)}`;
}

function MatchBox({ m, handles, you }: { m: BracketMatch | null; handles: Map<string, TournamentDetail['entries'][number]>; you: string | null }) {
  if (!m)
    return (
      <div className={l.match} data-testid="t-match-empty">
        <div className={l.slot}>
          <span className={l.muted}>Awaiting winner</span>
        </div>
        <div className={l.slot}>
          <span className={l.muted}>Awaiting winner</span>
        </div>
      </div>
    );
  const row = (id: string | null) => {
    const e = id ? handles.get(id) : undefined;
    const decided = m.status === 'done' && m.winnerId !== null;
    return (
      <div className={l.slot} data-won={decided && m.winnerId === id} data-lost={decided && m.winnerId !== id}>
        <span>
          {e?.seed ? <span className={l.seed}>#{e.seed} </span> : null}
          {e?.account.handle ?? 'Awaiting winner'}
        </span>
      </div>
    );
  };
  return (
    <div className={l.match} data-mine={you === m.lobbyId} data-testid={`t-match-${m.round}-${m.slot}`}>
      {row(m.hostId)}
      {row(m.guestId)}
      <div className={l.matchFoot}>
        {m.status === 'playing' && m.matchId ? (
          <Link href={routes.match(m.matchId)}>live · watch</Link>
        ) : m.status === 'done' && m.matchId ? (
          <Link href={routes.matchResult(m.matchId)}>debrief</Link>
        ) : m.status === 'done' ? (
          'decided without a match'
        ) : (
          'to play'
        )}
      </div>
    </div>
  );
}
