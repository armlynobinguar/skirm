// Live commands: a player's short directive to one agent or the whole crew during a match. Each crew
// has DEFAULTS.commands.perMatch of them. A command is a preset (hold the gate, go for the drop,
// regroup, block the flow), optional free text, or both. It is applied on the next tick: it goes into
// the hash-chained match log with that tick (LogTick.commands), into the targeted agents' prompts for
// DEFAULTS.commands.activeTicks ticks, and into the crew's own frames and debrief. The rival never
// sees it (not in its frames, the watch view or the public transcript).
import type { Team } from './map';
import type { MatchState } from './match';

export const COMMAND_PRESETS = {
  hold_gate: {
    label: 'Hold the gate',
    order:
      'Hold the gate: stay near your delivery point and the chokepoint in front of it, keep it clear for your crew and block rivals from it. Deliver what you carry, but do not wander far.',
  },
  go_drop: {
    label: 'Go for the drop',
    order:
      'Go for the drop: head for the supply drop (or the middle items if none has landed) and take it before the rival does, then deliver it.',
  },
  regroup: {
    label: 'Regroup',
    order:
      'Regroup: move back next to your crew mates and stay together until the order runs out. Deliver what you carry on the way.',
  },
  block_flow: {
    label: 'Block the flow',
    order:
      'Block the flow: use your verbs to stop the spreading hazard where it threatens your crew or the delivery route (build, dig or put it out), before going back to items.',
  },
} as const;

export type CommandPreset = keyof typeof COMMAND_PRESETS;
export const COMMAND_PRESET_IDS = Object.keys(COMMAND_PRESETS) as CommandPreset[];
export const isCommandPreset = (v: unknown): v is CommandPreset =>
  typeof v === 'string' && Object.hasOwn(COMMAND_PRESETS, v);

/** One command as logged and shown to its crew: who it went to, the preset and the player's words. */
export interface CrewCommand {
  team: Team;
  /** The agents it went to (the whole crew still in the match when no single agent was named). */
  agents: string[];
  preset: CommandPreset | null;
  /** Free text that passed the leak and abuse filter; null for a preset alone. */
  text: string | null;
}

/** A command in a crew's frame and debrief: the tick it was applied on and until when it holds. */
export interface FrameCommand {
  tick: number;
  /** Last tick the order is still in the agents' prompts. */
  until: number;
  agents: string[];
  preset: CommandPreset | null;
  text: string | null;
}

/** What a crew's own frames carry about its commands (never the rival's or the watch view). */
export interface FrameCommands {
  /** Commands the crew can still send. */
  left: number;
  /** Every command applied so far, oldest first. */
  log: FrameCommand[];
}

/** The order an agent's model is given: the preset's directive, then the player's own words. */
export function commandOrder(c: Pick<CrewCommand, 'preset' | 'text'>): string {
  const parts: string[] = [];
  if (c.preset) parts.push(COMMAND_PRESETS[c.preset].order);
  if (c.text) parts.push(`Your player adds: "${c.text}"`);
  return parts.join(' ');
}

/** A short line for feeds and transcripts: "Regroup · stay low". */
export function commandLabel(c: Pick<CrewCommand, 'preset' | 'text'>): string {
  return [c.preset ? COMMAND_PRESETS[c.preset].label : null, c.text].filter(Boolean).join(' · ');
}

/**
 * Where "go for the drop" points: the supply drops that have landed and still hold an item, else the
 * middle tiles that still do. Both are known to both crews, so this reveals nothing hidden.
 */
export function dropTargets(s: MatchState): [number, number][] {
  const { w } = s.map;
  const at = (j: number): [number, number] => [j % w, (j / w) | 0];
  const landed = s.map.def.drops
    .filter((d) => d.tick <= s.tick && s.grid[d.at[1] * w + d.at[0]] === 'item')
    .map((d) => d.at);
  if (landed.length) return landed.map(([x, y]) => [x, y]);
  return s.middle.filter((j) => s.grid[j] === 'item').map(at);
}
