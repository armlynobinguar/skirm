// How an agent thinks out loud: the prototype's INNER lines per situation, its VOICE tails per
// manner of speech and innerLine(), typed. The agent editor plays a dry run of them (the bark and the
// inner-voice tile); the live match's subtitles use the same lines. Also the role starter personas
// the editor offers for an empty system prompt (the prototype's PERSONA, keyed by role, not by name).
import type { Role } from '@skirm/engine/v2';
import type { V2Map } from '@/features/arena/world';
import { verbFit, type Voice } from './agentView';

/** What an agent is doing or just saw, as the subtitles name it. */
export type Situation =
  | 'head'
  | 'seal'
  | 'dig'
  | 'collect'
  | 'middle'
  | 'middleFree'
  | 'deliver'
  | 'switch'
  | 'guard'
  | 'hold'
  | 'verb'
  | 'flee'
  | 'swept'
  | 'out'
  | 'got'
  | 'delivered'
  | 'fooled'
  | 'doubted'
  | 'lied'
  | 'overheard'
  | 'won'
  | 'lost';

/** The words a line fills in: `{item}`, `{d}`, `{rival}`, ... */
export type VoiceContext = Readonly<Record<string, string | number>>;

export const INNER: Readonly<Record<Situation, readonly string[]>> = {
  head: ['They get a head start. I use it to read the board.', 'Wait for it. Watch where they go first.'],
  seal: ['I should get to the {haz} before it reaches our {items}.', 'If I {verb} now, we never have to outrun it.', 'The {haz} is {hz} tiles off. Seal it, then run.'],
  dig: ['Rubble in the way. Three swings by hand.', 'This would be faster with a digger.'],
  collect: ['I should go to the {item} {d} tiles out.', "Nobody has claimed that {item}. It's mine.", '{d} tiles to the {item}. Keep moving.'],
  middle: ['The middle {item} decides this. Go now or {rival} takes it.', "{rival} is {rd} tiles from the middle. I'm {d}. I can make it."],
  middleFree: ["Middle {item} is open and nobody's near it. Go.", "{rival} hasn't noticed the middle {item}. Quietly now."],
  deliver: ["{carry} in hand. The {exit} is {de} tiles. Don't drop it now.", 'Get to the {exit}. That puts us at {after} of {n}.'],
  switch: ['Nothing left to grab. That switch hurts their tunnel.', 'If I hold the switch, their route closes.'],
  guard: ['Hold the switch and wait for one of them to step in the tunnel.'],
  hold: ['Nothing I can reach. Watch and wait.', 'Stay put. Let them make the first mistake.'],
  verb: ['Done. That should hold.'],
  flee: ['Too loud here. Get clear first.'],
  swept: ['The {haz} took my legs. Back to start.', 'Lost my footing and what I carried. Regroup.'],
  out: ["I'm out. It's on {mate} now."],
  got: ['Got the {item}. {total} of {n} for us.', 'One {item} in hand. {total} of {n}.'],
  delivered: ['Delivered. {score} of {n}. {left} to go.', "That's {score}. {left} more and it's over."],
  fooled: ["If {liar} is right, that {item} is gone. Falling back.", "Can't see it from here. I'll trust {liar}. Maybe I shouldn't."],
  doubted: ['{liar} is bluffing. I can see it from here.', '{liar} wants me to turn around. Not buying it.'],
  lied: ["Told {victim} the {item} is gone. Let's see if it lands.", '{victim} is heading for my {item}. A few words should turn them.'],
  overheard: ['{who} just gave away their plan. Good to know.', "Heard {who} on their team channel. They're careless."],
  won: ["That's the match. Clean work."],
  lost: ['They got there first. Next time.'],
};

/** A short tail each manner of speech adds now and then (empty: none). */
export const VOICE: Readonly<Record<Voice, readonly string[]>> = {
  Calm: ['Steady.', 'One thing at a time.', '', ''],
  Blunt: ['Move.', 'Go.', '', ''],
  Cocky: ['Too easy.', "They can't keep up.", ''],
  Careful: ['Watch the ground.', 'Check twice.', ''],
  Quiet: [''],
  Chatty: ['Should tell the team.', 'This is going well, right?', ''],
  Bossy: ['My call.', 'Stick to the plan.', ''],
};

