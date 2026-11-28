// The visor's inner voice: one first-person line from what the watched agent is going for. Its own
// inner voice when the server sent one, else its plan, else a line from what it is doing (carrying,
// swept, out). A rival's mind stays sealed unless the frame carries it (practice), and an agent on a
// bought skill keeps its reasons to itself, as in the mind panel.
//
// Skills speak in their own words: when an equipped skill's trigger holds this tick (a hazard close,
// behind on score, ...), the voice is that skill's name, as its author wrote it, and the moment it
// was written for, in the first person (skillVoice). Only the public name and trigger are used; the
// prompt never reaches the client, and nothing here calls a model.
import type { FrameAgent, FrameSkill, Team } from '@skirm/engine/v2';

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
/** A skill name as a spoken sentence: its own words, a full stop added when it has none. */
const said = (name: string) => {
  const n = name.trim();
  return /[.!?…]$/.test(n) ? n : `${n}.`;
};

/** The moment a skill's trigger names, as the agent would put it (empty for `always`). */
export function triggerVoice(t: FrameSkill['trigger'], ctx: Pick<VoiceContext, 'item' | 'deliverTo'>): string {
  switch (t.kind) {
    case 'hazard_within':
      return `A hazard within ${t.tiles} ${t.tiles === 1 ? 'tile' : 'tiles'}. This is what it is for.`;
    case 'behind_on_score':
      return 'We are behind. Time to make it count.';
    case 'ahead_on_score':
      return 'We are ahead. Keep it that way.';
    case 'rival_near_switch':
      return `A rival within ${t.tiles} ${t.tiles === 1 ? 'tile' : 'tiles'} of a switch. Not on my watch.`;
    case 'carrying_item':
      return `${ctx.item} in hand. Get it to the ${lower(ctx.deliverTo)}.`;
    case 'time_left_under':
      return `Under ${t.seconds} seconds left. No more waiting.`;
    default:
      return '';
  }
}

/** The skill to speak for: the first active one whose trigger is a moment (not `always`), else the first active one. */
export function voicedSkill(skills: readonly FrameSkill[] | undefined): FrameSkill | null {
  const on = (skills ?? []).filter((k) => k.active);
  return on.find((k) => k.trigger.kind !== 'always') ?? on[0] ?? null;
}

/** A skill's line: its name in its own words, then the moment it is for. */
export function skillVoice(k: FrameSkill, ctx: Pick<VoiceContext, 'item' | 'deliverTo'>): VoiceLine {
  const why = triggerVoice(k.trigger, ctx);
  return { kick: `Skill · ${k.name}`, text: why ? `“${said(k.name)}” ${why}` : `“${said(k.name)}” Every step, that is how I play.` };
}

export function innerVoiceOf(agent: Pick<FrameAgent, 'name' | 'team' | 'items' | 'down' | 'out' | 'plan' | 'thought' | 'planHidden' | 'skills'>, ctx: VoiceContext): VoiceLine {
  const rival = agent.team !== ctx.team;
  if (agent.out) return { kick: 'Visor', text: 'Out of the match. Watching the crew from here.' };
  if (agent.down) return { kick: 'Visor', text: 'Swept off my feet. Up again in a moment.' };
  // A skill whose moment has come speaks first; an always-on skill lets its own thought through.
  const skill = voicedSkill(agent.skills);
  if (skill && skill.trigger.kind !== 'always') return skillVoice(skill, ctx);
  if (agent.thought) return { kick: skill ? `Inner voice · ${skill.name}` : 'Inner voice', text: agent.thought };
  if (skill && !agent.plan) return skillVoice(skill, ctx);
  if (rival && !agent.plan) return { kick: 'Sealed mind', text: `You hear only what ${agent.name} says aloud.` };
  if (agent.planHidden) return { kick: 'Inner voice', text: 'Running a bought skill. Keeping my reasons to myself.' };
  if (agent.plan) return { kick: 'Intent', text: agent.plan };
  const n = agent.items.length;
  const to = lower(ctx.deliverTo);
  if (n) return { kick: 'Inner voice', text: `${n === 1 ? ctx.item : `${n} × ${lower(ctx.item)}`} in hand. The ${to} is ${ctx.dist} tiles out.` };
  return { kick: 'Inner voice', text: `Hands empty. Looking for ${lower(ctx.item)}.` };
}
