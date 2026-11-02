// Match goals: one per map per difficulty (the prototype's GOALS), checked when the match ends.
// Every goal also needs the delivery race won. Bluffs are the engine's own (bluff.ts), so bluff goals
// are judged like the rest.
import type { Difficulty } from './difficulty';
import { DIFFICULTIES } from './difficulty';
import type { Team } from './map';
import type { MatchState } from './match';

/**
 * What a goal checks, with `n` its threshold:
 * win (just win), mid (middle items taken), verb (themed verbs fired), switch (switches used),
 * see (rival bluffs seen through), steal (dropped rival items taken), clean (nobody knocked down),
 * fast (won with at least `n` seconds left), hold (rival delivered at most `n`), quiet (at most `n`
 * messages sent), bluff (bluffs the rival believed).
 */
export type GoalCheck =
  | 'win'
  | 'mid'
  | 'verb'
  | 'switch'
  | 'see'
  | 'steal'
  | 'clean'
  | 'fast'
  | 'hold'
  | 'quiet'
  | 'bluff';

export interface GoalDef {
  title: string;
  /** What to do, one sentence. */
  text: string;
  check: GoalCheck;
  n?: number;
}

export interface GoalOutcome {
  title: string;
  check: GoalCheck;
  /** The check passed (for the difficulty's goal: and the match was won). */
  met: boolean;
  /** False when the engine cannot judge the check: shown as "Soon", never as missed. Every check is judged today. */
  available: boolean;
  /** Progress line, e.g. "2/3 verbs" or "nobody swept"; null when unavailable. */
  progress: string | null;
}

