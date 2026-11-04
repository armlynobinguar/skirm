'use client';
// /lobbies/join/[code]: a lobby's share link. Shows who invited you and the rules
// (GET /lobbies/code/:code), then takes the guest seat (POST /lobbies/join) and opens the lobby.
// The host, or a guest already seated, goes straight to the lobby.
import { Button } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { qk, useMe } from '@/lib/api/queries';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from '@/features/pvp/pvp.module.css';
import l from './lobbies.module.css';
import { settingsLine } from './LobbySettingsForm';
import { sideOf } from './lobbyUtil';

export function JoinLobbyScreen({ code }: { code: string }) {
  return (
    <div className={s.page} data-testid="screen-lobby-join">
      <RequireSession>
        <Join code={code.toUpperCase()} />
      </RequireSession>
    </div>
  );
}

function Join({ code }: { code: string }) {
  const api = useApi();
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const lobby = useQuery({ queryKey: qk.lobbies.code(code), queryFn: () => api.lobbyByCode(code), retry: false });
  const join = useMutation({
    mutationFn: () => api.joinLobby(code),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: qk.lobbies.all });
      router.replace(routes.lobby(row.id));
    },
    onError: (e) => toast.error(e),
  });
  const seated = lobby.data && me.data ? sideOf(lobby.data, me.data.account.id) : null;
  useEffect(() => {
    if (seated && lobby.data) router.replace(routes.lobby(lobby.data.id));
  }, [seated, lobby.data, router]);

  if (lobby.isError) return <ErrorCard error={lobby.error} onRetry={() => void lobby.refetch()} />;
  if (!lobby.data) return <Skeleton rows={3} label="Loading the invite" />;
  const d = lobby.data;
  const closed = d.status === 'cancelled';
  return (
    <section className={s.card} aria-labelledby="join-title">
      <span className="sk-kick">Friend challenge · unranked</span>
      <h1 className="app-h1" id="join-title">
        {d.host.handle} challenges you
      </h1>
      <p className={s.lede}>{settingsLine(d)}</p>
      <p className={s.note}>Nothing counts for Elo or the season. Your crew holds credits for the match as in casual play; the unused part comes back.</p>
      <div className={l.row}>
        {closed ? (
          <span data-testid="join-closed">The host closed this lobby.</span>
        ) : d.guest ? (
          <span data-testid="join-full">{d.guest.handle} already took the seat.</span>
        ) : (
          <Button variant="primary" onClick={() => join.mutate()} disabled={join.isPending} data-testid="join-accept">
            Join the lobby ▸
          </Button>
        )}
        <ButtonLink href={routes.lobbies()}>Lobbies</ButtonLink>
      </div>
    </section>
  );
}
