// Skill triggers: an optional, structured condition on a skill version. A skill with a trigger is
// put into its agent's prompt only on ticks where the condition holds, judged from that agent's own
// fogged view and the score (the engine's skillTriggerHolds). Triggers are public metadata, shown on
// the Exchange; the prompt they gate stays sealed. Never free text: a small typed set, checked here
// and by the api, so a trigger can never carry prompt text.

export const SKILL_TRIGGER_KINDS = [
  'always',
  'hazard_within',
  'behind_on_score',
  'ahead_on_score',
  'rival_near_switch',
  'carrying_item',
  'time_left_under',
] as const;
export type SkillTriggerKind = (typeof SKILL_TRIGGER_KINDS)[number];

/** Bounds for the triggers that take a number (tiles are grid steps; seconds of match clock). */
export const SKILL_TRIGGER_LIMITS = {
  tiles: { min: 1, max: 10, default: 3 },
  seconds: { min: 10, max: 300, default: 60 },
} as const;

export type SkillTrigger =
  | { kind: 'always' }
  /** A hazard tile (water, fire or lava) the crew has seen is within `tiles` steps of the agent. */
  | { kind: 'hazard_within'; tiles: number }
  | { kind: 'behind_on_score' }
  | { kind: 'ahead_on_score' }
  /** A rival in sight stands within `tiles` steps of a switch the crew has seen. */
  | { kind: 'rival_near_switch'; tiles: number }
  /** The agent carries at least one item. */
  | { kind: 'carrying_item' }
  /** Less than `seconds` of match time is left. */
  | { kind: 'time_left_under'; seconds: number };

export const ALWAYS_TRIGGER: SkillTrigger = { kind: 'always' };

/** Which kinds take a number, and which. */
export const SKILL_TRIGGER_PARAM: Partial<Record<SkillTriggerKind, 'tiles' | 'seconds'>> = {
  hazard_within: 'tiles',
  rival_near_switch: 'tiles',
  time_left_under: 'seconds',
};

const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * A stored or sent trigger as a SkillTrigger, or null when it is not a valid one (unknown kind,
 * a number out of range, extra keys). null and undefined read as `always`.
 */
export function parseSkillTrigger(v: unknown): SkillTrigger | null {
  if (v === null || v === undefined) return ALWAYS_TRIGGER;
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== 'string' || !(SKILL_TRIGGER_KINDS as readonly string[]).includes(kind)) return null;
  const param = SKILL_TRIGGER_PARAM[kind as SkillTriggerKind];
  const keys = Object.keys(o).filter((k) => k !== 'kind');
  if (!param) return keys.length === 0 ? ({ kind } as SkillTrigger) : null;
  if (keys.length !== 1 || keys[0] !== param) return null;
  const lim = SKILL_TRIGGER_LIMITS[param];
  if (!intIn(o[param], lim.min, lim.max)) return null;
  return { kind, [param]: o[param] } as SkillTrigger;
}

/** The trigger to store: null for `always` (the column default), else the trigger. */
export const storedSkillTrigger = (t: SkillTrigger | null | undefined): SkillTrigger | null =>
  !t || t.kind === 'always' ? null : t;

/** A stored trigger as read back (null or anything unreadable plays as `always`). */
export const skillTriggerOf = (v: unknown): SkillTrigger => parseSkillTrigger(v) ?? ALWAYS_TRIGGER;

/** A default trigger of a kind (numbers at their defaults), for editors. */
export function defaultSkillTrigger(kind: SkillTriggerKind): SkillTrigger {
  const param = SKILL_TRIGGER_PARAM[kind];
  return (param ? { kind, [param]: SKILL_TRIGGER_LIMITS[param].default } : { kind }) as SkillTrigger;
}

/** Short names of the kinds, for pickers. */
export const SKILL_TRIGGER_NAME: Record<SkillTriggerKind, string> = {
  always: 'Always',
  hazard_within: 'Hazard nearby',
  behind_on_score: 'Behind on score',
  ahead_on_score: 'Ahead on score',
  rival_near_switch: 'Rival near a switch',
  carrying_item: 'Carrying an item',
  time_left_under: 'Clock running out',
};

/** The trigger in words: "Always", "A hazard within 3 tiles", "Under 60 s left". */
export function describeSkillTrigger(t: SkillTrigger | null | undefined): string {
  const x = t ?? ALWAYS_TRIGGER;
  switch (x.kind) {
    case 'always':
      return 'Always';
    case 'hazard_within':
      return `A hazard within ${x.tiles} ${x.tiles === 1 ? 'tile' : 'tiles'}`;
    case 'behind_on_score':
      return 'Behind on score';
    case 'ahead_on_score':
      return 'Ahead on score';
    case 'rival_near_switch':
      return `A rival within ${x.tiles} ${x.tiles === 1 ? 'tile' : 'tiles'} of a switch`;
    case 'carrying_item':
      return 'Carrying an item';
    case 'time_left_under':
      return `Under ${x.seconds} s left`;
  }
}
