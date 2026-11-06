'use client';
// The crew pieces the casual crew screen (/maps/[mapId]/crew) and the match lock-in share, from the
// prototype's #s-crew: one card per agent (portrait, role icon, verb fit on the map, skill, vision and
// comms pips, voice, talk tier and, when the operator offers several, the model), the empty "Add
// agent" slot, the roster strip, the credit estimate, the difficulty picker and the goal box.
import { TICK_MS, agentRatePer100, type TalkTier } from '@skirm/engine/v2';
import { fmtMultiplier, type ModelChoice } from '@skirm/shared';
import { Pips, fmt } from '@skirm/ui';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { AgentPortrait } from '@/features/arena/AgentPortrait';
import { ROLE_ICON } from '@/features/arena/roles';
import { DIFFS, goalOf, type V2Map } from '@/features/arena/world';
import type { Agent } from '@/lib/api/types';
import {
  TIER_INFO,
  TIER_ORDER,
  agentBone,
  agentColour,
  agentComms,
  agentRole,
  agentVision,
  agentVoice,
  clock,
  fmtRate,
  reachOf,
  verbFit,
} from './agentView';
import c from './crew.module.css';
import { XpBar } from './Progression';

/** Effect class as a label: "add_solid" → "add solid". */
const effectLabel = (e: string) => e.replace(/_/g, ' ');

/** What a role's special map action does, in plain words (ROLE_EFFECT in @skirm/engine/v2). */
const EFFECT_PLAIN: Readonly<Record<string, string>> = {
  add_solid: 'places blocks',
  remove_solid: 'clears dirt, blocks, crates and trees',
  extinguish: 'puts out fire',
  area_repel: 'stuns nearby rivals',
};

/**
 * The card's action label and its explanation. A "verb" is a map's themed name for a role's special
 * action (Builder, Digger, Firefighter, Scout); Runners and Haulers have none and only take and
 * deliver the goal items.
 */
export function actionHint(role: string, fit: { effect: string | null; verb: string | null }): { label: string; hint: string } {
  if (!fit.effect)
    return {
      label: 'No special action',
      hint: `${role}s have no special map action: they take the goal items and deliver them. Builders, Diggers, Firefighters and Scouts each get one.`,
    };
  const plain = EFFECT_PLAIN[fit.effect] ?? effectLabel(fit.effect);
  return {
    label: effectLabel(fit.effect),
    hint: fit.verb
      ? `Special action: ${plain}. On this map it is called ${fit.verb}.`
      : `Special action: ${plain}. This map has no use for it, so this agent only takes and delivers.`,
  };
}

