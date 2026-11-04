'use client';
// S11 Skirmish hub (/pvp), in the v2 Arena layout (the prototype's s-hub): rank title, record, ladder
// place and earn-back with the crew on the left, the round Find match button and the rules in the
// middle, the season pool, the season standings and live v2 matches on the right.
// Pick up to 3 agents and ranked or casual, queue a v2 match over the shared WebSocket (`v2_queue` /
// `v2_cancel_queue`) and watch `queue_status` (search time, Elo range around the player's own Elo).
// On `v2_found` the VS takeover covers the hub: your crew's faces against a hidden rival, Accept
// within the window (then the v2 match screen takes over: lock-in, live) or Decline. The cost is the
// hold: every tick at the crew's talk rates (Standard in ranked), the unused part returned.
// The season (GET /seasons/current) gives the pool, its split, the countdown and the top 10; the pool
// says "local" while it is kept offchain. Earn-back shows season prizes won and agent rentals earned.
// Ranked plays Normal; casual picks of map and difficulty start from the atlas. Draft is a casual
// queue (`v2_queue {draft: true}`) that pairs only with other draft searches: after accept each crew
// bans one of the rival's equipped skills (the match screen's ban phase), then lock-in.
import { DIFF_MODS, RANKED_DIFFICULTY, holdFor, type TalkTier } from '@skirm/engine/v2';
import { fmtRate, ratePerTick } from '@/features/agents/agentView';
import { DEFAULTS, OUTFIT_COLORS, SKIN_TONES, rankTitle } from '@skirm/shared';
import { Badge, Button, Icon, Tabs, fmt } from '@skirm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { DIFFS, MAPS, diffIndex, mapById } from '@/features/arena/world';
import { other } from '@/features/v2/common';
import { useV2Match, v2StoreFor, type V2MatchView } from '@/features/v2/v2Store';
import { ButtonLink } from '@/components/ButtonLink';
import { useEscapeLayer } from '@/components/shell/GlobalKeys';
import { RequireSession } from '@/components/shell/RequireSession';
import { EmptyState } from '@/components/states/EmptyState';
import { QueryView } from '@/components/states/QueryView';
import { Skeleton } from '@/components/states/Skeleton';
import { qk, useCurrentSeason, useMe, useV2LiveMatches } from '@/lib/api/queries';
import type { Agent, CurrentSeason, EarnBack, Standing, V2LiveMatch } from '@/lib/api/types';
import type { OutgoingMessage } from '@/lib/realtime/client';
import type { V2EndReason } from '@/lib/realtime/protocol';
import { useRealtimeMessage, useRealtimeStatus } from '@/lib/realtime/hooks';
import { routes } from '@/lib/routes';
import { useApi, useRealtime } from '@/lib/services';
import s from './pvp.module.css';
import h from './hub.module.css';
import { boardSizeRange, creditsAsNear, fmtCountdown, fmtMinSec, nearFixed, nearText, splitRows, splitShare, sumYocto, useNow } from './pvpUtil';

type Mode = 'ranked' | 'casual' | 'draft';
type Phase = 'idle' | 'requesting' | 'searching' | 'found';

/** Agents a crew may field. */
const CAP = 3;

interface QueueError {
  code: string;
  message: string;
}

const NOT_QUEUE_ERRORS = new Set(['not_found', 'too_many_subscriptions']);

const MODE_TABS = [
  { id: 'ranked', label: 'Ranked' },
  { id: 'casual', label: 'Casual' },
  { id: 'draft', label: 'Draft' },
];

const MODE_LABEL: Record<Mode, string> = { ranked: 'Ranked', casual: 'Casual', draft: 'Draft' };

/** Paid season places the Ladder panel lists before the season loads. */
const LADDER_SIZE = 10;

/** "Ranked rotation · all 10 maps · 31×13 to 55×25". */
const ROTATION = `all ${MAPS.length} maps · ${boardSizeRange(MAPS.map((m) => m.A))}`;

/** Why a found match ended before lock-in, as the hub says it once the takeover closes. */
const VOID_COPY: Partial<Record<V2EndReason, string>> = {
  declined: 'Match declined. You are back in the hub.',
  accept_timeout: 'A crew did not accept in time. You are back in the hub.',
};
const VOID_OTHER = 'The match was called off before it started. Queue again when you are ready.';

