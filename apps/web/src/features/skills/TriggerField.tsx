'use client';
// Skill triggers in the web app: the S08 picker ("When it plays") and the read-only line the skill
// detail page and the mind panel show. A trigger is public metadata from a small typed set
// (@skirm/shared SkillTrigger), never free text; the prompt it gates stays sealed.
import {
  SKILL_TRIGGER_KINDS,
  SKILL_TRIGGER_LIMITS,
  SKILL_TRIGGER_NAME,
  SKILL_TRIGGER_PARAM,
  defaultSkillTrigger,
  describeSkillTrigger,
  type SkillTrigger,
  type SkillTriggerKind,
} from '@skirm/shared';
import s from './skills.module.css';

/** One line on when the skill plays, for people reading a skill. */
export function triggerSentence(t: SkillTrigger | null | undefined): string {
  return !t || t.kind === 'always' ? 'Always in the prompt.' : `Only while: ${describeSkillTrigger(t).toLowerCase()}.`;
}

export function TriggerField({
  value,
  onChange,
  error,
}: {
  value: SkillTrigger;
  onChange: (t: SkillTrigger) => void;
  error: string | undefined;
}) {
  const param = SKILL_TRIGGER_PARAM[value.kind];
  const lim = param ? SKILL_TRIGGER_LIMITS[param] : null;
  const num = param ? (value as Record<string, unknown>)[param] : undefined;
  return (
    <fieldset className={s.fieldset}>
      <legend className={s.legend}>When it plays</legend>
      <select
        className={s.select}
        aria-label="Trigger"
        value={value.kind}
        onChange={(e) => onChange(defaultSkillTrigger(e.target.value as SkillTriggerKind))}
        data-testid="s08-trigger"
      >
        {SKILL_TRIGGER_KINDS.map((k) => (
          <option key={k} value={k}>
            {SKILL_TRIGGER_NAME[k]}
          </option>
        ))}
      </select>
      {param && lim ? (
        <label className="app-small">
          {param === 'tiles' ? 'Within (tiles)' : 'Seconds left under'}{' '}
          <input
            className={s.select}
            type="number"
            min={lim.min}
            max={lim.max}
            step={1}
            value={typeof num === 'number' && Number.isFinite(num) ? num : ''}
            onChange={(e) => onChange({ ...value, [param]: e.target.value === '' ? NaN : Number(e.target.value) } as SkillTrigger)}
            data-testid="s08-trigger-value"
          />
        </label>
      ) : null}
      {error ? (
        <span className={s.fieldErr} role="alert">
          {error}
        </span>
      ) : (
        <span className="app-small sk-muted" data-testid="s08-trigger-hint">
          {triggerSentence(value)} The engine checks it every tick from the agent’s own view. Shown on the Exchange; the
          prompt stays private.
        </span>
      )}
    </fieldset>
  );
}