/** Five goals per map, in DIFFICULTIES order. */
export const MATCH_GOALS: Readonly<Record<string, readonly GoalDef[]>> = {
  'saltmarsh-weir': [
    {
      title: 'Fetch the water',
      text: 'Carry the jugs to the stilt shelter. The tide is slow today.',
      check: 'win',
    },
    {
      title: 'Claim the boardwalk',
      text: 'Win and take a middle jug before the rival does.',
      check: 'mid',
      n: 1,
    },
    { title: 'Ears on the marsh', text: 'Win and see through a rival bluff.', check: 'see', n: 1 },
    {
      title: 'Keep them dry',
      text: 'Win while the rival delivers 1 jug or fewer.',
      check: 'hold',
      n: 1,
    },
    {
      title: 'High tide',
      text: 'Win while the rival delivers 2 jugs or fewer. Their crew is full and talking.',
      check: 'hold',
      n: 2,
    },
  ],
  'ashfall-orchard': [
    { title: 'Save the seed', text: 'Get the seed packs into the root cellar.', check: 'win' },
    {
      title: 'Nobody gets burned',
      text: 'Win with no agent burned back to start.',
      check: 'clean',
    },
    {
      title: 'Beat the burn',
      text: 'Win with 1:00 or more still on the clock.',
      check: 'fast',
      n: 60,
    },
    {
      title: 'Orchard sweep',
      text: 'Win and take a middle seed pack before the rival does.',
      check: 'mid',
      n: 1,
    },
    { title: 'Read the smoke', text: 'Win and see through a rival bluff.', check: 'see', n: 1 },
  ],
  'frostline-depot': [
    { title: 'Warm up', text: 'Bring the heat packs to the warm room.', check: 'win' },
    {
      title: 'Clear the aisles',
      text: 'Win and shovel or push through a blocked aisle.',
      check: 'verb',
      n: 1,
    },
    {
      title: 'Cold radios',
      text: 'Win sending 14 messages or fewer. Batteries drain in the cold.',
      check: 'quiet',
      n: 14,
    },
    {
      title: 'Shut the door',
      text: 'Win while the rival delivers 1 heat pack or fewer.',
      check: 'hold',
      n: 1,
    },
    { title: 'Whiteout', text: 'Win with 1:00 or more still on the clock.', check: 'fast', n: 60 },
  ],
  'glasshouse-ruins': [
    { title: 'Rescue the vials', text: 'Carry the seed vials out the garden gate.', check: 'win' },
    { title: 'Both middle vials', text: 'Win and take both middle vials.', check: 'mid', n: 2 },
    {
      title: 'Fountain play',
      text: 'Win and open the fountain on the rival at least once.',
      check: 'switch',
      n: 1,
    },
    { title: 'Untouched', text: 'Win with no agent burned or swept.', check: 'clean' },
    { title: 'Read the vines', text: 'Win and see through 2 rival bluffs.', check: 'see', n: 2 },
  ],
  'copper-hollow': [
    { title: 'Light the way', text: 'Bring the lamps up the cage lift.', check: 'win' },
    {
      title: 'Shore the tunnels',
      text: 'Win and dig or shore 3 times on the way.',
      check: 'verb',
      n: 3,
    },
    { title: 'Echo in the dark', text: 'Win and land a bluff on the rival.', check: 'bluff', n: 1 },
    {
      title: 'Start the pump',
      text: 'Win and flood the rival tunnel at least once.',
      check: 'switch',
      n: 1,
    },
    { title: 'Trust your lamp', text: 'Win and see through 2 rival bluffs.', check: 'see', n: 2 },
  ],
  'dust-bowl-silos': [
    { title: 'Water the yard', text: 'Bring the water tanks to the storm cellar.', check: 'win' },
    {
      title: 'Ring the bell',
      text: 'Win and fire a themed verb at least once.',
      check: 'verb',
      n: 1,
    },
    { title: 'Dust devils', text: 'Win and see through 2 rival bluffs.', check: 'see', n: 2 },
    { title: 'Talk them down', text: 'Win and land a bluff on the rival.', check: 'bluff', n: 1 },
    {
      title: 'Both middle tanks',
      text: 'Win and take both middle water tanks.',
      check: 'mid',
      n: 2,
    },
  ],
  'monsoon-terraces': [
    { title: 'Bring in the rice', text: 'Carry the rice sacks to the village hut.', check: 'win' },
    { title: 'Mud walls', text: 'Win and fire themed verbs twice.', check: 'verb', n: 2 },
    { title: 'Dry run', text: 'Win without the floodwater sweeping anyone.', check: 'clean' },
    { title: 'Open the gates', text: 'Win and flood rival tunnels twice.', check: 'switch', n: 2 },
    {
      title: 'Rumours in the rain',
      text: 'Win and see through 2 rival bluffs.',
      check: 'see',
      n: 2,
    },
  ],
  'sunken-metro': [
    { title: 'Get the kits out', text: 'Bring the med kits up the exit stairs.', check: 'win' },
    { title: 'Platform rumours', text: 'Win and land a bluff on the rival.', check: 'bluff', n: 1 },
    {
      title: 'Drop the ceiling',
      text: 'Win and bury the rival tunnel at least once.',
      check: 'switch',
      n: 1,
    },
    { title: 'Hear the tunnels', text: 'Win and see through 2 rival bluffs.', check: 'see', n: 2 },
    { title: 'Raise the barrier', text: 'Win and fire themed verbs twice.', check: 'verb', n: 2 },
  ],
  'basalt-stair': [
    { title: 'Masks on', text: 'Bring the ash masks to the cave mouth.', check: 'win' },
    { title: 'Stone dam', text: 'Win and dam or clear the way 3 times.', check: 'verb', n: 3 },
    { title: 'Nobody burns', text: 'Win with every agent still standing.', check: 'clean' },
    { title: 'Rockslide', text: 'Win and bury rival tunnels twice.', check: 'switch', n: 2 },
    {
      title: 'Outrun the vent',
      text: 'Win with 0:45 or more still on the clock.',
      check: 'fast',
      n: 45,
    },
  ],
  'blackout-harbor': [
    { title: 'Light the tower', text: 'Bring the flares to the lighthouse.', check: 'win' },
    {
      title: 'Douse the dock',
      text: 'Win and fire a themed verb at least once.',
      check: 'verb',
      n: 1,
    },
    { title: 'Lie through the storm', text: 'Win and land 2 bluffs.', check: 'bluff', n: 2 },
    { title: 'Ears on the pier', text: 'Win and see through 2 rival bluffs.', check: 'see', n: 2 },
    { title: 'Weather the storm', text: 'Win with every agent still standing.', check: 'clean' },
  ],
};

