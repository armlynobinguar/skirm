'use client';
// v2 match, lock-in (the prototype's #s-crew in ranked): one card per agent (portrait, role, verb fit
// on this map, skill, vision and comms, talk tier), the roster strip to swap, add or remove agents up
// to the map's crew limit, the head start the crew sizes give, the credit estimate (clock × Σ rate)
// and a countdown that mirrors the server's auto-lock: at 0:00 whatever is on screen is sent.
// Ranked plays every agent at Standard. The rival's agent count shows, never who they are (practice:
// the greedy bot, a Standard crew the size of yours). A free crew (practice on the offline brain)
// holds nothing, so the hold line says so.
// `v2_lock_in` carries the tiers, plus the crew when it differs from the queued one, and the crew
// playbook (`playbookId`) when the picker moved off the one selected on the crew screen.
import { DIFF_MODS, RANKED_DIFFICULTY, holdFor, type TalkTier } from '@skirm/engine/v2';
import { Button, fmt } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CreditEstimate, CrewCard, EmptySlot, GoalBox, RosterStrip } from '@/features/agents/CrewParts';
import { PlaybookPicker, playbookChange, usePlaybooks } from '@/features/agents/Playbooks';
import { TIER_INFO, clock, fmtRate, headStartLine, ratePerTick } from '@/features/agents/agentView';
import c from '@/features/agents/crew.module.css';
import { DIFFS, diffIndex, mapById } from '@/features/arena/world';
import { useNow } from '@/features/pvp/pvpUtil';
import { useToast } from '@/components/toast/ToastProvider';
import { qk, useMe } from '@/lib/api/queries';
import type { OutgoingMessage } from '@/lib/realtime/client';
import { useApi, useRealtime } from '@/lib/services';
import { PracticeBadge, other } from './common';
import type { V2MatchView } from './v2Store';

/** Send the lock this long before the server's deadline, so the choices on screen make it in. */
const AUTO_LOCK_LEAD_MS = 500;
const DEFAULT_CREW_LIMIT = 3;

