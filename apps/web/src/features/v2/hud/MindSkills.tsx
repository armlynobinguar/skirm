'use client';
// The mind panel's skill list (own crew only): each equipped skill by name and trigger, and whether
// its trigger held on the agent's last turn, i.e. whether the skill was in its prompt. Names and
// triggers are public metadata; the prompt never reaches the client.
import type { FrameSkill } from '@skirm/engine/v2';
import { describeSkillTrigger } from '@skirm/shared';
import m from './mindskills.module.css';

export function MindSkills({ skills }: { skills: readonly FrameSkill[] | undefined }) {
  if (!skills?.length) return null;
  const on = skills.filter((k) => k.active).length;
  return (
    <section data-testid="v2-mind-skills">
      <h3>
        Skills{' '}
        <em>
          {on} of {skills.length} active
        </em>
      </h3>
      <ul className={m.list}>
        {skills.map((k, i) => (
          <li
            key={`${k.name}-${i}`}
            className={`${m.row} ${k.active ? m.on : m.off}`}
            data-testid="v2-mind-skill"
            data-active={k.active ? 'true' : 'false'}
          >
            <b>{k.name}</b>
            <span className={m.state}>{k.active ? 'Active' : 'Inactive'}</span>
            <span className={m.trig}>{describeSkillTrigger(k.trigger)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