/** The talk tier an agent plays at: Standard in ranked, its own default in casual. */
const tierOf = (a: Agent, mode: Mode): TalkTier => (mode === 'ranked' ? 'standard' : a.tier);
const TIER_LABEL: Record<TalkTier, string> = { quiet: 'Quiet', standard: 'Standard', open: 'Open' };

export function PvpLobbyScreen() {
  return (
    <RequireSession>
      <Lobby />
    </RequireSession>
  );
}

function record(a: Agent): string {
  if (!a.matchesPlayed) return '0 matches';
  const d = a.draws ? `–${a.draws}` : '';
  return `${a.matchesPlayed} ${a.matchesPlayed === 1 ? 'match' : 'matches'} · ${a.wins}–${a.losses}${d}`;
}

function queueErrorCopy(e: QueueError, names: string): { title: string; message: string; warn?: boolean } {
  switch (e.code) {
    case 'insufficient_credits': {
      const m = /need (\d+), have (\d+)/.exec(e.message);
      return {
        title: 'Not enough credits for this crew',
        message: m ? `Need ${fmt(Number(m[1]))} credits, have ${fmt(Number(m[2]))}. Top up credits, field fewer agents or pick quieter talk.` : 'Top up credits, field fewer agents or pick quieter talk.',
      };
    }
    case 'agent_busy':
      return { title: 'An agent is busy', message: `${names || 'An agent'} is still in a match. Wait for it to end, or pick another agent.`, warn: true };
    case 'in_match':
      return { title: 'You are already in a match', message: 'Wait for it to end, then queue again.', warn: true };
    case 'invalid_crew':
      return { title: 'This crew cannot queue', message: 'Check the agents, then try again.' };
    case 'unavailable':
      return { title: 'Matchmaking is paused', message: 'Try again shortly.' };
    case 'unauthenticated':
    case 'auth_failed':
      return { title: 'Signed out', message: 'Sign in again to queue.' };
    default:
      return { title: 'Could not queue', message: 'Try again in a moment.' };
  }
}