export function LockIn({ view }: { view: V2MatchView }) {
  const rt = useRealtime();
  const api = useApi();
  const toast = useToast();
  const me = useMe();
  const written = useQuery({ queryKey: qk.skills.list('written'), queryFn: () => api.skills('written'), enabled: !!me.data });
  const agents = me.data?.agents ?? [];
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const map = mapById(view.mapId);
  const difficulty = view.ranked ? RANKED_DIFFICULTY : (view.difficulty ?? RANKED_DIFFICULTY);
  const diff = DIFFS[diffIndex(difficulty)]!;
  const ticks = DIFF_MODS[difficulty].ticks;
  const limit = view.crewLimit ?? DEFAULT_CREW_LIMIT;

  const queued = view.crew ?? [];
  const [crew, setCrew] = useState<string[]>(() => queued.map((a) => a.agentId));
  const [tiers, setTiers] = useState<Record<string, TalkTier>>(() => Object.fromEntries(queued.map((a) => [a.agentId, a.tier])));
  const [sent, setSent] = useState(false);
  const playbooks = usePlaybooks(!!me.data);
  const [playbook, setPlaybook] = useState<string | null | undefined>(undefined);
  const locked = view.locked.includes(view.team) || sent;
  const nameOf = (id: string) => byId.get(id)?.name ?? queued.find((a) => a.agentId === id)?.name ?? 'Agent';
  const tierOf = (id: string): TalkTier => (view.ranked ? 'standard' : (tiers[id] ?? 'standard'));
  const rates = crew.map((id) => TIER_INFO[tierOf(id)].rate);
  const perTick = ratePerTick(crew.map(tierOf));
  const hold = holdFor(crew.map((id) => ({ tier: tierOf(id) })), view.ranked, ticks);
  const changed = crew.join() !== queued.map((a) => a.agentId).join();
  const mine = (skillId: string | undefined) => (skillId && written.data ? written.data.some((s) => s.id === skillId) : null);

  const lock = () => {
    if (locked) return;
    const msg: Extract<OutgoingMessage, { type: 'v2_lock_in' }> = { type: 'v2_lock_in', matchId: view.matchId, tiers: crew.map(tierOf) };
    if (changed && crew.length) msg.crew = crew.map((id) => ({ agentId: id, tier: tierOf(id) }));
    const pick = playbookChange(playbooks.data, playbook);
    if (pick !== undefined) msg.playbookId = pick;
    rt.send(msg);
    setSent(true);
  };
  const lockRef = useRef(lock);
  lockRef.current = lock;

  // The server locks whatever it has at the deadline; send the screen's choices just before it.
  const now = useNow(250, !locked);
  const left = (view.lockBy ?? now) - now;
  useEffect(() => {
    if (view.lockBy !== null && left <= AUTO_LOCK_LEAD_MS) lockRef.current();
  }, [left, view.lockBy]);

  const remove = (id: string) => {
    if (crew.length <= 1) return toast.show({ tone: 'warning', title: 'A crew needs at least one agent.' });
    setCrew((p) => p.filter((x) => x !== id));
  };
  const toggle = (id: string) => {
    if (crew.includes(id)) return remove(id);
    if (crew.length >= limit) return toast.show({ tone: 'warning', title: `${limit} agents is the most this map takes.` });
    setTiers((t) => (t[id] ? t : { ...t, [id]: byId.get(id)?.tier ?? 'standard' }));
    setCrew((p) => [...p, id]);
  };
  const focusRoster = () => document.getElementById('v2-roster')?.querySelector('button')?.focus();

  const hs = view.rivalAgents === null ? null : headStartLine(crew.length, view.rivalAgents);
  const rivalLocked = view.locked.includes(other(view.team));

  return (
    <div className={c.wrap} data-backed="" data-testid="v2-lockin">
      <div className={c.main}>
        <header className={c.head}>
          <div>
            <span className="sk-kick">
              <b>{map?.code ?? 'Lock-in'}</b> · {map?.name ?? view.mapId} · {view.ranked ? 'ranked' : view.practice ? 'practice' : 'casual'} ·{' '}
              <span style={{ color: diff.c }}>{diff.n}</span>
            </span>
            {view.practice ? <PracticeBadge free={view.free} /> : null}
            <h1 className={`sk-disp ${c.title}`}>Lock in your crew</h1>
          </div>
          <div className={c.lockt}>
            <span className="sk-kick">Lock-in</span>
            <span className={c.lockN} role="timer" aria-label="Time left to lock in">
              {clock(left / 1000)}
            </span>
          </div>
        </header>
        <p className={c.note}>
          The rival brings {view.rivalAgents ?? '?'} agent{view.rivalAgents === 1 ? '' : 's'}; who they are stays hidden until the start.
          {view.ranked ? ' Ranked plays every agent at Standard.' : ''}
        </p>
        <div className={c.squad}>
          {Array.from({ length: Math.max(limit, crew.length) }, (_, i) => {
            const id = crew[i];
            if (!id) return <EmptySlot key={`empty-${i}`} index={i} onAdd={focusRoster} disabled={locked || !agents.length} />;
            const a = byId.get(id);
            return (
              <CrewCard
                key={id}
                name={nameOf(id)}
                agent={a}
                map={map}
                tier={tierOf(id)}
                ranked={view.ranked}
                disabled={locked}
                skillMine={mine(a?.skills[0]?.id)}
                onTier={(t) => setTiers((p) => ({ ...p, [id]: t }))}
                onRemove={agents.length ? () => remove(id) : undefined}
                index={i}
                data-testid={`v2-card-${id}`}
              />
            );
          })}
        </div>
        {agents.length ? <RosterStrip agents={agents} picked={crew} onToggle={toggle} disabled={locked} testPrefix="v2" /> : null}
      </div>

      <aside className={c.side}>
        {map ? (
          <div className={`sk-panel ${c.panel}`}>
            <span className="sk-kick">Difficulty · goal</span>
            <GoalBox map={map} di={diffIndex(difficulty)} lock={view.ranked} />
          </div>
        ) : null}
        <PlaybookPicker value={playbook} onChange={setPlaybook} disabled={locked} />
        <CreditEstimate ticks={ticks} rates={rates} hold={hold}>
          <span className={c.formula} data-testid="v2-hold">
            {view.free
              ? 'Free practice · nothing is held or charged'
              : `Hold ${fmt(hold)} credits · ${fmtRate(perTick)} per tick, the rest comes back`}
          </span>
        </CreditEstimate>
        <div className={c.deploy}>
          {hs ? (
            <span className={c.headStart} data-tone={hs.tone ?? undefined} data-testid="v2-head-start">
              {hs.text}
            </span>
          ) : null}
          <span className={c.models}>Haiku 5.5 plans and acts · same for everyone</span>
          {locked ? (
            <span className="sk-kick">
              Locked · {rivalLocked ? 'starting…' : 'waiting for the rival'}
            </span>
          ) : (
            <Button variant="primary" size="lg" block onClick={lock} disabled={!crew.length && !!agents.length} data-testid="v2-lock">
              Lock in ▸
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}
