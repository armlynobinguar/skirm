'use client';
// /lobbies/[lobbyId]: one private lobby. The host shares its code or link; the guest's seat fills
// when a friend joins (polled). Each player picks a crew within the lobby's crew size (every agent
// on the lobby's tier when its talk rule forces one) and readies it over the shared WebSocket
// (`v2_lobby_ready`; `v2_cancel_queue` steps back). Once both have, the match starts and the match
// screen takes over at `v2_found`: accept, lock-in, live, as any match. The host may change the
// settings while nobody has a crew readied, and closes the lobby; a guest may leave. A bracket match
// (from a tournament) plays the tournament's settings and cannot be left.
import { DIFF_MODS, holdFor, type TalkTier } from '@skirm/engine/v2';
import { forcedTier } from '@skirm/shared';
import { Badge, Button, fmt } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CreditEstimate, RosterStrip, TalkTierPicker } from '@/features/agents/CrewParts';
import { TIER_INFO } from '@/features/agents/agentView';
import { v2StoreFor } from '@/features/v2/v2Store';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import type { Lobby, LobbySettings } from '@/lib/api/lobbyTypes';
import { qk, useMe } from '@/lib/api/queries';
import type { Me } from '@/lib/api/types';
import type { OutgoingMessage } from '@/lib/realtime/client';
import { useRealtimeMessage, useRealtimeStatus } from '@/lib/realtime/hooks';
import { matchOrigin } from '@/lib/match-origin';
import { routes } from '@/lib/routes';
import { useApi, useRealtime } from '@/lib/services';
import s from '@/features/pvp/pvp.module.css';
import l from './lobbies.module.css';
import { LobbySettingsForm, settingsLine } from './LobbySettingsForm';
import { shareLink, sideOf } from './lobbyUtil';

/** How often the lobby is re-read (a guest joining, the host's settings, a match result). */
const POLL_MS = 3000;
/** Errors of other screens on the shared socket, not about this lobby. */
const NOT_LOBBY_ERRORS = new Set(['too_many_subscriptions']);

type ReadyMessage = Extract<OutgoingMessage, { type: 'v2_lobby_ready' }>;

function readyErrorCopy(code: string): string {
  switch (code) {
    case 'agent_busy':
      return 'An agent is still in a match. Wait for it to end, or pick another.';
    case 'in_match':
    case 'already_queued':
      return 'You are already searching or in a match. Finish that first.';
    case 'invalid_crew':
      return 'This crew does not fit the lobby. Check its size.';
    case 'lobby_closed':
      return 'The lobby is not open for a match right now.';
    case 'unavailable':
      return 'Matches are paused. Try again shortly.';
    default:
      return 'Could not ready the crew. Try again in a moment.';
  }
}

export function LobbyScreen({ lobbyId }: { lobbyId: string }) {
  return (
    <div className={s.page} data-testid="screen-lobby">
      <RequireSession>
        <LobbyData lobbyId={lobbyId} />
      </RequireSession>
    </div>
  );
}

function LobbyData({ lobbyId }: { lobbyId: string }) {
  const api = useApi();
  const me = useMe();
  const lobby = useQuery({ queryKey: qk.lobbies.one(lobbyId), queryFn: () => api.lobby(lobbyId), refetchInterval: POLL_MS });
  if (lobby.data === undefined || me.data === undefined) {
    const err = lobby.error ?? me.error;
    return err ? <ErrorCard error={err} onRetry={() => void lobby.refetch()} /> : <Skeleton rows={6} label="Loading the lobby" />;
  }
  return <LobbyRoom lobby={lobby.data} me={me.data} />;
}