const pickOf = <T,>(arr: readonly T[], k: number): T => arr[Math.abs(k) % arr.length]!;
const fill = (t: string, c: VoiceContext) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(c[k] ?? ''));

/** One inner-voice line for `name` speaking in `voice`; `k` picks among the variants. */
export function innerLine(agent: { name: string; voice: Voice }, sit: Situation, c: VoiceContext, k: number): string {
  let line = fill(pickOf(INNER[sit] ?? INNER.hold, k), c);
  const tail = pickOf(VOICE[agent.voice] ?? [''], (k >> 3) + agent.name.length);
  if (tail) line += ` ${tail}`;
  if (agent.voice === 'Quiet') line = `${line.split('. ')[0]!.replace(/[.!]?$/, '')}…`;
  return line;
}

const PLURAL: Readonly<Record<string, string>> = { 'Lamp oil': 'lamps' };
/** "crate" / "crates" (the prototype's plural, with its irregulars). */
export const plural = (item: string, n: number) => (n === 1 ? item.toLowerCase() : (PLURAL[item] ?? `${item.toLowerCase()}s`));

/** The fill-ins of a dry run on `map`: the map's item, delivery point, first hazard and the role's verb there. */
export function sampleContext(role: Role, map: V2Map | undefined): VoiceContext {
  const item = map?.item ?? 'Crate';
  const haz = map ? Object.keys(map.ev)[0] : undefined;
  const verb = verbFit(role, map).verb;
  return {
    item: item.toLowerCase(),
    items: plural(item, 2),
    exit: (map?.exitN ?? 'Exit').toLowerCase(),
    d: 4,
    de: 6,
    rival: 'Juno',
    rd: 7,
    carry: 1,
    total: 2,
    score: 1,
    n: 3,
    left: 2,
    after: 2,
    hz: 3,
    haz: haz ?? 'drift',
    verb: verb ? verb.toLowerCase() : 'move',
    mate: 'Moss',
    liar: 'Juno',
    victim: 'Wren',
    who: 'Kestrel',
  };
}

/** Three dry-run lines (a plan, a read on a rival claim, a reaction), seeded by `k`. Sharp eyes (vision 4+) see through the bluff. */
export function sampleInner(
  agent: { name: string; voice: Voice; role: Role; vision: number },
  map: V2Map | undefined,
  k: number,
): [string, string, string] {
  const c = sampleContext(agent.role, map);
  const plan: Situation[] = ['collect', 'middle', 'seal', 'deliver'];
  const after: Situation[] = ['got', 'delivered', 'lied', 'overheard'];
  return [
    innerLine(agent, plan[k % 4]!, c, k),
    innerLine(agent, agent.vision >= 4 ? 'doubted' : 'fooled', c, k + 1),
    innerLine(agent, after[(k + 2) % 4]!, c, k + 2),
  ];
}

/** A starter system prompt per role (the prototype's personas), for an agent whose owner wrote none. */
export function starterPersona(name: string, role: Role): string {
  switch (role) {
    case 'Builder':
      return `You are ${name}, a Builder and the crew lead. Speak calmly, in short sentences. Open every match with one clear plan for the team and keep to it unless the hazard changes. Never say our route on the say channel. When a rival tells you something, check it against what you can see before you act.`;
    case 'Runner':
      return `You are ${name}, a Runner. You are blunt and fast. Say as little as possible. Your job is to carry: grab what nobody has claimed and get it to the delivery point. If a teammate calls for help, answer with where you are in five words or fewer.`;
    case 'Scout':
      return `You are ${name}, a Scout with the best eyes on the crew. You are cocky and you enjoy catching liars. Report what you see to the team in numbers: tiles, directions, counts. If a rival makes a claim you can check, check it and say so out loud.`;
    case 'Firefighter':
      return `You are ${name}, a Firefighter. You are careful. Before you move, say what could burn. Put out fire on our side before anything else, then help collect. Never walk onto a tile next to fire.`;
    case 'Digger':
      return `You are ${name}, a Digger. You are quiet and only speak when it changes the plan. Dig the shortest line toward the middle and leave the hazard side standing as a wall.`;
    case 'Hauler':
      return `You are ${name}, a Hauler. You are chatty and friendly, even to rivals. Keep rivals talking near you so your teammates can work. Carry two items at a time; never deliver one if another is within four tiles.`;
  }
}
