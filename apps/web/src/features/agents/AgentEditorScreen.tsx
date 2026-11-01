'use client';
// Agent editor (/agents/[agentId]?map=&d=), the prototype's #s-agent: the agent on the left with its
// inner voice as a bark and ‹ › to step through the roster (also ← →), and its loadout tiles on the
// right:
//   system prompt  the owner's instructions the planner reads ahead of the skill (≤ 600 characters),
//                  saved with PATCH /agents/:id { systemPrompt }; Reset clears them (skill alone)
//   stats          vision, comms, voice and the role's verb on the map, explained
//   skill          the equipped skill: its prompt when you wrote it, encrypted when bought; swap
//                  among the skills you own
//   talk tier      the agent's default for unranked play (ranked is always Standard)
//   record         all-time matches and W–L–D; the season record and bluffs are "Soon"
//   inner voice    a dry run of how it thinks on the map (./voice.ts)
// `map` / `d` name the crew screen it was opened from, for "Back to crew".
import { isDifficulty, type Difficulty, type TalkTier } from '@skirm/engine/v2';
import { DisplayHeading, Pips, Soon, fmt } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { useArena } from '@/features/arena/store';
import { MAPS, mapById, type V2Map } from '@/features/arena/world';
import { ButtonLink } from '@/components/ButtonLink';
import { RequireSession } from '@/components/shell/RequireSession';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorCard } from '@/components/states/ErrorCard';
import { Skeleton } from '@/components/states/Skeleton';
import { useToast } from '@/components/toast/ToastProvider';
import { qk, useMe } from '@/lib/api/queries';
import type { Agent, AgentPatch, SkillRow } from '@/lib/api/types';
import { AGENT_SYSTEM_PROMPT_MAX } from '@/lib/constants';
import { usePreferences } from '@/lib/preferences';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import {
  TIER_INFO,
  TIER_ORDER,
  agentBone,
  agentColour,
  agentComms,
  agentEditorHref,
  agentRole,
  agentTier,
  agentVision,
  agentVoice,
  fmtRate,
  reachOf,
  sightOf,
  verbFit,
} from './agentView';
import e from './agentEditor.module.css';
import { sampleInner, starterPersona } from './voice';

/** How long one bark line stays up (the prototype's 5.2 s). */
export const BARK_MS = 5200;

export interface AgentEditorScreenProps {
  agentId: string;
  /** The crew screen this was opened from (`?map=`), for Back and the dry run's map. */
  mapId?: string;
  difficulty?: string;
}

export function AgentEditorScreen(props: AgentEditorScreenProps) {
  return (
    <div data-testid="screen-agent">
      <RequireSession>
        <AgentEditorData {...props} />
      </RequireSession>
    </div>
  );
}

function AgentEditorData({ agentId, mapId, difficulty }: AgentEditorScreenProps) {
  const me = useMe();
  const { mapIdx } = useArena();
  if (me.data === undefined)
    return me.isError ? <ErrorCard error={me.error} onRetry={() => void me.refetch()} /> : <Skeleton rows={6} label="Loading agent" />;
  const agents = me.data.agents;
  const agent = agents.find((a) => a.id === agentId);
  if (!agent)
    return (
      <EmptyState action={<ButtonLink href={routes.home()}>Back to Play</ButtonLink>}>This agent is not on your account.</EmptyState>
    );
  const fromMap = mapId ? mapById(mapId) : undefined;
  const d = isDifficulty(difficulty) ? difficulty : undefined;
  return (
    <AgentEditor
      key={agent.id}
      agent={agent}
      agents={agents}
      map={fromMap ?? MAPS[mapIdx]}
      from={fromMap ? { mapId: fromMap.id, difficulty: d } : undefined}
    />
  );
}

