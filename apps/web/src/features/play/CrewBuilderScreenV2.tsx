'use client';
// S04 for the v2 maps (/maps/[mapId]/crew?d=<difficulty>): the prototype's #s-crew before a match.
// Left: one card per agent (portrait, role, verb fit on this map, skill, vision and comms, talk
// tier and, when the operator offers several (GET /v2/models), the model) with the editor a click
// away, and the roster strip (up to 3). Right: Ranked / Unranked, the difficulty picker and its goal
// on this map (ranked locks Normal), the credit estimate (clock × Σ rate, each agent's tier rate
// scaled by its model's multiplier) and the queue button. Ranked plays the default model at 1.0x.
// Unranked queues a casual match on this map at this difficulty (`v2_queue { mapId, difficulty }`,
// only matching entries pair); Ranked queues the ranked ladder, which draws its own map. On
// `v2_found` the match screen takes over (accept, lock-in, live) with this crew as the queued one.
// "Vs Greedy bot" (on from Practice, `?opponent=bot`) queues practice against the bot instead
// (`v2_queue { opponent: 'bot' }`): no matchmaking, it starts at once, and it may queue past the
// hold, since the server decides whether practice costs anything (free on its offline brain).
// PRACTICE_MAPS are marked quick: greedy against greedy plays them out cleanly.
import { BOT_HANDLE, DIFF_MODS, DIFFICULTIES, RANKED_DIFFICULTY, agentRatePer100, holdFor, isCommunityMapId, isDifficulty, isPracticeMap, type Difficulty, type TalkTier } from '@skirm/engine/v2';
import { Button, fmt } from '@skirm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CreditEstimate, CrewCard, DifficultyPicker, EmptySlot, GoalBox, RosterStrip } from '@/features/agents/CrewParts';
import { HEAD_START_S_PER_AGENT, agentEditorHref, clock } from '@/features/agents/agentView';
import { PlaybooksSection } from '@/features/agents/Playbooks';
import c from '@/features/agents/crew.module.css';
import { arenaStore } from '@/features/arena/store';
import { DIFFS, MAPS, diffIndex, mapById } from '@/features/arena/world';
import { useMapById } from '@/features/maps/hooks';
import { useNow } from '@/features/pvp/pvpUtil';
import { v2StoreFor } from '@/features/v2/v2Store';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { qk, useMe } from '@/lib/api/queries';
import type { Agent, Me } from '@/lib/api/types';
import type { OutgoingMessage } from '@/lib/realtime/client';
import { useRealtimeMessage, useRealtimeStatus } from '@/lib/realtime/hooks';
import { routes } from '@/lib/routes';
import { useApi, useRealtime } from '@/lib/services';
import styles from './play.module.css';
import { RentShelf, passesByAgent, rentedAgent } from './RentShelf';
import { matchOrigin } from '@/lib/match-origin';

/** Agents a crew may field. */
export const CREW_CAP = 3;

type Mode = 'ranked' | 'casual';
type Phase = 'idle' | 'requesting' | 'searching' | 'found';
type QueueMessage = Extract<OutgoingMessage, { type: 'v2_queue' }>;

/** Errors of other screens' watches on the shared socket, not about the queue. */
const NOT_QUEUE_ERRORS = new Set(['not_found', 'too_many_subscriptions']);

function queueErrorCopy(code: string): { title: string; message: string } {
  switch (code) {
    case 'insufficient_credits':
      return { title: 'Not enough credits for this crew', message: 'Top up credits, field fewer agents or pick quieter talk.' };
    case 'agent_busy':
      return { title: 'An agent is busy', message: 'It is still in a match. Wait for it to end, or pick another agent.' };
    case 'in_match':
      return { title: 'You are already in a match', message: 'Wait for it to end, then queue again.' };
    case 'invalid_crew':
      return { title: 'This crew cannot queue', message: 'Check the agents, then try again.' };
    case 'unavailable':
      return { title: 'Matchmaking is paused', message: 'Try again shortly.' };
    default:
      return { title: 'Could not queue', message: 'Try again in a moment.' };
  }
}

/** S04: the crew screen of /maps/[mapId]/crew, behind a session. `difficulty`: the URL's `?d=`. */
export function V2CrewScreen({ mapId, difficulty }: { mapId: string; difficulty?: string }) {
  return (
    <div data-testid="screen-s04" className={styles.page}>
      <RequireSession>
        <V2CrewData mapId={mapId} difficulty={difficulty} />
      </RequireSession>
    </div>
  );
}