const FALLBACK: GoalDef = { title: 'Deliver', text: 'Win the delivery race.', check: 'win' };

/** The goal a map plays at a difficulty (a plain win for a map without goals). */
export function goalFor(mapId: string, difficulty: Difficulty): GoalDef {
  return MATCH_GOALS[mapId]?.[DIFFICULTIES.indexOf(difficulty)] ?? FALLBACK;
}

/**
 * How one crew stands on a goal now (a live goal tag) or at the end. `met` needs the match won, as
 * every goal does; before the end it is false and `progress` says how far along the crew is.
 */
export function checkGoal(s: MatchState, team: Team, goal: GoalDef): Omit<GoalOutcome, 'title' | 'check'> {
  const T = s.tally[team];
  const won = s.result?.winner === team;
  const n = goal.n ?? 1;
  const atLeast = (v: number, noun: string) => ({ met: won && v >= n, available: true, progress: `${Math.min(v, n)}/${n} ${noun}` });
  const atMost = (v: number, progress: string) => ({ met: won && v <= n, available: true, progress });
  switch (goal.check) {
    case 'win':
      return { met: won, available: true, progress: `${s.score[team]}/${s.map.def.goal} delivered` };
    case 'mid':
      return atLeast(T.middle.length, 'middle');
    case 'verb':
      return atLeast(T.verbs, 'verbs');
    case 'switch':
      return atLeast(T.switches, 'switches');
    case 'steal':
      return atLeast(T.steals, 'stolen');
    case 'clean':
      return { met: won && !T.swept, available: true, progress: T.swept ? `${T.swept} swept` : 'nobody swept' };
    case 'fast': {
      // n seconds left at 2 s a tick.
      const by = s.limit - n / 2;
      const tick = s.result?.ticks ?? s.tick;
      return { met: won && tick <= by, available: true, progress: `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}+ left` };
    }
    case 'hold': {
      const rival = s.score[team === 'A' ? 'B' : 'A'];
      return atMost(rival, `rival ${rival}/${n} max`);
    }
    case 'quiet':
      return atMost(T.sent, `${T.sent}/${n} messages`);
    case 'bluff':
      return atLeast(T.believed, 'bluffs landed');
    case 'see':
      return atLeast(seenThrough(s, team), 'seen through');
  }
}

/** Rival bluffs this crew's agents heard and did not believe. */
export function seenThrough(s: MatchState, team: Team): number {
  const R = s.tally[team === 'A' ? 'B' : 'A'];
  return R.lies - R.believed;
}

/**
 * The end-of-match goal report for one crew: the difficulty's goal first (needs the win), then the
 * result screen's stars, each judged on its own: won, took a middle item, landed a bluff, saw
 * through one, nobody swept.
 */
export function evaluateGoals(s: MatchState, team: Team, difficulty: Difficulty): GoalOutcome[] {
  const goal = goalFor(s.map.def.id, difficulty);
  const T = s.tally[team];
  const won = s.result?.winner === team;
  const star = (title: string, check: GoalCheck, met: boolean, progress: string | null): GoalOutcome => ({ title, check, met, available: true, progress });
  return [
    { title: goal.title, check: goal.check, ...checkGoal(s, team, goal) },
    star('Won the match', 'win', won, `${s.score[team]}/${s.map.def.goal} delivered`),
    star(`Took a middle ${s.map.def.item.toLowerCase()}`, 'mid', T.middle.length > 0, `${T.middle.length} middle`),
    star('Landed a bluff', 'bluff', T.believed > 0, `${T.believed} landed`),
    star('Saw through a bluff', 'see', seenThrough(s, team) > 0, `${seenThrough(s, team)} seen through`),
    star('Nobody swept', 'clean', !T.swept, T.swept ? `${T.swept} swept` : 'nobody swept'),
  ];
}
