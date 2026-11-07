// What the player sees when it clicks a tile or an agent on the live board (Inspect.tsx): the
// thing's name in the map's own words (its legend: "Rubble", "Shaft water", "Cage lift") and what it
// does in the rules, from the engine's map definition and the frame. Only what this crew's frame
// shows: an unseen tile says so, and a rival is described as far as it is in sight.
import { mapV2, type FrameAgent, type MapDefV2, type Team, type V2Frame } from '@skirm/engine/v2';
import { mapById } from '@/features/arena/world';

export interface Inspected {
  /** Kind line, e.g. "Hazard", "Goal item", "Your crew". */
  kind: string;
  title: string;
  lines: string[];
  /** The agent, when an agent was clicked (for "Watch in 3rd person"). */
  agentId?: string;
  tone: 'you' | 'rival' | 'hazard' | 'goal' | 'plain';
}

type Legend = Partial<Record<string, string | [string, string]>>;

const secs = (ticks: number, tickMs: number) => `${Math.round((ticks * tickMs) / 1000)} s`;

function legendOf(mapId: string): Legend {
  return ((mapById(mapId) as unknown as { legend?: Legend } | undefined)?.legend ?? {}) as Legend;
}

function named(legend: Legend, key: string, fallback: string): string {
  const v = legend[key];
  return (Array.isArray(v) ? v[0] : v) || fallback;
}

/** The agent on a tile, as this crew's frame shows it. */
function agentAt(frame: V2Frame, x: number, y: number): FrameAgent | undefined {
  return frame.agents.find((a) => a.x === x && a.y === y && !a.out);
}

export function inspectAgent(a: FrameAgent, team: Team | 'watch'): Inspected {
  const ours = team !== 'watch' && a.team === team;
  const status = a.out ? 'Out of the match' : a.down ? 'Knocked down: up again in a moment' : 'Active';
  const lines = [`${a.role} · ${a.tier} talk`, status, `Carrying ${a.items.length} · delivered ${a.delivered}`];
  if (a.tool) lines.push(`Holding a ${a.tool}`);
  return {
    kind: team === 'watch' ? `Crew ${a.team}` : ours ? 'Your crew' : 'Rival crew',
    title: a.name,
    lines,
    agentId: a.id,
    tone: team === 'watch' ? (a.team === 'A' ? 'you' : 'rival') : ours ? 'you' : 'rival',
  };
}

/** The tile (and anything on it) at x, y in this frame, or null off the board. */
export function inspectTile(frame: V2Frame, x: number, y: number, tickMs: number): Inspected | null {
  const ch = frame.rows[y]?.[x];
  if (ch === undefined) return null;
  const agent = agentAt(frame, x, y);
  if (agent) return inspectAgent(agent, frame.view);
  const def = mapV2(frame.mapId) as MapDefV2 | undefined;
  const legend = legendOf(frame.mapId);
  const every = (k: string) => def?.hazards.find((h) => h.kind === k)?.every;
  const extra: string[] = [];
  const w = frame.rows[0]?.length ?? 0;
  if (frame.gas?.includes(y * w + x)) extra.push('Gas cloud here: an agent standing in it loses turns coughing.');
  const tool = frame.tools?.find((t) => t.at[0] === x && t.at[1] === y);
  if (tool) extra.push(`A ${tool.kind} lies here: an agent can pick it up and use it.`);
  const placed = frame.placed?.find((t) => t.at[0] === x && t.at[1] === y);
  if (placed) extra.push(`A placed ${placed.kind}.`);
  const drop = def?.drops.find((d) => d.at[0] === x && d.at[1] === y && d.tick > frame.tick);
  if (drop) extra.push(`A supply drop lands here in ${secs(drop.tick - frame.tick, tickMs)}.`);
  const ice = def?.ice?.some(([ix, iy]) => ix === x && iy === y);
  const hazard = (key: 'water' | 'fire' | 'lava', what: string): Inspected => {
    const n = every(key);
    return {
      kind: 'Hazard',
      title: named(legend, key, key[0]!.toUpperCase() + key.slice(1)),
      lines: [n ? `Spreads every ${n} ticks (${secs(n, tickMs)}), ${what}` : what.replace(/^./, (c) => c.toUpperCase()), ...extra],
      tone: 'hazard',
    };
  };
  switch (ch) {
    case '?':
      return { kind: 'Unseen', title: 'Out of sight', lines: ['Your crew has not seen this tile yet. Send an agent closer to find out.'], tone: 'plain' };
    case '#':
      return { kind: 'Wall', title: named(legend, 'wall', 'Wall'), lines: ['Solid: nothing moves through it.', ...extra], tone: 'plain' };
    case ',':
      return { kind: 'Ground', title: named(legend, 'fuel', 'Grass'), lines: ['Walkable. Fire spreads through it, and water floods it.', ...extra], tone: 'plain' };
    case 'T':
      return { kind: 'Obstacle', title: named(legend, 'tree', 'Tree'), lines: ['Solid. Fire spreads through it.', ...extra], tone: 'plain' };
    case 'd':
      return { kind: 'Obstacle', title: named(legend, 'dirt', 'Rubble'), lines: ['Blocks the way until an agent digs it out. Gas does not drift past it.', ...extra], tone: 'plain' };
    case 'c':
      return { kind: 'Obstacle', title: named(legend, 'crate', 'Crate'), lines: ['Blocks the way. Fire spreads through it.', ...extra], tone: 'plain' };
    case 'B':
      return { kind: 'Placed block', title: 'Block', lines: ['Placed by a Builder: solid, walls off a hazard or a rival.', ...extra], tone: 'plain' };
    case '~':
      return hazard('water', 'into open floor and grass. An agent it reaches is knocked down and drops what it carries. A bridge crosses it; sandbags hold it back.');
    case '^':
      return hazard('fire', 'through grass, trees and crates. An agent it reaches is knocked down and drops what it carries.');
    case 'L':
      return hazard('lava', 'over open ground. An agent it reaches is out of the match.');
    case '*':
      return {
        kind: 'Goal item',
        title: def?.item ?? named(legend, 'supply', 'Item'),
        lines: [`Pick it up and carry it to the ${def?.deliverTo ?? 'exit'}. First crew to deliver ${frame.goal} wins.`, ...extra],
        tone: 'goal',
      };
    case 'E':
      return { kind: 'Delivery point', title: def?.deliverTo ?? named(legend, 'exit', 'Exit'), lines: [`Deliver the ${(def?.item ?? 'items').toLowerCase()} here. First crew to ${frame.goal} wins.`, ...extra], tone: 'goal' };
    case 'V': {
      const sw = def?.switches.find((s) => s.at[0] === x && s.at[1] === y);
      return {
        kind: 'Switch',
        title: sw?.name ?? 'Switch',
        lines: [`Using it puts ${sw?.kind === 'dirt' ? 'rubble' : (sw?.kind ?? 'a hazard')} in the rival crew's lane, and knocks down whoever stands there.`, ...extra],
        tone: 'hazard',
      };
    }
    default:
      return {
        kind: 'Ground',
        title: ice ? 'Ice' : named(legend, 'floor', 'Floor'),
        lines: [ice ? 'Slippery: a step onto it slides one tile further the same way.' : 'Open floor: agents walk here. Water floods it.', ...extra],
        tone: 'plain',
      };
  }
}