function RoleIcon({ path, size = 30 }: { path: string; size?: number }) {
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** The talk tier choice of one agent. Ranked offers Standard only. */
export function TalkTierPicker({
  name,
  value,
  ranked,
  disabled,
  onChange,
}: {
  name: string;
  value: TalkTier;
  ranked: boolean;
  disabled?: boolean;
  onChange: (t: TalkTier) => void;
}) {
  return (
    <div className={c.seg} role="radiogroup" aria-label={`Talk tier for ${name}`}>
      {TIER_ORDER.map((t) => {
        const on = (ranked ? 'standard' : value) === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled || (ranked && t !== 'standard')}
            title={`${TIER_INFO[t].note} · ${fmtRate(TIER_INFO[t].rate)} credits per tick`}
            onClick={() => (on ? undefined : onChange(t))}
          >
            {TIER_INFO[t].label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The model one agent acts with, from the operator's catalog (GET /v2/models), with what it does to
 * the agent's rate. Ranked plays the default model only. The server prices the pick; this is display.
 */
export function ModelPicker({
  name,
  models,
  value,
  tier,
  ranked,
  disabled,
  onChange,
}: {
  name: string;
  models: readonly ModelChoice[];
  value: string;
  tier: TalkTier;
  ranked: boolean;
  disabled?: boolean;
  onChange?: (id: string) => void;
}) {
  const current = (ranked ? undefined : models.find((m) => m.id === value)) ?? models[0]!;
  const rate = agentRatePer100({ tier, rateBps: current.rateMultiplierBps }, ranked) / 100;
  return (
    <div className={c.talk}>
      <span className="sk-kick">Model</span>
      <select
        className={c.model}
        aria-label={`Model for ${name}`}
        value={current.id}
        disabled={disabled || ranked || !onChange}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} · {fmtMultiplier(m.rateMultiplierBps)}
          </option>
        ))}
      </select>
      <small className={c.modelRate}>{ranked ? 'Ranked plays the default model' : `${fmtRate(rate)} credits per tick`}</small>
    </div>
  );
}

export interface CrewCardProps {
  /** The agent's name (known even before /me loads, from the queued crew). */
  name: string;
  /** The full agent, when this account's agents are loaded. */
  agent: Agent | undefined;
  map: V2Map | undefined;
  tier: TalkTier;
  ranked: boolean;
  /** Locked in, or searching: nothing on the card changes. */
  disabled?: boolean;
  /** The equipped skill is the player's own (its prompt is readable); null while unknown. */
  skillMine?: boolean | null;
  onTier: (t: TalkTier) => void;
  /** The model choice, shown only when the catalog offers more than one (no onChange: read-only). */
  model?: { models: readonly ModelChoice[]; value: string; onChange?: (id: string) => void };
  /** Omit for no remove button. */
  onRemove?: () => void;
  /** The agent editor, when leaving this screen is safe. */
  editHref?: string;
  index: number;
  'data-testid'?: string;
}

/** One agent of the crew, the prototype's `.op` card. */
export function CrewCard({ name, agent, map, tier, ranked, disabled, skillMine, onTier, model, onRemove, editHref, index, 'data-testid': testId }: CrewCardProps) {
  const role = agent ? agentRole(agent) : null;
  const fit = role ? verbFit(role, map) : null;
  const action = role && fit ? actionHint(role, fit) : null;
  const colour = agent ? agentColour(agent) : 'var(--you)';
  const skill = agent?.skills[0];
  return (
    <div className={c.op} style={{ '--c': colour, animationDelay: `${index * 90}ms` } as CSSProperties} data-testid={testId}>
      <span className={c.band} aria-hidden="true" />
      {role ? (
        <span className={c.cls}>
          <RoleIcon path={ROLE_ICON[role]} />
          <span>{role}</span>
        </span>
      ) : null}
      {editHref ? (
        <Link className={c.edit} href={editHref} aria-label={`Open the agent editor for ${name}`}>
          <RoleIcon path="M4 18l1-4 9-9 3 3-9 9-4 1zM12 7l3 3" size={14} />
          <span>Edit</span>
        </Link>
      ) : null}
      {onRemove ? (
        <button type="button" className={c.rm} onClick={onRemove} disabled={disabled} aria-label={`Remove ${name}`}>
          ×
        </button>
      ) : null}
      <AgentPortrait
        body={agent ? agentColour(agent) : '#34e0c8'}
        head={agent ? agentBone(agent) : '#ece8e1'}
        label={role ? `${name}, ${role}` : name}
        className={c.portrait}
      />
      <div className={c.info}>
        <div className={c.nm}>
          <b>{name}</b>
          {action && fit ? (
            <span title={action.hint} data-muted={fit.effect ? undefined : ''} data-testid="crew-action">
              {action.label}
              <span className="sk-sr-only">. {action.hint}</span>
            </span>
          ) : null}
        </div>
        {fit ? (
          <div className={c.chips}>
            {fit.verb ? (
              <span className={c.chip} data-fit="" title={action?.hint}>
                {fit.verb}
              </span>
            ) : (
              <span className={c.chip} data-muted="" title={action?.hint}>
                {fit.effect ? 'not used on this map' : 'take + deliver only'}
              </span>
            )}
          </div>
        ) : null}
        {agent ? (
          <SkillLine skill={skill} mine={skillMine ?? null} href={editHref} />
        ) : null}
        {agent ? (
          <div className={c.attrs}>
            <span>VISION</span>
            <Pips value={agentVision(agent)} max={5} colour={colour} label="Vision" />
            <span>COMMS</span>
            <span>
              <Pips value={agentComms(agent)} max={5} colour={colour} label="Comms" /> <span className={c.reach}>{reachOf(agentComms(agent))} tiles</span>
            </span>
            <span>VOICE</span>
            <span>{agentVoice(agent)}</span>
          </div>
        ) : null}
        {agent ? <XpBar agent={agent} compact /> : null}
        <div className={c.talk}>
          <span className="sk-kick">Talk tier</span>
          <TalkTierPicker name={name} value={tier} ranked={ranked} disabled={disabled} onChange={onTier} />
        </div>
        {model && model.models.length > 1 ? (
          <ModelPicker name={name} models={model.models} value={model.value} tier={tier} ranked={ranked} disabled={disabled} {...(model.onChange ? { onChange: model.onChange } : {})} />
        ) : null}
      </div>
    </div>
  );
}

function SkillLine({ skill, mine, href }: { skill: Agent['skills'][number] | undefined; mine: boolean | null; href?: string }) {
  const body = (
    <>
      <small>
        {skill ? `Skill · v${skill.version}${mine === null ? '' : mine ? ' · yours' : ' · prompt encrypted'}` : 'Skill'}
      </small>
      <b>{skill ? skill.name : 'No skill equipped'}</b>
      {skill && mine === false ? (
        <span className={c.redact} aria-hidden="true">
          <i style={{ width: 60 }} />
          <i style={{ width: 34 }} />
          <i style={{ width: 48 }} />
        </span>
      ) : null}
    </>
  );
  return href ? (
    <Link className={c.sk} href={href} title="Open the agent editor">
      {body}
    </Link>
  ) : (
    <div className={c.sk}>{body}</div>
  );
}

/** An empty slot (0-based `index`): points at the roster. */
export function EmptySlot({ index, onAdd, disabled }: { index: number; onAdd: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`${c.op} ${c.empty}`} onClick={onAdd} disabled={disabled}>
      <span>
        <span className={c.plus} aria-hidden="true">
          +
        </span>
        <span className="sk-kick">Add agent</span>
        <span className={c.emptyNote}>
          {index === 2 ? 'A third agent covers more verbs. Fielding more than the rival gives them a 10 s head start.' : 'Pick from your roster below.'}
        </span>
      </span>
    </button>
  );
}

/** Every agent on the account; pressed ones are in the crew. */
export function RosterStrip({
  agents,
  picked,
  onToggle,
  disabled,
  testPrefix,
}: {
  agents: Agent[];
  picked: readonly string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  testPrefix: string;
}) {
  return (
    <div className={c.roster} role="group" aria-label="Your roster" id={`${testPrefix}-roster`}>
      {agents.map((a) => (
        <button
          key={a.id}
          type="button"
          className={c.rpick}
          aria-pressed={picked.includes(a.id)}
          disabled={disabled}
          onClick={() => onToggle(a.id)}
          style={{ '--c': agentColour(a) } as CSSProperties}
          data-testid={`${testPrefix}-roster-${a.id}`}
        >
          <AgentPortrait body={agentColour(a)} head={agentBone(a)} label={a.name} className={c.face} />
          <span>{a.name}</span>
          <small>{agentRole(a)}</small>
        </button>
      ))}
    </div>
  );
}

/** The hold for a full clock (engine holdFor: whole credits, rounded up once) and the per-tick rates behind it. */
export function CreditEstimate({ ticks, rates, hold, children, 'data-testid': testId }: { ticks: number; rates: number[]; hold: number; children?: ReactNode; 'data-testid'?: string }) {
  return (
    <div className={`sk-panel ${c.est}`} data-testid={testId}>
      <span className="sk-kick">Estimated credits · full {clock((ticks * TICK_MS) / 1000)}</span>
      <div className={c.estN}>{fmt(hold)}</div>
      <div className={c.formula}>
        {ticks} ticks × ({rates.length ? rates.map((r, i) => (
          <span key={i}>
            {i ? ' + ' : ''}
            <b>{fmtRate(r)}</b>
          </span>
        )) : <b>0</b>}) credits per tick
      </div>
      {children}
      <p className={c.fine}>Unused credits come back when the match ends early.</p>
    </div>
  );
}

/** Easy … Mega Agentic. `lock` (ranked) leaves Normal only. */
export function DifficultyPicker({ value, lock, onChange }: { value: number; lock: boolean; onChange?: (i: number) => void }) {
  const di = lock ? 1 : value;
  return (
    <div className={c.dseg} role="group" aria-label="Difficulty">
      {DIFFS.map((d, i) => (
        <button
          key={d.k}
          type="button"
          style={{ '--dc': d.c } as CSSProperties}
          aria-pressed={i === di}
          disabled={lock && i !== 1}
          title={`${d.n}: ${d.line}`}
          onClick={() => (i === di ? undefined : onChange?.(i))}
          data-testid={`diff-${d.k}`}
        >
          {i === 4 ? 'Mega' : d.n}
          <small>{i === 4 ? 'AGENTIC' : ['I', 'II', 'III', 'IV'][i]}</small>
        </button>
      ))}
    </div>
  );
}

/** The goal of `map` at difficulty index `di`. */
export function GoalBox({ map, di, lock }: { map: V2Map; di: number; lock: boolean }) {
  const d = DIFFS[di] ?? DIFFS[1]!;
  const g = goalOf(map, di);
  return (
    <div className={c.goalbox} style={{ '--dc': d.c } as CSSProperties} data-testid="goal-box">
      <small>
        {d.n} · goal on {map.name}
      </small>
      <b>{g.t}</b>
      <span>{g.d}</span>
      <small className={c.goalFoot}>{lock ? 'Ranked always plays Normal, so both crews chase the same goal.' : d.line}</small>
    </div>
  );
}
