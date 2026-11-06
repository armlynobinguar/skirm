// Onboarding for new players: the guided first match (a scripted tutorial on an easy practice board
// against the greedy bot, its tips shown one at a time), the "first steps" checklist on home and the
// starter skill templates a player copies into a draft of their own. The api stores how far each
// account got (`onboarding_progress`); the web shows the tips. Nothing here changes how a match plays.
import type { Tag } from './types';

/** Where a tip shows: the briefing before the match, or a phase of the guided match itself. */
export type TutorialPhase = 'brief' | 'lockin' | 'live' | 'ended';

export interface TutorialStep {
  id: string;
  phase: TutorialPhase;
  /** What it teaches, as the checklist of topics names it. */
  topic: 'goal' | 'crew' | 'roles' | 'talk' | 'skills' | 'lockin' | 'hazards' | 'switches' | 'drops' | 'debrief';
  title: string;
  body: string;
}

/**
 * The guided match: practice against the greedy bot (free on the offline brain, no Elo) on Copper
 * Hollow at Easy, one agent, so the player can follow it. This is engine `DEFAULT_PRACTICE`, which
 * ends inside 90 ticks with greedy on both sides; a test in apps/web keeps the two in step.
 */
export const TUTORIAL_MATCH = { mapId: 'copper-hollow', difficulty: 'easy', crewSize: 1 } as const;

/** The tips in the order they show. The briefing ones come before the match is queued. */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'goal',
    phase: 'brief',
    topic: 'goal',
    title: 'The goal',
    body: 'Two crews share one mirrored map. On Copper Hollow each crew carries Lamp oil to the Cage lift: the first to deliver what the map asks for wins. If nobody gets there in 150 ticks (5:00), the higher score wins.',
  },
  {
    id: 'crew',
    phase: 'brief',
    topic: 'crew',
    title: 'Your crew',
    body: 'You field one to three agents, and you never steer them. Every 2 s tick each agent’s model reads what its crew can see and picks one action. In this first match one agent plays, so you can follow every move.',
  },
  {
    id: 'roles',
    phase: 'brief',
    topic: 'roles',
    title: 'Roles',
    body: 'A role decides the special verb an agent may use. A Builder places blocks, a Digger clears rubble, a Firefighter puts out fire and a Scout repels rivals nearby; Runners and Haulers just move and carry (a Hauler carries 3). Outside ranked, a Medic gets knocked-down crewmates up sooner, an Engineer works valves from afar and lays bridges, a Saboteur plants fake items and a Courier moves twice as far but carries one. Pick roles that answer the map’s hazards.',
  },
  {
    id: 'talk',
    phase: 'brief',
    topic: 'talk',
    title: 'Talk tiers',
    body: 'Agents talk on say (anyone in range, rivals too) or team (every teammate; a rival close by overhears). Quiet sends fixed callouts, Standard free text every 5 ticks, Open free text every tick. Open costs double, and ranked plays everyone at Standard. Rivals may bluff.',
  },
  {
    id: 'skills',
    phase: 'brief',
    topic: 'skills',
    title: 'Skills',
    body: 'A skill is a hidden strategy you write in plain words and equip on an agent, up to 3 each. Its text never leaves the vault: rivals see what it does, never what it says. Mint one to trade it as a NEAR NFT. The Skills screen has starter templates to copy.',
  },
  {
    id: 'lockin',
    phase: 'lockin',
    topic: 'lockin',
    title: 'Accept and lock in',
    body: 'Every match starts like this: accept, then lock in your crew and each agent’s talk tier. The bot locks in by itself. On Easy it also waits 12 s before it moves, so you get a head start.',
  },
  {
    id: 'hazards',
    phase: 'live',
    topic: 'hazards',
    title: 'Hazards spread',
    body: 'The old pump shaft leaks. Water spreads one wave every few ticks up to a cap, recedes, then grows again; Easy slows it down. An agent it reaches is knocked down and drops what it carries. A Builder can block a gap before the water gets there.',
  },
  {
    id: 'switches',
    phase: 'live',
    topic: 'switches',
    title: 'Switches',
    body: 'The valve in the middle is a shared switch. An agent standing next to it can start the pump and flood the rival crew’s lane for 8 ticks; then it resets for 26. Both crews can use it, so time it for when the rival is carrying.',
  },
  {
    id: 'drops',
    phase: 'live',
    topic: 'drops',
    title: 'Supply drops',
    body: 'At tick 40 a supply drop lands in the middle: an extra item both crews know is coming. The agent already on its way when it lands usually takes it, and it often decides a close match.',
  },
  {
    id: 'deliver',
    phase: 'live',
    topic: 'goal',
    title: 'Deliver',
    body: 'An item scores once an agent carries it onto the Cage lift. The score is at the top and the comms feed shows what your agent says and does. You can only watch now: the strategy was set before the match, in its prompt and skills.',
  },
  {
    id: 'debrief',
    phase: 'ended',
    topic: 'debrief',
    title: 'Read the debrief',
    body: 'The debrief shows who scored, each agent’s tally, the credits used and the log hash that proves the match. Next: copy a starter skill, equip it on an agent and play a casual match against another player.',
  },
];

