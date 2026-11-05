'use client';
// Agent progression on the web: the level and XP bar (crew cards and the agent editor) and the trait
// picker (agent editor). XP comes from ranked and casual matches played to the end; at each trait
// level the owner picks one trait (POST /agents/:id/traits), at most DEFAULTS.progression.maxTraits.
// Traits are one small step on one stat each and play in casual matches; ranked plays base stats.
import { TRAITS, type AgentProgression, type TraitId } from '@skirm/shared';
import { fmt } from '@skirm/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/toast/ToastProvider';
import { qk } from '@/lib/api/queries';
import type { Agent } from '@/lib/api/types';
import { useApi } from '@/lib/services';
import p from './progression.module.css';

/** How far through its level the agent is, 0 to 100 (100 at the top level). */
export function levelPct(g: AgentProgression): number {
  if (g.nextLevelXp === null) return 100;
  const span = g.nextLevelXp - g.levelXp;
  return span > 0 ? Math.max(0, Math.min(100, Math.round(((g.xp - g.levelXp) / span) * 100))) : 100;
}

/** "LV 3" with the bar to the next level; nothing for an agent without progression (older server). */
export function XpBar({ agent, compact }: { agent: Agent; compact?: boolean }) {
  const g = agent.progression;
  if (!g) return null;
  const pct = levelPct(g);
  const open = g.traitSlots - g.traits.length;
  const label = g.nextLevelXp === null ? `Level ${g.level} (top), ${fmt(g.xp)} XP` : `Level ${g.level}, ${fmt(g.xp)} of ${fmt(g.nextLevelXp)} XP to level ${g.level + 1}`;
  return (
    <div className={p.xp} data-compact={compact || undefined} data-testid={`agent-xp-${agent.id}`}>
      <b className={p.lv}>LV {g.level}</b>
      <span className={p.bar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <small className={p.num}>{g.nextLevelXp === null ? `${fmt(g.xp)} XP` : `${fmt(g.xp)}/${fmt(g.nextLevelXp)} XP`}</small>
      {open > 0 ? (
        <span className={p.ready} title="A trait pick is waiting in the agent editor">
          Trait ready
        </span>
      ) : null}
    </div>
  );
}

/** The agent editor's progression section: level, XP, the traits held and the picker for an open slot. */
export function ProgressionPanel({ agent }: { agent: Agent }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const info = useQuery({ queryKey: qk.agentProgression(agent.id), queryFn: () => api.agentProgression(agent.id), retry: false });
  const g = info.data?.progression ?? agent.progression;
  const pick = useMutation({
    mutationFn: (trait: TraitId) => api.pickTrait(agent.id, trait),
    onSuccess: (_a, trait) => {
      toast.show({ tone: 'good', title: 'Trait picked', message: `${agent.name} is now ${TRAITS[trait].name}. It plays from the next casual match.` });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (err) => toast.error(err),
  });
  if (!g) return null;
  const open = g.traitSlots - g.traits.length;
  const catalogue = info.data?.traits ?? Object.values(TRAITS);
  const nextTrait = g.nextTraitLevel;
  return (
    <section className={p.panel} aria-label="Progression" data-testid="agent-progression">
      <XpBar agent={{ ...agent, progression: g }} />
      {g.traits.length ? (
        <ul className={p.held} aria-label="Traits">
          {g.traits.map((t) => (
            <li key={t} title={TRAITS[t].effect} data-testid={`agent-trait-${t}`}>
              <b>{TRAITS[t].name}</b> <small>{TRAITS[t].effect}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {open > 0 ? (
        <div className={p.picker} role="group" aria-label="Pick a trait" data-testid="trait-picker">
          <small className={p.hint}>Pick a trait · one small step on one stat, casual matches only</small>
          {catalogue
            .filter((t) => !g.traits.includes(t.id))
            .map((t) => (
              <button
                key={t.id}
                type="button"
                className={p.pick}
                disabled={pick.isPending}
                onClick={() => pick.mutate(t.id)}
                data-testid={`trait-pick-${t.id}`}
              >
                <b>{t.name}</b>
                <small>{t.effect}</small>
              </button>
            ))}
        </div>
      ) : (
        <small className={p.hint}>
          {nextTrait ? `Next trait at level ${nextTrait}.` : 'Every trait slot is taken.'}
          {info.data && !info.data.rankedTraits ? ' Ranked plays base stats.' : ''}
        </small>
      )}
    </section>
  );
}
