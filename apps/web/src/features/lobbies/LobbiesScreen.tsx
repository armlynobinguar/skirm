'use client';
// /lobbies: private matches. Challenge a friend (POST /lobbies with the host's map, difficulty, talk
// rule and crew size; the lobby screen then shows its share code and link), join one with a code
// (POST /lobbies/join), and the caller's lobbies still to play, bracket matches included. Lobby
// matches are unranked: no Elo, no season, no registry; both crews hold credits as in casual play.
import { Button, TextField } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { isApiError } from '@/lib/api/errors';
import type { LobbySettings } from '@/lib/api/lobbyTypes';
import { qk } from '@/lib/api/queries';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from '@/features/pvp/pvp.module.css';
import l from './lobbies.module.css';
import { DEFAULT_LOBBY_SETTINGS, LobbySettingsForm, settingsLine } from './LobbySettingsForm';

const JOIN_COPY: Record<string, string> = {
  not_found: 'No lobby has this code. Check it and try again.',
  own_lobby: 'This is your own lobby.',
  lobby_full: 'This lobby already has a guest.',
  lobby_closed: 'This lobby was closed by its host.',
  tournament_match: 'Bracket matches are played from the tournament page.',
};

export function LobbiesScreen() {
  return (
    <div className={s.page} data-testid="screen-lobbies">
      <div className={s.head}>
        <div className={s.headText}>
          <h1 className="app-h1">Private lobbies</h1>
          <p className={s.lede}>Challenge a friend on the map and rules you pick. Unranked: nothing counts for Elo or the season; credits are held as in a casual match.</p>
        </div>
        <ButtonLink href={routes.tournaments()} data-testid="lobbies-tournaments">
          Tournaments
        </ButtonLink>
      </div>
      <RequireSession>
        <Lobbies />
      </RequireSession>
    </div>
  );
}

function Lobbies() {
  const api = useApi();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [settings, setSettings] = useState<LobbySettings>(DEFAULT_LOBBY_SETTINGS);
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const mine = useQuery({ queryKey: qk.lobbies.mine, queryFn: () => api.myLobbies() });

  const create = useMutation({
    mutationFn: () => api.createLobby(settings),
    onSuccess: (lobby) => {
      void qc.invalidateQueries({ queryKey: qk.lobbies.all });
      router.push(routes.lobby(lobby.id));
    },
    onError: (e) => toast.error(e),
  });
  const join = useMutation({
    mutationFn: (c: string) => api.joinLobby(c),
    onSuccess: (lobby) => {
      void qc.invalidateQueries({ queryKey: qk.lobbies.all });
      router.push(routes.lobby(lobby.id));
    },
    onError: (e) => setJoinError(isApiError(e) ? (JOIN_COPY[e.code] ?? e.message) : 'Could not join. Try again.'),
  });

  return (
    <div className={s.cols}>
      <div className={s.colMain}>
        <section className={s.card} aria-labelledby="lobbies-create">
          <h2 className={s.h2} id="lobbies-create">
            Challenge a friend
          </h2>
          <LobbySettingsForm value={settings} onChange={setSettings} disabled={create.isPending} testPrefix="lobbies-new" />
          <div className={l.rowEnd}>
            <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending} data-testid="lobbies-create">
              Make a lobby ▸
            </Button>
          </div>
        </section>
        <section className={s.card} aria-labelledby="lobbies-mine">
          <h2 className={s.h2} id="lobbies-mine">
            Your lobbies
          </h2>
          <QueryView query={mine} loading={<Skeleton rows={3} label="Loading your lobbies" />}>
            {(rows) =>
              rows.length ? (
                <ul className={l.list} data-testid="lobbies-list">
                  {rows.map((r) => (
                    <li key={r.id} className={l.item}>
                      <span>
                        <b>
                          {r.host.handle} vs {r.guest?.handle ?? '…'}
                        </b>{' '}
                        <span className={l.muted}>
                          {r.tournamentId ? `bracket round ${r.round}` : r.code} · {settingsLine(r)} · {r.status}
                        </span>
                      </span>
                      <Link href={routes.lobby(r.id)}>Open</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={s.note}>No lobbies yet. Make one and send your friend the code.</p>
              )
            }
          </QueryView>
        </section>
      </div>
      <aside className={s.colSide}>
        <section className={s.card} aria-labelledby="lobbies-join">
          <h2 className={s.h3} id="lobbies-join">
            Join with a code
          </h2>
          <form
            className={l.form}
            onSubmit={(e) => {
              e.preventDefault();
              setJoinError(null);
              const c = code.trim().toUpperCase();
              if (c) join.mutate(c);
            }}
          >
            <TextField
              label="Lobby code"
              value={code}
              maxLength={6}
              mono
              autoComplete="off"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              error={joinError ?? undefined}
              data-testid="lobbies-code"
            />
            <Button type="submit" variant="secondary" disabled={join.isPending || code.trim().length !== 6} data-testid="lobbies-join">
              Join ▸
            </Button>
          </form>
        </section>
      </aside>
    </div>
  );
}