/** Keys typed into a field never step the roster. */
function typing(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

function AgentEditor({
  agent,
  agents,
  map,
  from,
}: {
  agent: Agent;
  agents: Agent[];
  map: V2Map | undefined;
  from?: { mapId: string; difficulty?: Difficulty };
}) {
  const api = useApi();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const { reducedMotion } = usePreferences();

  const idx = agents.findIndex((a) => a.id === agent.id);
  const role = agentRole(agent);
  const colour = agentColour(agent);
  const voice = agentVoice(agent);
  const vision = agentVision(agent);
  const comms = agentComms(agent);
  const fit = verbFit(role, map);
  const skill = agent.skills[0];
  const who = { name: agent.name, voice, role, vision };

  const written = useQuery({ queryKey: qk.skills.list('written'), queryFn: () => api.skills('written') });
  const owned = useQuery({ queryKey: qk.skills.list('owned'), queryFn: () => api.skills('owned') });
  const mine = !!skill && !!written.data?.some((s) => s.id === skill.id);
  const text = useQuery({
    queryKey: qk.skills.one(skill?.id ?? '', skill?.version),
    queryFn: () => api.skill(skill!.id, skill!.version),
    enabled: mine,
  });
  const prompt = text.data && 'prompt' in text.data ? text.data.prompt : null;
  const creator = skill ? [...(owned.data ?? []), ...(written.data ?? [])].find((s) => s.id === skill.id)?.creatorAccount.handle : undefined;

  // Prev / next with ← → (not while typing in the prompt).
  const step = (d: number) => {
    const next = agents[(idx + d + agents.length) % agents.length];
    if (next && next.id !== agent.id) router.replace(agentEditorHref(next.id, from));
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || typing(ev.target)) return;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        stepRef.current(ev.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Saving: one PATCH per change, then /me again.
  const patch = useMutation({
    mutationFn: (p: AgentPatch) => api.patchAgent(agent.id, p),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.me }),
    onError: (err) => toast.error(err),
  });

  const saved = agent.systemPrompt ?? '';
  const [draft, setDraft] = useState(saved);
  const dirty = draft.trim() !== saved;
  const save = () =>
    patch.mutate(
      { systemPrompt: draft.trim() || null },
      {
        onSuccess: () => {
          const n = draft.trim().length;
          toast.show({
            tone: 'good',
            title: 'Saved',
            message: n ? `${agent.name}'s system prompt is ${n} characters and applies from the next match.` : `${agent.name} now follows the skill alone.`,
          });
          setDraft(draft.trim());
        },
      },
    );
  const reset = () =>
    patch.mutate(
      { systemPrompt: null },
      {
        onSuccess: () => {
          setDraft('');
          toast.show({ tone: 'good', title: 'Reset', message: `${agent.name}'s system prompt is cleared; the planner reads the skill alone.` });
        },
      },
    );

  const [tier, setTier] = useState<TalkTier>(agentTier(agent));
  const pickTier = (t: TalkTier) => {
    const was = tier;
    setTier(t);
    patch.mutate({ tier: t }, { onError: () => setTier(was) });
  };
  const equip = (s: SkillRow) => {
    const rest = agent.skills.slice(1).filter((k) => k.id !== s.id).map(({ id, version }) => ({ id, version }));
    patch.mutate(
      { skills: [{ id: s.id, version: s.version }, ...rest] },
      { onSuccess: () => toast.show({ tone: 'good', title: 'Equipped', message: `${agent.name} now runs ${s.name}.` }) },
    );
  };

  // The inner voice: two lines on the tile, one at a time on the bark.
  const [seed, setSeed] = useState(0);
  const lines = sampleInner(who, map, seed);
  const [bark, setBark] = useState(0);
  const [out, setOut] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      setOut(true);
      setTimeout(() => {
        setBark((b) => b + 1);
        setOut(false);
      }, reducedMotion ? 0 : 420);
    }, BARK_MS);
    return () => clearInterval(t);
  }, [reducedMotion]);
  const barkLine = sampleInner(who, map, seed + 7 + bark)[bark % 3];

  const ownedSkills = owned.data ?? [];
  const winPct = agent.matchesPlayed ? Math.round((agent.wins / agent.matchesPlayed) * 100) : null;

  return (
    <div className={e.wrap} style={{ '--ac': colour } as CSSProperties}>
      <div className={e.assist} data-rise>
        <AgentPortrait body={colour} head={agentBone(agent)} team="A" label={`${agent.name}, ${role}`} variant="hero" className={e.hero} />
        <div className={`${e.bark} ${out ? e.barkOut : ''}`} role="status" data-testid="agent-bark">
          <small>
            <em>THINKS</em>
            {agent.name} · inner voice
          </small>
          <span>{barkLine}</span>
        </div>
        <div className={e.plate}>
          <DisplayHeading level={1} className={e.plateName}>
            {agent.name}
          </DisplayHeading>
          <div className={e.sw}>
            <button type="button" aria-label="Previous agent" onClick={() => step(-1)} disabled={agents.length < 2} data-testid="agent-prev">
              ‹
            </button>
            <button type="button" aria-label="Next agent" onClick={() => step(1)} disabled={agents.length < 2} data-testid="agent-next">
              ›
            </button>
          </div>
          <div className={e.plateMeta}>
            <span className="sk-kick">
              <b style={{ color: colour }}>{role}</b> · agent {idx + 1} of {agents.length}
            </span>
            <span className="sk-kick" data-testid="agent-meta">
              {skill ? `${skill.name} v${skill.version}` : 'No skill'} · talk: {TIER_INFO[tier].label} · voice: {voice}
            </span>
          </div>
        </div>
      </div>

      <div className={e.ed} aria-label="Agent loadout" role="region">
        <section className={`${e.tile} ${e.sys}`} style={{ '--tc': colour } as CSSProperties} data-rise>
          <div className={e.th}>
            <span className={e.code}>System prompt · persona · only you can read it</span>
            <span className={e.chip} data-testid="agent-prompt-count">
              {draft.length}/{AGENT_SYSTEM_PROMPT_MAX}
            </span>
          </div>
          <h2 className={e.name}>System prompt</h2>
          <textarea
            value={draft}
            maxLength={AGENT_SYSTEM_PROMPT_MAX}
            onChange={(ev) => setDraft(ev.target.value)}
            placeholder={starterPersona(agent.name, role)}
            aria-label={`System prompt for ${agent.name}`}
            data-testid="agent-prompt"
          />
          <div className={e.row}>
            <span className={e.hint}>
              The planner reads this every tick, before the skill. It sets voice and habits; the skill sets strategy.
              {draft ? '' : ' Empty: the skill alone (the grey text is a starter you can write over).'}
            </span>
            <button type="button" className={e.btn} onClick={reset} disabled={patch.isPending || (!saved && !draft)} data-testid="agent-prompt-reset">
              Reset
            </button>
            <button type="button" className={`${e.btn} ${e.primary}`} onClick={save} disabled={patch.isPending || !dirty} data-testid="agent-prompt-save">
              Save
            </button>
          </div>
        </section>

        <section className={`${e.tile} ${e.st}`} data-rise style={{ '--rise-i': 1 } as CSSProperties}>
          <span className={e.code}>Stats · {role}</span>
          <h2 className={e.name}>Stats</h2>
          <dl className={e.stl}>
            <div>
              <dt>VISION</dt>
              <dd>
                {vision}
                <Pips value={vision} max={5} colour="var(--you)" label="Vision" />
              </dd>
              <small>
                Sees {sightOf(vision)} tiles · {vision} at night
              </small>
            </div>
            <div>
              <dt>COMMS</dt>
              <dd>
                {comms}
                <Pips value={comms} max={5} colour="var(--amber)" label="Comms" />
              </dd>
              <small>Say reaches {reachOf(comms)} tiles</small>
            </div>
            <div>
              <dt>VOICE</dt>
              <dd>{voice}</dd>
              <small>Tone of speech and thought</small>
            </div>
            <div>
              <dt>VERB</dt>
              <dd className={e.verb}>{fit.effect ? fit.effect.replace(/_/g, ' ') : 'none'}</dd>
              <small data-testid="agent-verb">
                {fit.verb && map ? `${fit.verb} on ${map.name}` : fit.effect ? `Not on ${map?.name ?? 'this map'}` : 'Take and deliver only'}
              </small>
            </div>
          </dl>
        </section>

        <section className={e.tile} style={{ '--tc': 'var(--violet)', '--rise-i': 2 } as CSSProperties} data-rise data-testid="agent-skill">
          <span className={e.code}>Skill · equipped · {skill ? (mine ? 'yours' : 'bought, prompt encrypted') : 'none'}</span>
          <h2 className={e.name}>
            {skill ? skill.name : 'No skill'} {skill ? <span className={e.ver}>v{skill.version}</span> : null}
          </h2>
          {!skill ? (
            <p className={e.sub}>Equip one of your skills below. Without one the agent plays the rules alone.</p>
          ) : mine ? (
            <div className={e.skp}>{prompt ?? (text.isError ? 'Could not load the prompt.' : 'Loading the prompt…')}</div>
          ) : (
            <div className={e.hid}>PROMPT ENCRYPTED · by {creator ?? 'its creator'}. You own the right to run it, never the text.</div>
          )}
          {ownedSkills.length ? (
            <div className={e.chips} role="group" aria-label="Swap skill">
              {ownedSkills.map((s) => (
                <button
                  key={`${s.id}:${s.version}`}
                  type="button"
                  className={e.chip}
                  aria-pressed={s.id === skill?.id}
                  disabled={patch.isPending || (s.id === skill?.id && s.version === skill.version)}
                  onClick={() => equip(s)}
                >
                  {s.name} v{s.version}
                </button>
              ))}
            </div>
          ) : owned.isSuccess ? (
            <p className={e.sub}>You own no skills yet. Write one or buy one on the Exchange.</p>
          ) : null}
        </section>

        <section className={e.tile} style={{ '--tc': 'var(--amber)', '--rise-i': 3 } as CSSProperties} data-rise>
          <span className={e.code}>Talk tier · practice default</span>
          <h2 className={e.name}>{TIER_INFO[tier].label}</h2>
          <div className={e.seg} role="group" aria-label="Default talk tier">
            {TIER_ORDER.map((t) => (
              <button key={t} type="button" aria-pressed={t === tier} disabled={patch.isPending} onClick={() => (t === tier ? undefined : pickTier(t))}>
                {TIER_INFO[t].label} · {fmtRate(TIER_INFO[t].rate)}/T
              </button>
            ))}
          </div>
          <span className={e.sub}>{TIER_INFO[tier].line} Ranked locks everyone to Standard.</span>
        </section>

        <section className={e.tile} style={{ '--tc': 'var(--bone)', '--rise-i': 4 } as CSSProperties} data-rise data-testid="agent-record">
          <span className={e.code}>
            Record · season 1 <Soon what="Season record" />
          </span>
          <h2 className={e.name}>{winPct === null ? 'No matches yet' : `${winPct}% wins`}</h2>
          <div className={e.statrow}>
            <div>
              <small>Matches</small>
              <b>{fmt(agent.matchesPlayed)}</b>
            </div>
            <div>
              <small>W–L–D</small>
              <b>
                {agent.wins}–{agent.losses}–{agent.draws}
              </b>
            </div>
            <div>
              <small>Bluffs</small>
              <b>
                <Soon what="Bluff stats" />
              </b>
            </div>
          </div>
          <span className={e.sub}>All time. Season records, deliveries per match and bluffs seen through arrive with seasons.</span>
        </section>

        <section className={e.tile} style={{ '--tc': 'var(--water)', '--rise-i': 5 } as CSSProperties} data-rise>
          <span className={e.code}>
            How {agent.name} thinks · dry run on {map?.name ?? 'the map'}
          </span>
          <h2 className={e.name}>Inner voice</h2>
          <div className={e.voice} data-testid="agent-voice">
            <p>{lines[0]}</p>
            <p>{lines[1]}</p>
          </div>
          <div className={e.row}>
            <span className={e.hint}>Plays as subtitles in third person.</span>
            <button type="button" className={e.btn} onClick={() => setSeed((k) => k + 1)} data-testid="agent-voice-next">
              Another line
            </button>
          </div>
        </section>

        <div className={e.foot} data-rise style={{ '--rise-i': 6 } as CSSProperties}>
          <b>{'// LOADOUT'}</b>
          <span>Planner and actor · Claude Haiku 5.5</span>
          <span>
            {idx + 1} of {agents.length} agents
          </span>
          {from ? (
            <ButtonLink href={routes.crew(from.mapId, from.difficulty)} variant="primary" data-testid="agent-back">
              Back to crew ▸
            </ButtonLink>
          ) : (
            <ButtonLink href={routes.home()} variant="primary" data-testid="agent-back">
              Back to Command ▸
            </ButtonLink>
          )}
        </div>
      </div>
    </div>
  );
}
