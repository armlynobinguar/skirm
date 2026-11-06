'use client';
// Agent editor (/agents/[agentId]?map=&d=), laid out as a game character screen that fits the
// viewport: the agent large in the middle on a diagonal light beam, its inner voice as a bark and
// ‹ › under it to step through the roster (also ← →). Left: attributes (vision, comms, voice and the
// role's verb on the map), the record with a win-rate bar, then the name and its role plates.
// Right: the roster slot ring, two action tiles, the skill slots and the talk tier:
//   system prompt  the owner's instructions the planner reads ahead of the skill (≤ 600 characters);
//                  its tile opens a panel over the right column. Saved with PATCH /agents/:id
//                  { systemPrompt }; Reset clears them (skill alone). Escape closes the panel.
//   inner voice    a dry run of how it thinks on the map (./voice.ts)
//   skill          slots for the skills you own (click one to equip), the equipped skill's prompt
//                  when you wrote it, encrypted when bought
//   talk tier      the agent's default for unranked play (ranked is always Standard)
//   rent out       offer the agent to other players at a price per match (./RentOut.tsx)
//   record         this season's record (all time when no season is open) from GET /agents/:id/record:
//                  win rate, matches, deliveries per match, bluffs landed of told and rival bluffs seen
//                  through; the agent's own counters until it loads or if it fails
//   progression    level, XP bar and traits under the record, with the trait picker when a pick is
//                  earned (./Progression.tsx, POST /agents/:id/traits)
// `map` / `d` name the crew screen it was opened from, for "Back to crew".
import { isDifficulty, type Difficulty, type TalkTier } from '@skirm/engine/v2';
import { AGENT_ROLES, AGENT_ROLE_TEXT, rankedRoleAllowed, skillRolesLabel } from '@skirm/shared';
import { DisplayHeading, Pips, fmt } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { useArena } from '@/features/arena/store';
import { MAPS, mapById, type V2Map } from '@/features/arena/world';
import { SkillArt } from '@/features/skills/parts';
import { RoleTag, roleBlockReason } from '@/features/skills/RoleTag';
import { ProgressionPanel } from './Progression';
import { RentOut } from './RentOut';
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
      linked={!!me.data.account.nearAccountId}
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
  linked,
  map,
  from,
}: {
  agent: Agent;
  agents: Agent[];
  /** A NEAR account is linked (renting the agent out needs one). */
  linked: boolean;
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
  // The record falls back to the agent's own counters while it loads or when it cannot be read.
  const record = useQuery({ queryKey: qk.agentRecord(agent.id), queryFn: () => api.agentRecord(agent.id), retry: false });
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

  // The system prompt panel over the right column; Escape closes it before it would go Back.
  const [promptOpen, setPromptOpen] = useState(false);
  useEffect(() => {
    if (!promptOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return;
      ev.preventDefault();
      setPromptOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [promptOpen]);

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
  // A role change is refused while a skill for another role is equipped (the toast says why).
  const pickRole = (r: Agent['role']) =>
    patch.mutate({ role: r }, { onSuccess: () => toast.show({ tone: 'good', title: 'Role set', message: `${agent.name} plays ${r} from the next match.` }) });
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
  // Role slots: skills for this agent's role (or any) come first; the rest show, disabled, with why.
  const pickable = [...ownedSkills].sort(
    (a, b) => Number(roleBlockReason(a.roles, role) !== null) - Number(roleBlockReason(b.roles, role) !== null),
  );
  const equippedRoles = skill ? ownedSkills.find((s) => s.id === skill.id && s.version === skill.version)?.roles : undefined;
  const rec = record.data ? (record.data.season ?? record.data.allTime) : null;
  const played = rec ? rec.matches : agent.matchesPlayed;
  const winPct = played ? Math.round(((rec ? rec.wins : agent.wins) / played) * 100) : null;
  const span = record.data?.season ? 'this season' : 'all time';
  const backHref = from ? routes.crew(from.mapId, from.difficulty) : routes.home();

  return (
    <div className={e.wrap} style={{ '--ac': colour } as CSSProperties}>
      <div className={e.beam} aria-hidden="true" />
      <span className={e.mark} aria-hidden="true">
        {role}
      </span>

      {/* Centre: the agent on its light beam, its inner voice as a bark, ‹ › under it. */}
      <div className={e.stage}>
        <AgentPortrait body={colour} head={agentBone(agent)} team="A" label={`${agent.name}, ${role}`} variant="hero" className={e.hero} />
        <div className={`${e.bark} ${out ? e.barkOut : ''}`} role="status" data-testid="agent-bark">
          <small>
            <em>THINKS</em>
            {agent.name} · inner voice
          </small>
          <span>{barkLine}</span>
        </div>
        <div className={e.sw}>
          <button type="button" aria-label="Previous agent" onClick={() => step(-1)} disabled={agents.length < 2} data-testid="agent-prev">
            <Chev left />
          </button>
          <span className={e.swTrack} aria-hidden="true">
            {agents.map((a, i) => (
              <i key={a.id} data-on={i === idx ? '' : undefined} />
            ))}
          </span>
          <button type="button" aria-label="Next agent" onClick={() => step(1)} disabled={agents.length < 2} data-testid="agent-next">
            <Chev />
          </button>
        </div>
      </div>

      {/* Left: attributes, record, the name and its role plates. */}
      <div className={e.left}>
        <section className={e.attrs} aria-label="Attributes" data-rise>
          <h2 className={e.kick}>
            Attributes <i aria-hidden="true">▸▸</i>
          </h2>
          <dl className={e.stl}>
            <div>
              <dt>
                <Glyph d={GLYPH.vision} />
                Vision
              </dt>
              <dd>
                <b>{vision}</b>
                <Pips value={vision} max={5} colour="var(--you)" label="Vision" />
              </dd>
              <small>
                Sees {sightOf(vision)} tiles · {vision} at night
              </small>
            </div>
            <div>
              <dt>
                <Glyph d={GLYPH.comms} />
                Comms
              </dt>
              <dd>
                <b>{comms}</b>
                <Pips value={comms} max={5} colour="var(--amber)" label="Comms" />
              </dd>
              <small>Say reaches {reachOf(comms)} tiles</small>
            </div>
            <div>
              <dt>
                <Glyph d={GLYPH.voice} />
                Voice
              </dt>
              <dd>
                <b>{voice}</b>
              </dd>
              <small>Tone of speech and thought</small>
            </div>
            <div>
              <dt>
                <Glyph d={GLYPH.verb} />
                Verb
              </dt>
              <dd>
                <b className={e.verb}>{fit.effect ? fit.effect.replace(/_/g, ' ') : 'none'}</b>
              </dd>
              <small data-testid="agent-verb">
                {fit.verb && map ? `${fit.verb} on ${map.name}` : fit.effect ? `Not on ${map?.name ?? 'this map'}` : 'Take and deliver only'}
              </small>
            </div>
          </dl>
        </section>

        <section className={e.record} aria-label="Record" data-rise style={{ '--rise-i': 1 } as CSSProperties} data-testid="agent-record">
          <div className={e.recHead}>
            <span className={e.kick}>
              Record <i aria-hidden="true">▸▸</i>{' '}
              {rec ? <span data-testid="agent-record-span">{record.data?.season ? `Season ${record.data.season.number}` : 'All time'}</span> : null}
            </span>
            <b>{winPct === null ? 'No matches yet' : `${winPct}% wins`}</b>
          </div>
          <span className={e.bar} aria-hidden="true">
            <i style={{ width: `${winPct ?? 0}%` }} />
          </span>
          {rec ? (
            <>
              <div className={e.statrow} title={`${rec.wins}–${rec.losses}–${rec.draws} (W–L–D) ${span}. Practice against the bot does not count.`}>
                <span>
                  <small>Matches</small>
                  <b>{fmt(rec.matches)}</b>
                </span>
                <span>
                  <small>Deliv/match</small>
                  <b>{rec.matches ? (rec.delivered / rec.matches).toFixed(1) : '–'}</b>
                </span>
                <span title={`${rec.bluffsLanded} of ${rec.bluffsTold} bluffs believed by the rival`}>
                  <small>Bluffs</small>
                  <b>
                    {fmt(rec.bluffsLanded)}/{fmt(rec.bluffsTold)}
                  </b>
                </span>
              </div>
              <small className={e.recSub} data-testid="agent-record-seen">
                Saw through {fmt(rec.seenThrough)} rival bluff{rec.seenThrough === 1 ? '' : 's'} {span}.
              </small>
            </>
          ) : (
            <div className={e.statrow} title="All time.">
              <span>
                <small>Matches</small>
                <b>{fmt(agent.matchesPlayed)}</b>
              </span>
              <span>
                <small>W–L–D</small>
                <b>
                  {agent.wins}–{agent.losses}–{agent.draws}
                </b>
              </span>
            </div>
          )}
        </section>

        <ProgressionPanel agent={agent} />

        <div className={e.plate} data-rise style={{ '--rise-i': 2 } as CSSProperties}>
          <DisplayHeading level={1} className={e.plateName}>
            {agent.name}
          </DisplayHeading>
          <div className={e.tags}>
            <span className={e.roleTile} title={role}>
              <Glyph d={GLYPH.role} />
            </span>
            <span className={e.tagTile}>
              <small>Role</small>
              <b style={{ color: colour }}>{role}</b>
            </span>
            <span className={e.tagStack}>
              <span>{TIER_INFO[tier].label} talk</span>
              <span>{voice} voice</span>
            </span>
          </div>
          <span className={e.meta} data-testid="agent-meta">
            {skill ? `${skill.name} v${skill.version}` : 'No skill'} · talk: {TIER_INFO[tier].label} · voice: {voice}
          </span>
        </div>
      </div>

      {/* Right: the slot ring, the prompt and voice tiles, the skill slots and the talk tier. */}
      <div className={e.right} aria-label="Agent loadout" role="region">
        <div className={e.lvRow} data-rise>
          <div className={e.ring} style={{ '--p': `${((idx + 1) / agents.length) * 100}%` } as CSSProperties}>
            <small>Agent</small>
            <b>{String(idx + 1).padStart(2, '0')}</b>
            <span>/{String(agents.length).padStart(2, '0')}</span>
          </div>
          <div className={e.lvBar}>
            <small>Planner · actor</small>
            <b>Same model for all</b>
            <span className={e.max}>LIVE</span>
          </div>
        </div>

        <div className={e.acts} data-rise style={{ '--rise-i': 1 } as CSSProperties}>
          <button
            type="button"
            className={e.act}
            aria-expanded={promptOpen}
            aria-controls="agent-prompt-panel"
            onClick={() => setPromptOpen((o) => !o)}
            data-testid="agent-prompt-open"
          >
            <Glyph d={GLYPH.prompt} className={e.actIco} />
            <span className={e.actTxt}>
              <b>System prompt</b>
              <small>{saved ? `${saved.length}/${AGENT_SYSTEM_PROMPT_MAX}` : 'Skill alone'}</small>
            </span>
          </button>
          <div className={e.act} style={{ '--tc': 'var(--water)' } as CSSProperties}>
            <Glyph d={GLYPH.voice} className={e.actIco} />
            <span className={e.actTxt}>
              <b>Inner voice</b>
              <small>Dry run on {map?.name ?? 'the map'}</small>
            </span>
            <div className={e.voice} data-testid="agent-voice">
              <p>{lines[0]}</p>
            </div>
            <button type="button" className={e.mini} onClick={() => setSeed((k) => k + 1)} data-testid="agent-voice-next">
              Another line ▸
            </button>
          </div>
        </div>

        <section className={e.skills} aria-label="Skill" data-rise style={{ '--rise-i': 2 } as CSSProperties} data-testid="agent-skill">
          <div className={e.slots} role="group" aria-label="Swap skill">
            {pickable.slice(0, 4).map((s) => {
              const on = s.id === skill?.id && s.version === skill.version;
              const blocked = roleBlockReason(s.roles, role);
              return (
                <button
                  key={`${s.id}:${s.version}`}
                  type="button"
                  className={e.slot}
                  aria-pressed={s.id === skill?.id}
                  aria-label={`${s.name} v${s.version}${blocked ? ` (${blocked})` : ''}`}
                  title={`${s.name} v${s.version} · ${skillRolesLabel(s.roles)}${blocked ? `. ${blocked}` : ''}`}
                  disabled={patch.isPending || on || blocked !== null}
                  data-testid={`agent-skill-slot-${s.id}`}
                  onClick={() => equip(s)}
                >
                  <SkillArt name={s.name} tag={s.handles_tags[0]} className={e.slotArt} />
                  <span>v{s.version}</span>
                </button>
              );
            })}
            {pickable.length < 3
              ? Array.from({ length: 3 - pickable.length }, (_, i) => <span key={i} className={`${e.slot} ${e.slotEmpty}`} aria-hidden="true" />)
              : null}
          </div>
          <div className={e.skInfo}>
            <span className={e.code}>Skill · {skill ? (mine ? 'yours' : 'bought, prompt encrypted') : 'none'}</span>
            <b className={e.skName}>
              {skill ? skill.name : 'No skill'} {skill ? <span className={e.ver}>v{skill.version}</span> : null}
            </b>
            {skill ? <RoleTag roles={equippedRoles} /> : null}
            {!skill ? (
              <p className={e.sub}>{owned.isSuccess && !ownedSkills.length ? 'You own no skills yet. Write one or buy one on the Exchange.' : 'Equip a skill. Without one the agent plays the rules alone.'}</p>
            ) : mine ? (
              <p className={e.skp}>{prompt ?? (text.isError ? 'Could not load the prompt.' : 'Loading the prompt…')}</p>
            ) : (
              <p className={e.hid}>PROMPT ENCRYPTED · by {creator ?? 'its creator'}. You own the right to run it, never the text.</p>
            )}
          </div>
        </section>

        <section className={e.tierBox} aria-label="Talk tier" data-rise style={{ '--rise-i': 3 } as CSSProperties}>
          <div className={e.tierHead}>
            <span className={e.code}>Talk tier · practice default</span>
            <b>{TIER_INFO[tier].label}</b>
          </div>
          <div className={e.seg} role="group" aria-label="Default talk tier">
            {TIER_ORDER.map((t) => (
              <button key={t} type="button" aria-pressed={t === tier} disabled={patch.isPending} onClick={() => (t === tier ? undefined : pickTier(t))}>
                {TIER_INFO[t].label} · {fmtRate(TIER_INFO[t].rate)}/T
              </button>
            ))}
          </div>
          <span className={e.sub}>{TIER_INFO[tier].line} Ranked locks everyone to Standard.</span>
        </section>

        <section className={e.tierBox} aria-label="Role" data-testid="agent-role-picker" data-rise style={{ '--rise-i': 3 } as CSSProperties}>
          <div className={e.tierHead}>
            <span className={e.code}>Role · what {agent.name} can do</span>
            <b>{role}</b>
          </div>
          <div className={`${e.seg} ${e.roleGrid}`} role="group" aria-label="Role">
            {AGENT_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={r === role}
                disabled={patch.isPending}
                title={AGENT_ROLE_TEXT[r].does}
                data-testid={`agent-role-${r}`}
                onClick={() => (r === role ? undefined : pickRole(r))}
              >
                {r}
              </button>
            ))}
          </div>
          <span className={e.sub} data-testid="agent-role-does">
            {AGENT_ROLE_TEXT[role].does}
            {rankedRoleAllowed(role) ? '' : ' Casual, practice and the campaign for now: ranked plays the original six.'}
          </span>
        </section>

        <RentOut agentId={agent.id} agentName={agent.name} linked={linked} />

        <ButtonLink href={backHref} variant="primary" className={e.back} data-testid="agent-back">
          {from ? 'Back to crew ▸' : 'Back to Command ▸'}
        </ButtonLink>

        {/* The system prompt editor slides over the right column. */}
        <section
          id="agent-prompt-panel"
          className={e.promptPanel}
          aria-label={`System prompt for ${agent.name}`}
          hidden={!promptOpen}
          style={{ '--tc': colour } as CSSProperties}
        >
          <div className={e.th}>
            <span className={e.code}>System prompt · persona · only you can read it</span>
            <span className={e.chip} data-testid="agent-prompt-count">
              {draft.length}/{AGENT_SYSTEM_PROMPT_MAX}
            </span>
            <button type="button" className={e.x} aria-label="Close the system prompt" onClick={() => setPromptOpen(false)}>
              ×
            </button>
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
          <span className={e.hint}>
            Read every tick, before the skill: voice and habits here, strategy in the skill.
            {draft ? '' : ' Empty: the skill alone (the grey text is a starter).'}
          </span>
          <div className={e.row}>
            <button type="button" className={e.btn} onClick={reset} disabled={patch.isPending || (!saved && !draft)} data-testid="agent-prompt-reset">
              Reset
            </button>
            <button type="button" className={`${e.btn} ${e.primary}`} onClick={save} disabled={patch.isPending || !dirty} data-testid="agent-prompt-save">
              Save
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Line icons for the attribute rows and action tiles (22 × 22, stroked). */
const GLYPH = {
  vision: 'M2 11s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM11 8.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  comms: 'M4 15a10 10 0 0 1 14 0M7 12a6 6 0 0 1 8 0M10 9.5a2 2 0 0 1 2 0M11 18v.5',
  voice: 'M4 5h14v9H9l-4 4v-4H4zM8 9h6M8 11.5h4',
  verb: 'M5 17l7-7M12 4l6 6-3 3-6-6zM4 18l2 0',
  role: 'M11 3l7 4v8l-7 4-7-4V7zM11 8v6M8 9.5l3 1.5 3-1.5',
  prompt: 'M5 3h9l4 4v12H5zM14 3v4h4M8 11h7M8 14h7M8 17h4',
} as const;

function Glyph({ d, className }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Chev({ left = false }: { left?: boolean }) {
  return (
    <svg viewBox="0 0 24 12" aria-hidden="true">
      <path d={left ? 'M22 6H3M8 1L3 6l5 5' : 'M2 6h19M16 1l5 5-5 5'} fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
