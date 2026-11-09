'use client';
// /tournaments: single-elimination brackets of 4, 8 or 16 players (GET /tournaments, public), and
// a form to make one (POST /tournaments): its name, size, the lobby settings every match plays, and
// an optional prize pool of the creator's paid credits, spent at once and paid to the top four
// (60 / 25 / 7.5 / 7.5 %). The bracket starts by itself when the last place is taken, seeded by Elo.
import { Button, TextField, fmt } from '@skirm/ui';
import { TOURNAMENT, TOURNAMENT_SIZES, type TournamentSize } from '@skirm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { SignInButton } from '@/components/shell/RequireSession';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { useSession } from '@/lib/auth/session';
import type { LobbySettings } from '@/lib/api/lobbyTypes';
import { qk, useMe } from '@/lib/api/queries';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from '@/features/pvp/pvp.module.css';
import l from './lobbies.module.css';
import { DEFAULT_LOBBY_SETTINGS, LobbySettingsForm, settingsLine } from './LobbySettingsForm';
import { PRIZE_SPLIT_TEXT, prizePreview } from './lobbyUtil';

export function TournamentsScreen() {
  const api = useApi();
  const { status } = useSession();
  const list = useQuery({ queryKey: qk.tournaments.list, queryFn: () => api.tournaments(), refetchInterval: 10_000 });
  return (
    <div className={s.page} data-testid="screen-tournaments">
      <div className={s.head}>
        <div className={s.headText}>
          <h1 className="app-h1">Tournaments</h1>
          <p className={s.lede}>Brackets of 4, 8 or 16 players, seeded by Elo, one private match per pairing. Unranked; a prize pool is paid in credits to the top four.</p>
        </div>
        <ButtonLink href={routes.lobbies()}>Private lobbies</ButtonLink>
      </div>
      <div className={s.cols}>
        <div className={s.colMain}>
          <section className={s.card} aria-labelledby="t-list">
            <h2 className={s.h2} id="t-list">
              Brackets
            </h2>
            <QueryView query={list} loading={<Skeleton rows={4} label="Loading tournaments" />}>
              {(rows) =>
                rows.length ? (
                  <ul className={l.list} data-testid="t-rows">
                    {rows.map((t) => (
                      <li key={t.id} className={l.item}>
                        <span>
                          <b>{t.name}</b>{' '}
                          <span className={l.muted}>
                            {t.entrants}/{t.size} · {t.status}
                            {t.prizePool ? ` · ${fmt(t.prizePool)} credits` : ''} · {settingsLine(t)}
                            {t.joined ? ' · you are in' : ''}
                          </span>
                        </span>
                        <Link href={routes.tournament(t.id)}>{t.status === 'open' && !t.joined ? 'Join' : 'Bracket'}</Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={s.note}>
                    {status === 'signedOut'
                      ? 'No tournaments yet. Sign in to make the first one.'
                      : 'No tournaments yet. Make the first one.'}
                  </p>
                )
              }
            </QueryView>
          </section>
        </div>
        <aside className={s.colSide}>
          {status === 'signedIn' ? (
            <CreateTournament />
          ) : status === 'signedOut' ? (
            <section className={s.card} aria-labelledby="t-new-signin" data-testid="t-signin">
              <h2 className={s.h3} id="t-new-signin">
                Make a tournament
              </h2>
              <p className={s.note}>Pick a bracket size and a prize pool, then share the link. Needs an account; no wallet needed.</p>
              <SignInButton data-testid="t-signin-action">Sign in to create</SignInButton>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function CreateTournament() {
  const api = useApi();
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [size, setSize] = useState<TournamentSize>(4);
  const [settings, setSettings] = useState<LobbySettings>(DEFAULT_LOBBY_SETTINGS);
  const [pool, setPool] = useState(0);
  const [join, setJoin] = useState(true);
  const paid = me.data?.credits.balance ?? 0;
  const create = useMutation({
    mutationFn: () => api.createTournament({ name: name.trim(), size, ...settings, prizePool: pool, join }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: qk.tournaments.all });
      void qc.invalidateQueries({ queryKey: qk.me });
      router.push(routes.tournament(t.id));
    },
    onError: (e) => toast.error(e),
  });
  const short = pool > paid;
  return (
    <section className={s.card} aria-labelledby="t-new">
      <h2 className={s.h3} id="t-new">
        Make a tournament
      </h2>
      <form
        className={l.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !short) create.mutate();
        }}
      >
        <TextField label="Name" value={name} maxLength={TOURNAMENT.nameMax} onChange={(e) => setName(e.target.value)} data-testid="t-name" />
        <label className={l.field}>
          <span className="sk-kick">Players</span>
          <select className="sk-input" value={size} onChange={(e) => setSize(Number(e.target.value) as TournamentSize)} data-testid="t-size">
            {TOURNAMENT_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} players
              </option>
            ))}
          </select>
        </label>
        <LobbySettingsForm value={settings} onChange={setSettings} testPrefix="t-new" />
        <TextField
          label="Prize pool (paid credits)"
          type="number"
          min={0}
          max={TOURNAMENT.maxPrizePool}
          value={String(pool)}
          onChange={(e) => setPool(Math.max(0, Math.min(TOURNAMENT.maxPrizePool, Math.floor(Number(e.target.value) || 0))))}
          hint={`Spent now from your ${fmt(paid)} paid credits; split ${PRIZE_SPLIT_TEXT}. Returned if you cancel before it starts.`}
          error={short ? 'More than your paid balance.' : undefined}
          data-testid="t-pool"
        />
        {pool > 0 ? (
          <p className={s.note} data-testid="t-prizes">
            {prizePreview(pool)
              .map((p) => `${p.place} ${fmt(p.credits)}`)
              .join(' · ')}
          </p>
        ) : null}
        <label className={l.check}>
          <input type="checkbox" checked={join} onChange={(e) => setJoin(e.target.checked)} data-testid="t-join" /> I play in it
        </label>
        <Button type="submit" variant="primary" disabled={!name.trim() || short || create.isPending} data-testid="t-create">
          Make the tournament ▸
        </Button>
      </form>
    </section>
  );
}