function LobbyRoom({ lobby, me }: { lobby: Lobby; me: Me }) {
  const api = useApi();
  const rt = useRealtime();
  const status = useRealtimeStatus();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const side = sideOf(lobby, me.account.id);
  const isHost = side === 'host';
  const forced = forcedTier(lobby.talk);
  const bracket = lobby.tournamentId !== null;

  const [crew, setCrew] = useState<string[]>(() => me.agents.slice(0, Math.min(1, lobby.crewSize)).map((a) => a.id));
  const [tiers, setTiers] = useState<Record<string, TalkTier>>(() => Object.fromEntries(me.agents.map((a) => [a.id, a.tier])));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Lobby['ready'] | null>(null);
  const [editing, setEditing] = useState<LobbySettings | null>(null);

  const tierOf = (id: string): TalkTier => forced ?? tiers[id] ?? 'standard';
  const ticks = DIFF_MODS[lobby.difficulty]?.ticks ?? 150;
  const hold = holdFor(crew.map((id) => ({ tier: tierOf(id) })), false, ticks);
  const readyBoth = live ?? lobby.ready;

  const readyRef = useRef(false);
  readyRef.current = ready;
  const sent = useRef<ReadyMessage | null>(null);

  // Leaving the screen with a crew readied steps back out.
  useEffect(
    () => () => {
      if (readyRef.current) rt.send({ type: 'v2_cancel_queue' });
    },
    [rt],
  );

  // A lobby wait does not survive a reconnect: ready again once the socket is back.
  const prevStatus = useRef(status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (status === 'open' && prev === 'reconnecting' && readyRef.current && sent.current) rt.send(sent.current);
  }, [status, rt]);

  // Over the crew size (the host lowered it): drop the extra agents.
  useEffect(() => {
    if (crew.length > lobby.crewSize) setCrew((p) => p.slice(0, lobby.crewSize));
  }, [lobby.crewSize, crew.length]);

  useRealtimeMessage((m) => {
    if (m.type === 'v2_lobby' && m.lobbyId === lobby.id) {
      setLive(m.ready);
      void qc.invalidateQueries({ queryKey: qk.lobbies.one(lobby.id) });
    } else if (m.type === 'v2_found' && readyRef.current) {
      setReady(false);
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.lobbies.all });
      matchOrigin.set(
        m.matchId,
        lobby.tournamentId ? { kind: 'tournament', tournamentId: lobby.tournamentId } : { kind: 'lobby', lobbyId: lobby.id },
      );
      router.push(routes.match(m.matchId));
    } else if (m.type === 'error' && readyRef.current && !NOT_LOBBY_ERRORS.has(m.code)) {
      if (m.code === 'not_found' && sent.current === null) return;
      setError(readyErrorCopy(m.code));
      setReady(false);
    }
  });

  const update = useMutation({
    mutationFn: (patch: LobbySettings) => api.updateLobby(lobby.id, patch),
    onSuccess: (row) => {
      qc.setQueryData(qk.lobbies.one(lobby.id), row);
      setEditing(null);
    },
    onError: (e) => toast.error(e),
  });
  const leave = useMutation({
    mutationFn: () => api.leaveLobby(lobby.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.lobbies.all });
      router.push(routes.lobbies());
    },
    onError: (e) => toast.error(e),
  });

  const toggle = (id: string) => {
    setError(null);
    if (crew.includes(id)) return setCrew((p) => (p.length > 1 ? p.filter((x) => x !== id) : p));
    if (crew.length >= lobby.crewSize) return toast.show({ tone: 'warning', title: `This lobby takes up to ${lobby.crewSize} agents.` });
    setCrew((p) => [...p, id]);
  };
  const doReady = () => {
    const msg: ReadyMessage = { type: 'v2_lobby_ready', lobbyId: lobby.id, crew: crew.map((id) => ({ agentId: id, tier: tierOf(id) })) };
    sent.current = msg;
    v2StoreFor(rt).queued = crew.map((id) => ({ agentId: id, name: me.agents.find((a) => a.id === id)?.name ?? 'Agent', tier: tierOf(id) }));
    setError(null);
    setReady(true);
    rt.send(msg);
  };
  const stepBack = () => {
    rt.send({ type: 'v2_cancel_queue' });
    setReady(false);
  };

  const open = lobby.status === 'open';
  const canReady = open && !!lobby.guest && side !== null && crew.length > 0 && me.credits.available >= hold;
  const link = shareLink(lobby.code);
  const winner = lobby.winnerId ? (lobby.winnerId === lobby.host.id ? lobby.host.handle : lobby.guest?.handle) : null;

  return (
    <>
      <div className={s.head}>
        <div className={s.headText}>
          <span className="sk-kick">{bracket ? `Tournament match · round ${lobby.round}` : 'Friend challenge · unranked'}</span>
          <h1 className="app-h1">
            {lobby.host.handle} vs {lobby.guest?.handle ?? '…'}
          </h1>
          <p className={s.lede} data-testid="lobby-settings">
            {settingsLine(lobby)}
          </p>
        </div>
        <Badge tone={open ? 'good' : 'neutral'} data-testid="lobby-status">
          {lobby.status}
        </Badge>
      </div>
      <div className={s.cols}>
        <div className={s.colMain}>
          {!bracket ? (
            <section className={s.card} aria-labelledby="lobby-share">
              <h2 className={s.h3} id="lobby-share">
                Invite a friend
              </h2>
              <div className={l.row}>
                <span className={l.code} data-testid="lobby-code">
                  {lobby.code}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link).then(
                      () => toast.show({ tone: 'good', title: 'Link copied' }),
                      () => undefined,
                    );
                  }}
                  data-testid="lobby-copy"
                >
                  Copy link
                </Button>
              </div>
              <span className={l.link}>{link}</span>
            </section>
          ) : (
            <p className={s.note}>
              <Link href={routes.tournament(lobby.tournamentId!)}>Back to the bracket</Link>. A match nobody starts is decided after 15 minutes: a player who
              readied goes through, otherwise the better seed.
            </p>
          )}
          <section className={s.card} aria-labelledby="lobby-players">
            <h2 className={s.h3} id="lobby-players">
              Players
            </h2>
            <div className={l.players}>
              {(['host', 'guest'] as const).map((k) => {
                const p = lobby[k];
                return (
                  <div key={k} className={l.player} data-ready={readyBoth[k]} data-testid={`lobby-${k}`}>
                    <span className="sk-kick">{k === 'host' ? 'Host · crew A' : 'Guest · crew B'}</span>
                    <b>{p?.handle ?? 'Waiting for a friend…'}</b>
                    <span className={l.muted}>{p ? (readyBoth[k] ? 'Crew readied' : 'Picking a crew') : 'Share the code'}</span>
                  </div>
                );
              })}
            </div>
            {lobby.matchId && open ? (
              <p className={s.note} data-testid="lobby-last">
                Last match: {winner ? `${winner} won` : 'no winner'} · <Link href={routes.matchResult(lobby.matchId)}>debrief</Link>
              </p>
            ) : null}
            {lobby.status === 'playing' && lobby.matchId ? (
              <ButtonLink href={routes.match(lobby.matchId)} data-testid="lobby-watch">
                To the match
              </ButtonLink>
            ) : null}
          </section>
          {open && side ? (
            <section className={s.card} aria-labelledby="lobby-crew">
              <h2 className={s.h3} id="lobby-crew">
                Your crew · up to {lobby.crewSize}
              </h2>
              <RosterStrip agents={me.agents} picked={crew} onToggle={toggle} disabled={ready} testPrefix="lobby" />
              <div className={l.tiers}>
                {crew.map((id) => {
                  const a = me.agents.find((x) => x.id === id);
                  if (!a) return null;
                  return (
                    <div key={id} className={l.tierRow}>
                      <b>{a.name}</b>
                      {forced ? (
                        <span className={l.muted}>{TIER_INFO[forced].label} (lobby rule)</span>
                      ) : (
                        <TalkTierPicker name={a.name} value={tierOf(id)} ranked={false} disabled={ready} onChange={(t) => setTiers((p) => ({ ...p, [id]: t }))} />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
        <aside className={s.colSide}>
          {open && side ? (
            <>
              <CreditEstimate ticks={ticks} rates={crew.map((id) => TIER_INFO[tierOf(id)].rate)} hold={hold} data-testid="lobby-estimate" />
              {me.credits.available < hold ? (
                <div className="app-banner is-warning" role="status" data-testid="lobby-short">
                  This crew holds {fmt(hold)} credits; you have {fmt(me.credits.available)}. <Link href={routes.credits()}>Top up</Link> or field fewer agents.
                </div>
              ) : null}
              {error ? (
                <div className="app-banner is-critical" role="alert" data-testid="lobby-error">
                  {error}
                </div>
              ) : null}
              {ready ? (
                <Button variant="secondary" block onClick={stepBack} data-testid="lobby-unready">
                  {readyBoth[side === 'host' ? 'guest' : 'host'] ? 'Starting…' : 'Waiting for your friend · step back'}
                </Button>
              ) : (
                <Button variant="primary" size="lg" block onClick={doReady} disabled={!canReady} data-testid="lobby-ready">
                  {lobby.guest ? 'Ready ▸' : 'Waiting for a guest'}
                </Button>
              )}
            </>
          ) : null}
          {isHost && open && !bracket ? (
            <section className={s.card} aria-labelledby="lobby-host">
              <h2 className={s.h3} id="lobby-host">
                Settings
              </h2>
              <LobbySettingsForm
                value={editing ?? { mapId: lobby.mapId, difficulty: lobby.difficulty, talk: lobby.talk, crewSize: lobby.crewSize }}
                onChange={setEditing}
                disabled={ready || readyBoth.guest || update.isPending}
                testPrefix="lobby-edit"
              />
              <div className={l.rowEnd}>
                <Button size="sm" variant="secondary" onClick={() => editing && update.mutate(editing)} disabled={!editing || update.isPending} data-testid="lobby-save">
                  Save settings
                </Button>
              </div>
            </section>
          ) : null}
          {!bracket && side && lobby.status !== 'cancelled' ? (
            <Button variant="ghost" onClick={() => leave.mutate()} disabled={ready || lobby.status === 'playing' || leave.isPending} data-testid="lobby-leave">
              {isHost ? 'Close the lobby' : 'Leave the lobby'}
            </Button>
          ) : null}
        </aside>
      </div>
    </>
  );
}