function V2CrewData({ mapId, difficulty }: { mapId: string; difficulty?: string }) {
  const me = useMe();
  const vsBot = useSearchParams().get('opponent') === 'bot';
  // A community map is fetched first (and registered, so mapById finds it below).
  const { map, loading } = useMapById(mapId);
  if (loading) return <Skeleton rows={6} label="Loading map" />;
  if (!map)
    return (
      <EmptyState action={<ButtonLink href={routes.atlas()}>Back to the atlas</ButtonLink>}>This map does not exist or was removed.</EmptyState>
    );
  if (me.data === undefined)
    return me.isError ? <ErrorCard error={me.error} onRetry={() => void me.refetch()} /> : <Skeleton rows={6} label="Loading crew" />;
  if (!me.data.agents.length) return <EmptyState action={<ButtonLink href={routes.home()}>Back to Play</ButtonLink>}>No agents on this account yet.</EmptyState>;
  return <V2Crew me={me.data} mapId={mapId} initialDifficulty={isDifficulty(difficulty) ? difficulty : RANKED_DIFFICULTY} initialBot={vsBot} />;
}

function V2Crew({ me, mapId, initialDifficulty, initialBot }: { me: Me; mapId: string; initialDifficulty: Difficulty; initialBot: boolean }) {
  const api = useApi();
  const rt = useRealtime();
  const status = useRealtimeStatus();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const map = mapById(mapId)!;
  const written = useQuery({ queryKey: qk.skills.list('written'), queryFn: () => api.skills('written') });
  // Agents rented for one match join the player's own (RentShelf); unused passes only.
  const rentals = useQuery({ queryKey: qk.myRentals, queryFn: () => api.myRentals(), retry: false });
  const passes = useMemo(() => rentals.data?.passes ?? [], [rentals.data]);
  const byId = useMemo(() => new Map([...me.agents, ...passesByAgent(passes).map(rentedAgent)].map((a) => [a.id, a])), [me.agents, passes]);
  // The model catalog; unanswered (or one model) shows no model choice and plays the default.
  const catalog = useQuery({ queryKey: qk.v2Models, queryFn: () => api.v2Models(), retry: false, staleTime: 5 * 60_000 });
  const models = catalog.data?.models ?? [];

  // The arena behind the screen is this map.
  useEffect(() => {
    const idx = MAPS.findIndex((m) => m.id === mapId);
    if (idx >= 0) arenaStore().setMap(idx);
  }, [mapId]);

  const [mode, setMode] = useState<Mode>('casual');
  const [vsBot, setVsBot] = useState(initialBot);
  const [di, setDi] = useState(() => diffIndex(initialDifficulty));
  const [crew, setCrew] = useState<string[]>(() => me.agents.slice(0, 1).map((a) => a.id));
  const [tiers, setTiers] = useState<Record<string, TalkTier>>(() => Object.fromEntries(me.agents.map((a) => [a.id, a.tier])));
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [qs, setQs] = useState<{ searchingMs: number; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Community maps play practice and casual only. */
  const community = isCommunityMapId(mapId);
  const ranked = mode === 'ranked' && !community;
  /** Practice against the greedy bot: casual only. */
  const practice = !ranked && vsBot;
  const quick = isPracticeMap(mapId);
  const difficulty: Difficulty = ranked ? RANKED_DIFFICULTY : (DIFFICULTIES[di] ?? RANKED_DIFFICULTY);
  const diff = DIFFS[diffIndex(difficulty)]!;
  const ticks = DIFF_MODS[difficulty].ticks;
  const tierOf = (id: string): TalkTier => (ranked ? 'standard' : (tiers[id] ?? 'standard'));
  /** The agent's catalog model when not the default (never in ranked). */
  const modelOf = (id: string) => (ranked || models.length < 2 ? undefined : models.slice(1).find((m) => m.id === picks[id]));
  const priced = (id: string) => ({ tier: tierOf(id), ...(modelOf(id) ? { rateBps: modelOf(id)!.rateMultiplierBps } : {}) });
  const rates = crew.map((id) => agentRatePer100(priced(id), ranked) / 100);
  const hold = holdFor(crew.map(priced), ranked, ticks);
  const short = me.credits.available < hold;
  const searching = phase === 'requesting' || phase === 'searching';
  const busy = searching || phase === 'found';
  const now = useNow(500, phase === 'searching');
  const mine = (skillId: string | undefined) => (skillId && written.data ? written.data.some((s) => s.id === skillId) : null);

  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const queued = useRef<QueueMessage | null>(null);
  const lastSent = useRef<OutgoingMessage['type'] | null>(null);
  const send = (msg: OutgoingMessage) => {
    lastSent.current = msg.type;
    rt.send(msg);
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  // Leaving mid-search stops the search (nothing else would follow v2_found).
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
  }, [status]);

  useRealtimeMessage((m) => {
    if (m.type === 'queue_status') {
      if (phaseRef.current !== 'requesting' && phaseRef.current !== 'searching') return;
      setPhase('searching');
      setQs({ searchingMs: m.searchingMs, at: Date.now() });
    } else if (m.type === 'v2_found') {
      setPhase('found');
      void qc.invalidateQueries({ queryKey: qk.me });
      matchOrigin.set(m.matchId, { kind: 'command' });
      router.push(routes.match(m.matchId));
    } else if (m.type === 'error') {
      if (NOT_QUEUE_ERRORS.has(m.code)) return;
      if (m.code === 'not_queued') {
        if (lastSent.current === 'v2_cancel_queue') setPhase('idle');
        return;
      }
      if (m.code === 'already_queued') return setPhase('searching');
      if (phaseRef.current !== 'requesting' && phaseRef.current !== 'searching') return;
      setError(m.code);
      setPhase('idle');
      setQs(null);
    }
  });

  const pickDifficulty = (i: number) => {
    setDi(i);
    setError(null);
    const k = DIFFICULTIES[i];
    if (k) router.replace(vsBot ? routes.practice({ mapId, difficulty: k }) : routes.crew(mapId, k), { scroll: false });
  };
  const remove = (id: string) => {
    if (crew.length <= 1) return toast.show({ tone: 'warning', title: 'A crew needs at least one agent.' });
    setCrew((p) => p.filter((x) => x !== id));
  };
  const toggle = (id: string) => {
    setError(null);
    if (crew.includes(id)) return remove(id);
    if (crew.length >= CREW_CAP) return toast.show({ tone: 'warning', title: 'Your crew is full.' });
    setCrew((p) => [...p, id]);
  };
  const focusRoster = () => document.getElementById('s04-roster')?.querySelector('button')?.focus();

  const queue = () => {
    if (!crew.length || busy) return;
    const entries = crew.map((id) => ({ agentId: id, tier: tierOf(id), ...(modelOf(id) ? { model: modelOf(id)!.id } : {}) }));
    const msg: QueueMessage = ranked
      ? { type: 'v2_queue', ranked: true, crew: entries }
      : { type: 'v2_queue', ranked: false, crew: entries, mapId, difficulty, ...(practice ? { opponent: 'bot' as const } : {}) };
    queued.current = msg;
    // The match screen's lock-in starts from these names and tiers.
    v2StoreFor(rt).queued = crew.map((id) => {
      const m = modelOf(id);
      return { agentId: id, name: byId.get(id)?.name ?? 'Agent', tier: tierOf(id), ...(m ? { model: m.id, rateBps: m.rateMultiplierBps } : {}) };
    });
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

  const searchMs = qs ? qs.searchingMs + Math.max(0, now - qs.at) : 0;
  const err = error ? queueErrorCopy(error) : null;
  const from = { mapId, difficulty };

  return (
    <div className={c.wrap}>
      <div className={c.main}>
        <header className={c.head}>
          <div>
            <span className="sk-kick" data-testid="s04-map-line">
              <b>{map.code}</b> · {map.name} · {ranked ? 'ranked · map drawn at the start' : practice ? `practice vs ${BOT_HANDLE}` : 'unranked'} ·{' '}
              <span style={{ color: diff.c }}>{diff.n}</span>
              {quick && !ranked ? (
                <>
                  {' · '}
                  <b title="Greedy against greedy plays this map out cleanly, usually well inside the clock" data-testid="s04-quick">
                    quick
                  </b>
                </>
              ) : null}
            </span>
            <h1 className={`sk-disp ${c.title}`}>{ranked ? 'Lock in your crew' : 'Build your crew'}</h1>
          </div>
        </header>
        <div className={c.squad}>
          {Array.from({ length: CREW_CAP }, (_, i) => {
            const id = crew[i];
            if (!id) return <EmptySlot key={`empty-${i}`} index={i} onAdd={focusRoster} disabled={busy} />;
            const a = byId.get(id) as Agent;
            return (
              <CrewCard
                key={id}
                name={a.name}
                agent={a}
                map={map}
                tier={tierOf(id)}
                ranked={ranked}
                disabled={busy}
                skillMine={mine(a.skills[0]?.id)}
                onTier={(t) => setTiers((p) => ({ ...p, [id]: t }))}
                model={{ models, value: modelOf(id)?.id ?? models[0]?.id ?? '', onChange: (m) => setPicks((p) => ({ ...p, [id]: m })) }}
                onRemove={() => remove(id)}
                editHref={busy || !me.agents.some((x) => x.id === id) ? undefined : agentEditorHref(id, from)}
                index={i}
                data-testid={`s04-card-${id}`}
              />
            );
          })}
        </div>
        <RosterStrip agents={me.agents} picked={crew} onToggle={toggle} disabled={busy} testPrefix="s04" />
        <RentShelf passes={passes} picked={crew} onToggle={toggle} disabled={busy} nearId={me.account.nearAccountId} />
        <PlaybooksSection />
      </div>

      <aside className={c.side}>
        <div className={`sk-panel ${c.panel}`}>
          <span className="sk-kick">Mode</span>
          <div className={c.seg} role="group" aria-label="Mode" data-testid="s04-mode">
            {(community ? (['casual'] as const) : (['ranked', 'casual'] as const)).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                disabled={busy}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
              >
                {m === 'ranked' ? 'Ranked' : 'Unranked'}
              </button>
            ))}
          </div>
          <p className={c.note}>
            {ranked
              ? `Talk is locked to Standard for both crews: one message every 5 ticks, 120 characters.${models.length > 1 ? ' Every agent plays the default model.' : ''} Results count for Elo and the season.`
              : `Pick any talk tier${models.length > 1 ? ' and model' : ''} per agent. Nothing here counts for Elo or the season.`}
          </p>
          {ranked ? null : (
            <>
              <span className="sk-kick">Opponent</span>
              <div className={c.seg} role="radiogroup" aria-label="Opponent" data-testid="s04-opponent">
                {[
                  { bot: false, label: 'Another player' },
                  { bot: true, label: `Vs ${BOT_HANDLE}` },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="radio"
                    aria-checked={vsBot === o.bot}
                    disabled={busy}
                    onClick={() => {
                      setVsBot(o.bot);
                      setError(null);
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className={c.note} data-testid="s04-opponent-note">
                {vsBot
                  ? 'Starts at once against a bot crew. Free when the server has no model key.'
                  : 'Pairs you with another player queued on this map at this difficulty.'}
              </p>
            </>
          )}
        </div>
        <div className={`sk-panel ${c.panel}`}>
          <span className="sk-kick">Difficulty · goal</span>
          <DifficultyPicker value={di} lock={ranked || busy} onChange={pickDifficulty} />
          <GoalBox map={map} di={diffIndex(difficulty)} lock={ranked} />
        </div>
        <CreditEstimate ticks={ticks} rates={rates} hold={hold} data-testid="s04-estimate" />
        <div className={c.deploy}>
          {err ? (
            <div className="app-banner is-critical" role="alert" data-testid="s04-queue-error">
              <b>{err.title}</b> {err.message}
            </div>
          ) : short && practice ? (
            <div className="app-banner" role="status" data-testid="s04-short-practice">
              This crew would hold {fmt(hold)} credits and you have {fmt(me.credits.available)}. Practice is free when the server has no model key, so
              it can still start: the server decides.
            </div>
          ) : short ? (
            <div className="app-banner is-warning" role="status" data-testid="s04-short">
              This crew holds {fmt(hold)} credits; you have {fmt(me.credits.available)}. Field fewer agents, pick quieter talk or{' '}
              <Link href={routes.credits()}>top up</Link>.
            </div>
          ) : null}
          {status === 'reconnecting' && searching ? (
            <div className="app-banner is-warning" role="status">
              Reconnecting... Your search starts again when the connection is back.
            </div>
          ) : null}
          <span className={c.headStart}>Fielding more agents than the rival gives them {HEAD_START_S_PER_AGENT} s per extra agent</span>
          <span className={c.models}>
            {models.length > 1 && !ranked ? 'Each agent acts with its model · plans use the default' : 'One model plans and acts · same for everyone'}
          </span>
          {searching ? (
            <div className={c.panel} aria-live="polite">
              <span className="sk-kick" data-testid="s04-searching">
                {practice ? `Starting practice vs ${BOT_HANDLE}…` : `Searching ${ranked ? 'ranked' : `${diff.n} on ${map.name}`} · ${clock(Math.floor(searchMs / 1000))}`}
              </span>
              <Button variant="secondary" block onClick={cancel} data-testid="s04-cancel">
                Cancel search
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="lg" block onClick={queue} disabled={!crew.length || (short && !practice) || phase === 'found'} data-testid="s04-queue">
              {phase === 'found' ? 'Match found…' : ranked ? 'Find ranked match ▸' : practice ? 'Start practice ▸' : 'Queue match ▸'}
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}