function Lobby() {
  const me = useMe();
  const rt = useRealtime();
  const status = useRealtimeStatus();
  const router = useRouter();
  const qc = useQueryClient();

  const [mode, setMode] = useState<Mode>('ranked');
  const [picked, setPicked] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [qs, setQs] = useState<{ searchingMs: number; eloRange: number; at: number } | null>(null);
  const [error, setError] = useState<QueueError | null>(null);
  // The match the VS takeover is showing, and why the last one closed without starting.
  const [foundId, setFoundId] = useState<string | null>(null);
  const [voided, setVoided] = useState<string | null>(null);
  const found = useV2Match(foundId);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const queued = useRef<Extract<OutgoingMessage, { type: 'v2_queue' }> | null>(null);
  const lastSent = useRef<OutgoingMessage['type'] | null>(null);
  const send = (msg: OutgoingMessage) => {
    lastSent.current = msg.type;
    rt.send(msg);
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  const agents = me.data?.agents ?? [];
  const pickedAgents = picked.map((id) => agents.find((a) => a.id === id)).filter((a): a is Agent => !!a);
  const searching = phase === 'requesting' || phase === 'searching';
  const now = useNow(500, phase === 'searching');

  // Default pick: the first agent once /me is in.
  useEffect(() => {
    if (picked.length === 0 && agents[0]) setPicked([agents[0].id]);
  }, [agents, picked.length]);

  // Leaving the lobby mid-search stops the search (nothing else would follow match_found).
  useEffect(
    () => () => {
      if (phaseRef.current === 'requesting' || phaseRef.current === 'searching') sendRef.current({ type: 'v2_cancel_queue' });
    },
    [rt],
  );

  // A queue entry does not survive a reconnect: queue again once the socket is back.
  const prevStatus = useRef(status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (status === 'open' && prev === 'reconnecting' && queued.current && (phaseRef.current === 'searching' || phaseRef.current === 'requesting')) {
      sendRef.current(queued.current);
      setPhase('requesting');
      setQs(null);
    }
  }, [status, rt]);

  useRealtimeMessage((m) => {
    if (m.type === 'queue_status') {
      if (phaseRef.current !== 'requesting' && phaseRef.current !== 'searching') return;
      setPhase('searching');
      setQs({ searchingMs: m.searchingMs, eloRange: m.eloRange, at: Date.now() });
    } else if (m.type === 'v2_found') {
      // Every tab of the account hears it (and again after a reconnect): the VS takeover opens here,
      // and the match screen takes over once this crew accepts.
      setPhase('found');
      setFoundId(m.matchId);
      setVoided(null);
      setError(null);
      void qc.invalidateQueries({ queryKey: qk.me });
    } else if (m.type === 'error') {
      // Errors of match watches and run subscriptions (other screens' sockets share this one) are
      // not about the queue: the search is still on.
      if (NOT_QUEUE_ERRORS.has(m.code)) return;
      // not_queued answers a cancel; a queue sent after that cancel is still on.
      if (m.code === 'not_queued') {
        if (lastSent.current === 'v2_cancel_queue') setPhase('idle');
        return;
      }
      if (m.code === 'already_queued') return setPhase('searching');
      const always = m.code === 'insufficient_credits' || m.code === 'agent_busy';
      if (!always && phaseRef.current !== 'requesting' && phaseRef.current !== 'searching') return;
      setError({ code: m.code, message: m.message });
      setPhase('idle');
      setQs(null);
    }
  });

  // The found match moves on without the takeover: accepted (here or in another tab) or past
  // accept opens the match screen; a void (declined, not accepted in time) closes it with a line.
  const opened = useRef<string | null>(null);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const foundPhase = found?.phase;
  const foundMine = !!found && found.accepted.includes(found.team);
  useEffect(() => {
    if (!found || phaseRef.current !== 'found') return;
    if (foundPhase === 'ended') {
      setVoided(VOID_COPY[found.end?.reason ?? 'error'] ?? VOID_OTHER);
      setFoundId(null);
      setPhase('idle');
    } else if ((foundMine || foundPhase === 'draft' || foundPhase === 'lockin' || foundPhase === 'live') && opened.current !== found.matchId) {
      opened.current = found.matchId;
      router.push(routes.match(found.matchId));
    }
  }, [found, foundPhase, foundMine, router]);

  const accept = () => {
    if (!found) return;
    send({ type: 'v2_accept', matchId: found.matchId });
    setAcceptedId(found.matchId);
    opened.current = found.matchId;
    router.push(routes.match(found.matchId));
  };

  const decline = () => {
    if (!found) return;
    send({ type: 'v2_decline', matchId: found.matchId });
    setVoided(VOID_COPY.declined!);
    setFoundId(null);
    setPhase('idle');
  };

  // Past the accept window with no word from the server (a lost socket): close the takeover.
  const foundNow = useNow(1000, !!found && found.phase === 'found' && !foundMine);
  const foundStale = !!found && found.phase === 'found' && !foundMine && foundNow > found.acceptBy + 5000;
  useEffect(() => {
    if (!foundStale || phaseRef.current !== 'found') return;
    setVoided(VOID_COPY.accept_timeout!);
    setFoundId(null);
    setPhase('idle');
  }, [foundStale]);

  const cap = CAP;
  // The lobby queues Normal (the ranked clock) in both modes.
  const pickedTiers = pickedAgents.map((a) => ({ tier: tierOf(a, mode) }));
  const perTick = ratePerTick(pickedTiers.map((a) => a.tier));
  const hold = holdFor(pickedTiers, mode === 'ranked', DIFF_MODS[RANKED_DIFFICULTY].ticks);
  const short = !!me.data && pickedAgents.length > 0 && me.data.credits.available < hold;
  const rating = me.data?.rank.elo ?? 1200;

  const chooseMode = (r: Mode) => {
    if (searching) return;
    setMode(r);
    setError(null);
  };

  const toggle = (id: string) => {
    if (searching) return;
    setError(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= cap ? [...p.slice(1), id] : [...p, id]));
  };

  const findMatch = () => {
    if (!pickedAgents.length || pickedAgents.length > cap) return;
    setVoided(null);
    const crew = pickedAgents.map((a) => ({ agentId: a.id, tier: tierOf(a, mode) }));
    const msg: Extract<OutgoingMessage, { type: 'v2_queue' }> = { type: 'v2_queue', ranked: mode === 'ranked', crew, ...(mode === 'draft' ? { draft: true } : {}) };
    queued.current = msg;
    // The match screen's lock-in starts from these names and tiers.
    v2StoreFor(rt).queued = pickedAgents.map((a) => ({ agentId: a.id, name: a.name, tier: tierOf(a, mode) }));
    setError(null);
    setQs(null);
    setPhase('requesting');
    send(msg);
  };

  const cancel = () => {
    send({ type: 'v2_cancel_queue' });
    setPhase('idle');
    setQs(null);
  };

  // Esc cancels a search from anywhere on the page (focus leaves the Find match button).
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    if (!searching) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searching]);

  const searchMs = qs ? qs.searchingMs + Math.max(0, now - qs.at) : 0;
  const names = pickedAgents.map((a) => a.name).join(' and ');
  const skills = [...new Set(pickedAgents.flatMap((a) => a.skills.map((k) => k.name)))];
  const errCopy = error ? queueErrorCopy(error, names) : null;

  const rank = me.data?.rank;
  const title = rank?.title;
  const nextAt = rankTitle(rating).nextAt;
  const position = rank?.position ?? null;
  const season = useCurrentSeason();
  const seasonN = season.data?.season.number;
  const takeover = phase === 'found' && found?.phase === 'found' && !foundMine && acceptedId !== found.matchId ? found : null;
  // The takeover is decided with its buttons: Esc must not take the shell Back under it.
  useEscapeLayer('takeover', !!takeover);

  return (
    <div className={h.hub} data-testid="screen-s11">
      <h1 className="sk-sr-only">Skirmish</h1>
      <div className={h.side}>
        <section className={`sk-panel ${h.rank}`} aria-label="Your rank" data-rise>
          <span className={`sk-kick ${h.seasonKick}`} data-testid="s11-season">
            <b>Ranked</b> · Season {seasonN ?? '…'}
          </span>
          <div className={h.emblem} data-testid="s11-elo">
            <span>{me.data ? fmt(rating) : '…'}</span>
          </div>
          <div className={`sk-disp ${h.title}`} data-testid="s11-title">
            {me.data ? title : '…'}
          </div>
          {me.data && nextAt !== null ? <div className="sk-kick">Next title at {fmt(nextAt)} Elo</div> : null}
          <div className={h.statrow}>
            <div>
              <small>W</small>
              <b>{rank?.wins ?? 0}</b>
            </div>
            <div>
              <small>L</small>
              <b>{rank?.losses ?? 0}</b>
            </div>
            <div>
              <small>Rank</small>
              <b data-testid="s11-position">{position ? `#${position}` : '—'}</b>
            </div>
          </div>
          <EarnBackPanel />
          <span className={h.chip} data-testid="s11-credits-chip">
            <Icon name="credits" size={14} />
            {me.data ? `${fmt(me.data.credits.available)} credits to spend` : 'Credits…'}
          </span>
        </section>

        <section aria-labelledby="s11-pick" className={`sk-panel ${h.crew}`} data-rise style={{ '--rise-i': 1 } as CSSProperties}>
          <div className={h.crewHead}>
            <h2 id="s11-pick" className={h.panelH}>
              Pick up to {cap} agents
            </h2>
          </div>
          <div data-testid="s11-ranked">
            <Tabs tabs={MODE_TABS.map((t) => ({ ...t, disabled: searching }))} value={mode} onChange={(id) => chooseMode(id as Mode)} label="Mode" />
          </div>
          {me.data === undefined ? (
            me.isError ? (
              <QueryView query={me}>{() => null}</QueryView>
            ) : (
              <Skeleton rows={3} label="Loading agents" />
            )
          ) : agents.length === 0 ? (
            <EmptyState>No agents on this account yet.</EmptyState>
          ) : (
            <div role="group" aria-label={`Agents, up to ${cap}`} className={h.agents}>
              {agents.map((a) => {
                const on = picked.includes(a.id);
                return (
                  <button
                    key={a.id}
                    id={`s11-agent-${a.id}`}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={h.agent}
                    disabled={searching}
                    onClick={() => toggle(a.id)}
                    data-testid={`s11-agent-${a.name.toLowerCase()}`}
                  >
                    <b>{a.name}</b>
                    <span className={h.agentMeta}>
                      {a.role} · vision {a.vision} · comms {a.comms} · {TIER_LABEL[tierOf(a, mode)]}
                    </span>
                    <span className={h.agentMeta}>{record(a)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <p className={h.note}>
            {skills.length ? `${skills.join(', ')} · equipped on ${names}` : `No skills equipped${names ? ` on ${names}` : ''}`}
          </p>
        </section>
      </div>

      <section className={h.queue} aria-labelledby="s11-queue" aria-live="polite" data-testid="s11-queue">
        <span className="sk-kick" data-testid="s11-rotation">
          {MODE_LABEL[mode]} rotation · <b>{ROTATION}</b>
        </span>
        <h2 id="s11-queue" className="sk-sr-only">
          {phase === 'found' ? 'Match found' : searching ? 'Finding a match' : 'Skirmish'}
        </h2>
        {voided ? (
          <div className="app-banner is-warning" role="status" data-testid="s11-vs-void">
            {voided}
          </div>
        ) : null}
        {status === 'reconnecting' ? (
          <div className="app-banner is-warning" role="status" data-testid="s11-reconnecting">
            Reconnecting...{searching ? ' Your search starts again when the connection is back.' : ''}
          </div>
        ) : null}

        {phase === 'found' ? (
          <div className={`${h.qbtn} ${h.found}`} data-testid="s11-match-found">
            <QueueRing spinning={false} />
            <span className={h.qlbl}>
              Match
              <br />
              found
              <small>OPENING THE MATCH</small>
            </span>
          </div>
        ) : searching ? (
          <button type="button" className={`${h.qbtn} ${h.searching}`} onClick={cancel} aria-label="Searching. Cancel the search">
            <QueueRing spinning />
            <span className={h.qlbl}>
              <span className="sk-mono" role="timer" aria-label={`Searching for ${fmtMinSec(searchMs)}`} data-testid="s11-searching-time">
                {fmtMinSec(searchMs)}
              </span>
              <small>SEARCHING · TAP TO CANCEL</small>
            </span>
          </button>
        ) : short ? (
          <ButtonLink variant="primary" size="lg" href={routes.credits()} data-testid="s11-topup">
            Top up to play
          </ButtonLink>
        ) : (
          <button
            type="button"
            className={h.qbtn}
            onClick={findMatch}
            disabled={!pickedAgents.length || status === 'reconnecting'}
            data-testid="s11-find-match"
          >
            <QueueRing spinning={false} />
            <span className={h.qlbl}>
              Find
              <br />
              match
              <small>{MODE_LABEL[mode].toUpperCase()} · 2 CREWS</small>
            </span>
          </button>
        )}
        {searching ? (
          <Button size="sm" variant="secondary" onClick={cancel} data-testid="s11-cancel">
            Cancel · Esc
          </Button>
        ) : null}

        {errCopy ? (
          <div className={`${h.alert} ${errCopy.warn ? h.alertWarn : ''}`} role="alert" data-testid="s11-queue-error">
            <p className={h.alertTitle}>{errCopy.title}</p>
            <p>{errCopy.message}</p>
            <div className="app-row app-wrap">
              {error?.code === 'insufficient_credits' ? (
                <ButtonLink size="sm" variant="primary" href={routes.credits()} icon="credits">
                  Top up credits
                </ButtonLink>
              ) : null}
              <details>
                <summary>Details</summary>
                <code>{error?.code}</code>
              </details>
            </div>
          </div>
        ) : null}

        <dl className={h.rules}>
          <dt>WIN</dt>
          <dd>
            Two crews share one mirrored map. First to deliver the goal wins; at time-out, more delivered, then fewer agents, then earlier.{' '}
            {mode === 'ranked' ? (
              'Ranked always plays Normal.'
            ) : (
              <>
                Casual plays Normal here; pick a map and difficulty in the <Link href={routes.atlas()}>atlas</Link>.
              </>
            )}
          </dd>
          {mode === 'draft' ? (
            <>
              <dt>DRAFT</dt>
              <dd data-testid="s11-draft-rules">
                After accept each crew bans {DEFAULTS.draft.bansPerSide === 1 ? 'one' : DEFAULTS.draft.bansPerSide} of the rival&apos;s equipped skills, in turn ({Math.round(DEFAULTS.draft.stepMs / 1000)} s a
                ban, or it passes). A banned skill is unequipped from the rival crew for that match. Casual: no Elo.
              </dd>
            </>
          ) : null}
          <dt>TALK</dt>
          <dd>
            {mode === 'ranked' ? 'Standard tier for both crews.' : 'Each agent at its own talk tier.'} Say reaches agents in range; team reaches teammates
            anywhere, but rivals near the speaker overhear it.
          </dd>
          <dt>CREW</dt>
          <dd>
            {names || 'None picked'} · your Elo {fmt(rating)}. Up to 3 agents; the larger crew waits 5 ticks per extra agent.
          </dd>
          <dt>ELO RANGE</dt>
          <dd className="sk-mono" data-testid="s11-elo-range">
            {qs ? `${fmt(Math.max(DEFAULTS.elo.floor, rating - qs.eloRange))} – ${fmt(rating + qs.eloRange)}` : searching ? 'Starting search' : 'Widens the longer you search'}
          </dd>
          <dt>COST</dt>
          <dd data-testid="s11-cost">
            Holds {fmt(hold)} credits · {fmtRate(perTick)} per tick at the talk tiers{mode === 'ranked' ? ' (Standard in ranked)' : ''} · unused credits return
          </dd>
          <dt>TICKS</dt>
          <dd>2 s ticks · 1.5 s to act, or the agent waits · 150 ticks (5:00)</dd>
        </dl>
        <p className={h.note}>
          When a rival is found you have 10 s to accept, then 30 s to lock in talk tiers.
          {me.data ? (
            <>
              {' '}
              You can spend <span className="sk-mono">{fmt(me.data.credits.available)}</span> credits now.
            </>
          ) : null}
        </p>
      </section>

      <div className={`${h.side} ${h.right}`}>
        <PoolPanel season={season} />
        <Ladder season={season} />
        <LiveNow />
      </div>

      {takeover ? (
        <VsTakeover view={takeover} handle={me.data?.account.handle ?? 'You'} elo={rating} agents={agents} onAccept={accept} onDecline={decline} />
      ) : null}
    </div>
  );
}

function QueueRing({ spinning }: { spinning: boolean }) {
  return (
    <svg viewBox="0 0 260 260" aria-hidden="true">
      <circle className={h.ring} cx="130" cy="130" r="120" fill="none" stroke="rgba(140,175,200,.36)" strokeWidth="2" />
      <g className={spinning ? h.spin : undefined}>
        <circle cx="130" cy="130" r="104" fill="none" stroke="#ff4655" strokeWidth="3" strokeDasharray="60 594" />
      </g>
      <circle cx="130" cy="130" r="92" fill="rgba(255,70,85,.08)" stroke="rgba(255,70,85,.5)" />
    </svg>
  );
}

/**
 * What the player got back: skill sales and royalties, season prizes won (all real), and credits
 * spent on matches (at the server's credits per NEAR), and what agent rentals earned after the fee.
 */
function EarnBackPanel() {
  const api = useApi();
  const earn = useQuery({ queryKey: qk.earnBack, queryFn: () => api.earnBack() });
  return (
    <section className={h.earn} aria-labelledby="s11-earn" data-testid="s11-earn">
      <h2 id="s11-earn" className={`sk-kick ${h.earnH}`}>
        Earn-back so far
      </h2>
      <QueryView query={earn} loading={<Skeleton rows={4} label="Loading earn-back" />}>
        {(d) => <EarnRows d={d} />}
      </QueryView>
    </section>
  );
}

function EarnRows({ d }: { d: EarnBack }) {
  const sales = sumYocto(d.royaltiesYocto, d.salesNetYocto);
  const spent = creditsAsNear(d.spentCredits, d.creditsPerNear);
  return (
    <dl className={h.split}>
      <div>
        <dt>Season prizes</dt>
        <dd data-testid="s11-earn-prizes">{nearText(d.prizesYocto)}</dd>
      </div>
      <div>
        <dt>Skill sales + royalties</dt>
        <dd data-testid="s11-earn-sales">{nearFixed(sales)} NEAR</dd>
      </div>
      <div>
        <dt>Agent rentals</dt>
        <dd data-testid="s11-earn-rentals">{d.rentalsYocto === null ? 'Not offered yet' : nearText(d.rentalsYocto)}</dd>
      </div>
      <div>
        <dt>Credits spent on matches</dt>
        <dd className={d.spentCredits > 0 ? h.spent : undefined} data-testid="s11-earn-spent" title={`${fmt(d.spentCredits)} credits`}>
          {d.spentCredits > 0 ? '−' : ''}
          {spent} NEAR
        </dd>
      </div>
    </dl>
  );
}

type SeasonQuery = ReturnType<typeof useCurrentSeason>;

/** The season's prize pool ("local" while offchain), its split and the time left. */
function PoolPanel({ season }: { season: SeasonQuery }) {
  const d = season.data?.season;
  const now = useNow(1000, d?.status === 'open');
  return (
    <section className={`sk-panel ${h.pool}`} aria-labelledby="s11-pool" data-rise style={{ '--rise-i': 1 } as CSSProperties}>
      <span id="s11-pool" className="sk-kick">
        Season {d?.number ?? '…'} prize pool · 30% of fees
      </span>
      <QueryView query={season} loading={<Skeleton rows={3} label="Loading the season" />}>
        {({ season: ssn }) => {
          const left = Date.parse(ssn.endsAt) - now;
          return (
            <>
              <div className={h.poolN} data-testid="s11-pool">
                <span className="sk-disp">{nearText(ssn.poolYocto)}</span>
                {ssn.poolSource === 'local' ? (
                  <span className={h.chip} title="Kept offchain until the seasons contract is deployed" data-testid="s11-pool-local">
                    local
                  </span>
                ) : null}
              </div>
              <span className="sk-kick">Paid in NEAR to the top {ssn.splitBps.length} when the season ends</span>
              <dl className={h.split}>
                {splitRows(ssn.splitBps).map(([a, b]) => (
                  <div key={a}>
                    <dt>{a}</dt>
                    <dd>{b}</dd>
                  </div>
                ))}
                <div>
                  <dt>Ends in</dt>
                  <dd className="sk-mono" data-testid="s11-pool-ends">
                    {ssn.status === 'open' ? (left > 0 ? fmtCountdown(left) : 'Ending now') : 'Ended'}
                  </dd>
                </div>
              </dl>
            </>
          );
        }}
      </QueryView>
    </section>
  );
}

/** The season's top 10 (the paid places): place, handle, points and the place's share of the pool. */
function Ladder({ season }: { season: SeasonQuery }) {
  return (
    <section className="sk-panel" aria-labelledby="s11-ladder" data-testid="s11-ladder" data-rise style={{ '--rise-i': 2 } as CSSProperties}>
      <span id="s11-ladder" className="sk-kick">
        <b>Season {season.data?.season.number ?? '…'}</b> · top {season.data?.season.splitBps.length ?? LADDER_SIZE} paid
      </span>
      <QueryView
        query={season}
        loading={<Skeleton rows={5} label="Loading the standings" />}
        empty={(d) => d.top.length === 0 && <p className={h.note}>No ranked matches this season yet. Win one to take the first place.</p>}
      >
        {(d: CurrentSeason) => {
          const you = d.you && !d.top.some((r) => r.account.id === d.you!.account.id) ? d.you : null;
          return (
            <ol className={h.board}>
              {d.top.map((r) => (
                <LadderRow key={r.account.id} r={r} split={d.season.splitBps} you={r.account.id === d.you?.account.id} />
              ))}
              {you ? <LadderRow r={you} split={d.season.splitBps} you gap /> : null}
            </ol>
          );
        }}
      </QueryView>
      <Link href={routes.leaderboards()} className={h.more} data-testid="s11-ladder-more">
        Season standings ▸
      </Link>
    </section>
  );
}

function LadderRow({ r, split, you, gap = false }: { r: Standing; split: readonly number[]; you: boolean; gap?: boolean }) {
  const share = splitShare(split, r.rank);
  return (
    <li
      className={[you ? h.you : '', gap ? h.gap : ''].filter(Boolean).join(' ') || undefined}
      title={`${fmt(r.points)} points · ${r.wins}–${r.losses}–${r.draws} · Elo ${fmt(r.elo)}`}
      data-testid={`s11-ladder-${r.rank}`}
    >
      <span className={h.p}>{String(r.rank).padStart(2, '0')}</span>
      <b>{r.account.handle}</b>
      <span className={h.e}>{fmt(r.points)} pts</span>
      <span className={h.pz}>{share === null ? '—' : `${share}%`}</span>
    </li>
  );
}

/**
 * The VS takeover on v2_found (the prototype's .vs): your handle, Elo and crew faces against a
 * hidden rival, the map, and Accept with the seconds left. The rival's crew stays hidden until both
 * lock in.
 */
function VsTakeover({
  view,
  handle,
  elo,
  agents,
  onAccept,
  onDecline,
}: {
  view: V2MatchView;
  handle: string;
  elo: number;
  agents: Agent[];
  onAccept: () => void;
  onDecline: () => void;
}) {
  const map = mapById(view.mapId);
  const diff = !view.ranked && view.difficulty ? DIFFS[diffIndex(view.difficulty)] : undefined;
  const crew = (view.crew ?? []).map((c) => ({ c, a: agents.find((a) => a.id === c.agentId) }));
  const now = useNow(250);
  const left = Math.max(0, Math.ceil((view.acceptBy - now) / 1000));
  const over = left === 0;
  return (
    <div className={h.vs} role="dialog" aria-modal="true" aria-labelledby="s11-vs-title" data-testid="s11-vs">
      <p className={h.vsFound}>
        <span id="s11-vs-title" className={`sk-kick ${h.vsAmber}`}>
          Match found · {view.ranked ? 'ranked' : 'casual'} · {map ? `${map.code} ${map.name}` : view.mapId}
          {diff ? ` · ${diff.n}` : ''}
        </span>
      </p>
      <div className={`${h.vside} ${h.vsA}`}>
        <span className="sk-kick">
          <b>You</b> · Elo {fmt(elo)}
        </span>
        <span className="sk-disp">{handle}</span>
        <div className={h.faces} data-testid="s11-vs-faces-you">
          {crew.map(({ c, a }) => (
            <AgentPortrait
              key={c.agentId}
              body={OUTFIT_COLORS[a?.appearance.outfit ?? 0] ?? OUTFIT_COLORS[0]!}
              head={SKIN_TONES[a?.appearance.skin ?? 0] ?? SKIN_TONES[0]!}
              team="A"
              label={`${c.name}, ${a?.role ?? 'agent'}`}
              className={h.face}
            />
          ))}
        </div>
      </div>
      <div className={h.vsMid}>
        <span className={`sk-disp ${h.vsWord}`} aria-hidden="true">
          VS
        </span>
        <Button variant="danger" size="lg" onClick={onAccept} disabled={over} autoFocus data-testid="s11-vs-accept">
          Accept
          <span className={`sk-mono ${h.vsLeft}`} role="timer" aria-label={`${left} seconds left`}>
            {left}
          </span>
        </Button>
        <Button variant="ghost" size="sm" onClick={onDecline} disabled={over} data-testid="s11-vs-decline">
          Decline
        </Button>
      </div>
      <div className={`${h.vside} ${h.vsB}`}>
        <span className="sk-kick">
          <span className="is-rival">Rival</span> · {view.accepted.includes(other(view.team)) ? 'accepted' : 'deciding'}
        </span>
        <span className="sk-disp">Rival</span>
        <div className={h.faces} role="img" aria-label="Rival crew hidden" data-testid="s11-vs-faces-rival">
          <span className="sk-kick">? · ? · ?</span>
        </div>
      </div>
      <p className={h.vsMapline}>
        <span className="sk-kick">Rival crew is hidden until both lock in</span>
      </p>
    </div>
  );
}

function LiveNow() {
  const live = useV2LiveMatches();
  return (
    <section aria-labelledby="s11-live" className="sk-panel" data-testid="s11-live" data-rise style={{ '--rise-i': 3 } as CSSProperties}>
      <h2 id="s11-live" className={`sk-kick ${h.panelKick}`}>
        Live now
      </h2>
      <QueryView
        query={live}
        loading={<Skeleton rows={6} label="Loading live matches" />}
        empty={(d) => d.length === 0 && <EmptyState>No live matches right now. Find a match to start one.</EmptyState>}
      >
        {(rows) => (
          <ul className={s.list}>
            {rows.map((m) => (
              <LiveRow key={m.id} m={m} />
            ))}
          </ul>
        )}
      </QueryView>
    </section>
  );
}

const crewLine = (t: V2LiveMatch['teams']['A'], side: 'A' | 'B') => `${t.handle ?? `Crew ${side}`} · ${t.size} ${t.size === 1 ? 'agent' : 'agents'}`;

function LiveRow({ m }: { m: V2LiveMatch }) {
  const now = useNow(1000);
  const map = mapById(m.mapId);
  const diff = !m.ranked && m.difficulty ? DIFFS[diffIndex(m.difficulty)]?.n : undefined;
  const started = m.startedAt ? Date.parse(m.startedAt) : null;
  const elapsed = started ? fmtMinSec(Math.max(0, now - started)) : '';
  const a = crewLine(m.teams.A, 'A');
  const b = crewLine(m.teams.B, 'B');
  return (
    <li className={s.liveRow} data-testid={`s11-live-${m.id}`}>
      <span className={s.vs}>
        <span className={s.letterA}>A</span>
        {a}
        <span className={s.vsMuted}>vs</span>
        <span className={s.letterB}>B</span>
        {b}
        {m.practice ? (
          <Badge icon={false} data-testid={`s11-live-practice-${m.id}`}>
            Practice
          </Badge>
        ) : null}
      </span>
      <span className={s.meta}>
        {[map ? `${map.code} ${map.name}` : m.mapId, m.practice ? 'practice' : m.ranked ? 'ranked' : 'casual', diff, elapsed].filter(Boolean).join(' · ')}
      </span>
      <Link href={routes.match(m.id)} className={s.watch} aria-label={`Watch ${a} vs ${b}`}>
        <Icon name="play" size={14} />
        Watch
      </Link>
    </li>
  );
}