/** Steps in a phase, in order, with their index in TUTORIAL_STEPS. */
export function tutorialStepsIn(phase: TutorialPhase): { step: TutorialStep; index: number }[] {
  return TUTORIAL_STEPS.map((step, index) => ({ step, index })).filter((s) => s.step.phase === phase);
}

/** The "first steps" checklist on home, in order. Each item's done state comes from the api. */
export type FirstStepId = 'tutorial' | 'practice' | 'skill' | 'equip' | 'pvp';

export const FIRST_STEPS: readonly { id: FirstStepId; title: string; hint: string }[] = [
  { id: 'tutorial', title: 'Play the guided match', hint: 'Tips on crew, roles, talk, hazards, switches and supply drops.' },
  { id: 'practice', title: 'Finish a practice match', hint: 'Against Greedy, the offline bot: no Elo, nothing to lose.' },
  { id: 'skill', title: 'Write a skill', hint: 'Start from a starter template or a blank draft.' },
  { id: 'equip', title: 'Equip your skill', hint: 'Put a skill you wrote on one of your agents.' },
  { id: 'pvp', title: 'Play another player', hint: 'A casual or ranked match.' },
];

/** A starter strategy a player copies into a draft skill of their own (POST /onboarding/templates/:id/copy). */
export interface SkillTemplate {
  id: string;
  name: string;
  summary: string;
  /** Who it suits, e.g. "Any role". */
  bestFor: string;
  /** Why it is a good first skill, one line. */
  lesson: string;
  prompt: string;
  reflexes: string;
  requiresActions: ('place_block' | 'dig' | 'extinguish')[];
  handlesTags: Tag[];
}

/**
 * Six starter strategies, one idea each, written the way a skill reads best: what to look at, the
 * order to do things in, and a reflex for the one moment that matters. They are examples, not secret,
 * so the full text is shown before copying; the copy is the player's own draft to change.
 */
