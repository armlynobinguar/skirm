// Skill triggers, judged each tick from one agent's own Observation: its fogged board, itself, the
// agents in sight and the score. Nothing the agent cannot see counts (a hazard or switch the crew
// never saw, a rival out of sight). The trigger types live in @skirm/shared (public metadata).
import { ALWAYS_TRIGGER, type SkillTrigger } from '@skirm/shared';
import { TICK_MS } from './match';
import type { Observation } from './observe';

export type { SkillTrigger };

/** Hazard tiles as the board rows draw them: water, fire, lava. */
const HAZARD_CHARS = '~^L';
const SWITCH_CHAR = 'V';

/** Whether a tile drawn with one of `chars` lies within `n` grid steps (no diagonals) of (x, y) on the agent's board. */
function seenWithin(o: Observation, chars: string, x: number, y: number, n: number): boolean {
  for (let ty = Math.max(0, y - n); ty <= Math.min(o.rows.length - 1, y + n); ty++) {
    const row = o.rows[ty]!;
    const span = n - Math.abs(ty - y);
    for (let tx = Math.max(0, x - span); tx <= Math.min(row.length - 1, x + span); tx++) if (chars.includes(row[tx]!)) return true;
  }
  return false;
}

/** Seconds of match time left at this observation. */
export const secondsLeft = (o: Observation) => (o.ticksLeft * TICK_MS) / 1000;

/** Whether a skill's trigger holds for this agent on this tick (null: always). */
export function skillTriggerHolds(trigger: SkillTrigger | null | undefined, o: Observation): boolean {
  const t = trigger ?? ALWAYS_TRIGGER;
  switch (t.kind) {
    case 'always':
      return true;
    case 'hazard_within':
      return seenWithin(o, HAZARD_CHARS, o.me.x, o.me.y, t.tiles);
    case 'behind_on_score':
      return o.score.mine < o.score.rival;
    case 'ahead_on_score':
      return o.score.mine > o.score.rival;
    case 'rival_near_switch':
      return o.rivals.some((r) => !r.down && seenWithin(o, SWITCH_CHAR, r.x, r.y, t.tiles));
    case 'carrying_item':
      return o.me.carrying > 0;
    case 'time_left_under':
      return secondsLeft(o) < t.seconds;
    default:
      return true;
  }
}

/** Per skill, whether it is active this tick (triggers in skill order; missing ones are always). */
export function skillActivity(triggers: readonly (SkillTrigger | null | undefined)[], o: Observation): boolean[] {
  return triggers.map((t) => skillTriggerHolds(t, o));
}
