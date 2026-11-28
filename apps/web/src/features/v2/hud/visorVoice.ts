// The visor's inner voice: one first-person line from what the watched agent is going for. Its own
// inner voice when the server sent one, else its plan, else a line from what it is doing (carrying,
// swept, out). A rival's mind stays sealed unless the frame carries it (practice), and an agent on a
// bought skill keeps its reasons to itself, as in the mind panel.
import type { FrameAgent, Team } from '@skirm/engine/v2';

export interface VoiceContext {
  /** The viewing crew. */
  team: Team;
  /** The map's goal item and delivery point, e.g. "Lamp oil" to the "Cage lift". */
  item: string;
  deliverTo: string;
  /** Tiles to the delivery point (rounded by the caller). */
  dist: number;
}

export interface VoiceLine {
  /** The small label over the line. */
  kick: string;
  text: string;
}

const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

export function innerVoiceOf(agent: Pick<FrameAgent, 'name' | 'team' | 'items' | 'down' | 'out' | 'plan' | 'thought' | 'planHidden'>, ctx: VoiceContext): VoiceLine {
  const rival = agent.team !== ctx.team;
  if (agent.out) return { kick: 'Visor', text: 'Out of the match. Watching the crew from here.' };
  if (agent.down) return { kick: 'Visor', text: 'Swept off my feet. Up again in a moment.' };
  if (agent.thought) return { kick: 'Inner voice', text: agent.thought };
  if (rival && !agent.plan) return { kick: 'Sealed mind', text: `You hear only what ${agent.name} says aloud.` };
  if (agent.planHidden) return { kick: 'Inner voice', text: 'Running a bought skill. Keeping my reasons to myself.' };
  if (agent.plan) return { kick: 'Intent', text: agent.plan };
  const n = agent.items.length;
  const to = lower(ctx.deliverTo);
  if (n) return { kick: 'Inner voice', text: `${n === 1 ? ctx.item : `${n} × ${lower(ctx.item)}`} in hand. The ${to} is ${ctx.dist} tiles out.` };
  return { kick: 'Inner voice', text: `Hands empty. Looking for ${lower(ctx.item)}.` };
}
