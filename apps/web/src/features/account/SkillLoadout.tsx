'use client';
// "Customize agent" → Skills: equip up to 3 owned skills on one agent, or go write a new skill or
// browse the skills directory (Market) for ready-made ones. Equipping is refused while the agent is
// in a match (409 agent_busy), like every other gameplay change.
import type { Unlock } from '@skirm/shared';
import { Button, UnlockChip } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { Skeleton } from '@/components/states/Skeleton';
import { ErrorCard } from '@/components/states/ErrorCard';
import { qk } from '@/lib/api/queries';
import type { Agent, SkillRef, SkillRow } from '@/lib/api/types';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import s from './account.module.css';

export const MAX_EQUIPPED = 3;

const sameRef = (a: SkillRef, b: SkillRef) => a.id === b.id && a.version === b.version;

/** Skills the agent cannot use yet: they need an unlock it does not carry. */
export function missingUnlocks(
  skill: Pick<SkillRow, 'requiredUnlocks'>,
  unlocks: readonly Unlock[],
): Unlock[] {
  return skill.requiredUnlocks.filter((u) => !unlocks.includes(u));
}

export function SkillLoadout({
  agent,
  saving,
  onSave,
  onCancel,
}: {
  agent: Agent;
  saving: boolean;
  onSave: (skills: SkillRef[]) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const owned = useQuery({ queryKey: qk.skills.list('owned'), queryFn: () => api.skills('owned') });
  const [picked, setPicked] = useState<SkillRef[]>(
    agent.skills.map(({ id, version }) => ({ id, version })),
  );
  const changed =
    picked.length !== agent.skills.length ||
    picked.some((p) => !agent.skills.some((a) => sameRef(a, p)));

  if (owned.isError)
    return (
      <ErrorCard
        error={owned.error}
        title="Your skills did not load"
        onRetry={() => void owned.refetch()}
      />
    );
  if (!owned.data) return <Skeleton rows={4} label="Loading your skills" />;

  const toggle = (r: SkillRef) =>
    setPicked((list) =>
      list.some((p) => sameRef(p, r))
        ? list.filter((p) => !sameRef(p, r))
        : list.length < MAX_EQUIPPED
          ? [...list.filter((p) => p.id !== r.id), r]
          : list,
    );

  return (
    <div className={s.loadout} data-testid="skill-loadout">
      <p className={s.note}>
        Equip up to {MAX_EQUIPPED} skills on {agent.name}. Skills are strategies the agent follows
        in a match; their text stays private to the writer.
      </p>

      {owned.data.length === 0 ? (
        <p className={s.note} data-testid="skill-loadout-empty">
          You do not own any skills yet. Write your own, or pick a ready-made one from the skills
          directory.
        </p>
      ) : (
        <ul className={s.loadoutList}>
          {owned.data.map((sk) => {
            const ref = { id: sk.id, version: sk.version };
            const on = picked.some((p) => sameRef(p, ref));
            const full = !on && picked.length >= MAX_EQUIPPED;
            const missing = missingUnlocks(sk, agent.unlocks);
            return (
              <li key={`${sk.id}:${sk.version}`}>
                <label className={s.loadoutItem} data-disabled={full || undefined}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={full}
                    onChange={() => toggle(ref)}
                    data-testid={`skill-loadout-${sk.id}`}
                  />
                  <span className={s.loadoutText}>
                    <b>
                      {sk.name} <span className="sk-muted">v{sk.version}</span>
                    </b>
                    {sk.summary ? <span className={s.note}>{sk.summary}</span> : null}
                    {missing.length ? (
                      <span className={s.loadoutWarn}>
                        Needs{' '}
                        {missing.map((u) => (
                          <UnlockChip key={u} unlock={u} />
                        ))}{' '}
                        to use its moves
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className={s.loadoutLinks}>
        <ButtonLink
          size="sm"
          variant="ghost"
          href={routes.newSkill()}
          data-testid="skill-loadout-write"
        >
          Write your own skill
        </ButtonLink>
        <ButtonLink
          size="sm"
          variant="ghost"
          href={routes.market()}
          data-testid="skill-loadout-directory"
        >
          Browse the skills directory
        </ButtonLink>
      </div>

      <div className={s.loadoutActions}>
        <span className={s.note}>
          {picked.length} of {MAX_EQUIPPED} equipped
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!changed || saving}
          onClick={() => onSave(picked)}
          data-testid="skill-loadout-save"
        >
          {saving ? 'Saving…' : 'Save skills'}
        </Button>
      </div>
    </div>
  );
}