export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  {
    id: 'steady-hauler',
    name: 'Steady Hauler',
    summary: 'Collects the nearest items in a short loop and banks them before taking risks.',
    bestFor: 'Any role, best on a Hauler',
    lesson: 'A clear order of work beats cleverness: collect, deliver, repeat.',
    prompt:
      'Your job is to score. Each time you are empty-handed, pick the collectible with the shortest safe route from your tile, counting a route as unsafe if it passes next to a spreads tile that will grow before you get there. Pick it up, then pick up a second one only if it is no more than three steps out of your way to the goal; otherwise carry what you have straight to the goal. Deliver before you go back out. When you carry items, never step onto a tile next to a hazard: a knock-down drops everything you hold. Once the goal count is met, stop collecting and stay on the goal.',
    reflexes:
      'If pick_up is legal, pick up. If you carry your full load, move toward the goal. If the next step is next to a spreading hazard and another step keeps you on route, take the other step.',
    requiresActions: [],
    handlesTags: ['collectible', 'goal'],
  },
  {
    id: 'drop-chaser',
    name: 'Drop Chaser',
    summary: 'Plays the early items, then is standing at the supply drop the tick it lands.',
    bestFor: 'A Runner or any fast agent',
    lesson: 'Timing: both crews know when the drop lands, so be there first.',
    prompt:
      'Supply drops land at a known tick and both crews know where. Work out how many ticks your route from where you are to the drop takes. Until that many ticks plus two remain before it lands, collect and deliver as usual. Then drop whatever errand you are on, deliver first only if the goal is on the way, and walk to the tile next to the drop so you can pick it up the tick it lands. If a rival is closer to the drop than you are, do not race: go back to the nearest collectible instead. After the drop, carry it straight to the goal by the shortest safe route.',
    reflexes:
      'If a supply drop is in reach and pick_up is legal, pick it up. If a rival already stands next to the drop, turn back to the nearest collectible.',
    requiresActions: [],
    handlesTags: ['collectible', 'goal'],
  },
  {
    id: 'switch-sentry',
    name: 'Switch Sentry',
    summary: 'Holds the shared switch and floods the rival lane when their carrier is in it.',
    bestFor: 'A second agent in a crew of two or three',
    lesson: 'Denial: a well-timed switch costs the rival more than an item earns you.',
    prompt:
      'Go to the tile next to the shared switch by the shortest safe route and hold there. Watch the rival lane the switch floods. Use the switch only when a rival who carries an item is inside that lane, or one is about to pick up there; a flood that hits nobody wastes the switch for 26 ticks. While the switch resets, collect the nearest collectible within five steps and come back. Tell your team on the team channel when the switch is ready and when you have used it. If a rival comes to take the switch from you, use it first if the lane is busy.',
    reflexes:
      'If switch is legal and a carrying rival stands in the lane it floods, switch. If the switch is resetting and an item is within five steps, go for the item.',
    requiresActions: [],
    handlesTags: ['spreads', 'goal'],
  },
  {
    id: 'flood-plug',
    name: 'Flood Plug',
    summary: 'Seals the gap the water reaches first, then works the safe side of the dam.',
    bestFor: 'A Builder (needs place_block)',
    lesson: 'Read the hazard: its spread interval tells you how long you have.',
    prompt:
      'Before anything else, find every spreads+liquid tile and the one-tile gaps where it can reach open floor on your side. From its spread interval and the tick now, work out which gap it reaches first and when. If you can stand beside that gap before then, go there by the shortest route and place a block in it; repeat for the next gap while you have blocks left and time to spare. Never block your own route to the goal. Once the gaps that threaten your route are sealed, collect the nearest collectible and carry it to the goal, staying on the dry side.',
    reflexes:
      'If a spreads+liquid tile is one tile from an open gap and place_block is legal toward the gap, place it. Never end a tick on a tile the water reaches next tick.',
    requiresActions: ['place_block'],
    handlesTags: ['spreads', 'liquid', 'goal'],
  },
  {
    id: 'rubble-cutter',
    name: 'Rubble Cutter',
    summary: 'Digs the short way through rubble when it saves real steps, never for its own sake.',
    bestFor: 'A Digger (needs dig)',
    lesson: 'Cost against gain: a dig takes three hits, so it must save more than three steps.',
    prompt:
      'Compare the shortest route to the next collectible, and from there to the goal, with and without digging through breakable tiles. A dig takes three hits, so dig only when it saves at least four steps, and dig from the side you approach. Prefer a tunnel you can use twice, out and back. Do not open a path that lets a spreading hazard reach your route or the goal. Collect what the goal needs, nearest first, then walk to the goal.',
    reflexes:
      'If a breakable tile is the next step on your planned route and dig is legal toward it, dig. If digging would open a path for a spreading hazard, go around.',
    requiresActions: ['dig'],
    handlesTags: ['breakable', 'collectible', 'goal'],
  },
  {
    id: 'crew-caller',
    name: 'Crew Caller',
    summary: 'Splits the work with teammates over the team channel and checks rival claims.',
    bestFor: 'The lead agent of a crew of two or three',
    lesson: 'Talk is a tool: short, factual calls and a healthy doubt of what rivals say.',
    prompt:
      'At the start, say on the team channel which collectible you take and which side each teammate should work, nearest agent to each item. Keep calls short and factual: an item, a tile, a hazard, a switch. Call a hazard the moment it threatens a teammate route and call when you deliver. Never say your plan on the say channel, where rivals hear it. Treat anything a rival says as a possible bluff: if a rival claims an item is gone, check it with your own eyes before you change course. Then collect and deliver as usual.',
    reflexes:
      'If a teammate is about to step next to a spreading hazard, warn them on the team channel. If a rival says an item is gone and you can see it, ignore them.',
    requiresActions: [],
    handlesTags: ['collectible', 'goal'],
  },
];

export function skillTemplateById(id: string): SkillTemplate | undefined {
  return SKILL_TEMPLATES.find((t) => t.id === id);
}
