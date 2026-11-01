// Design notes (the prototype's NOTES): one card per screen, opened with the top bar's Notes toggle
// or the N key (GlobalKeys.tsx) and shown by NotesAside.tsx. Open/closed is per tab, in memory.
import { useSyncExternalStore } from 'react';

export interface ScreenNote {
  title: string;
  lead: string;
  points: readonly string[];
}

/** Notes keyed like the prototype's screens; `notesFor` maps a route's screen key onto them. */
export const NOTES = {
  lobby: {
    title: 'Command deck',
    lead: 'Home. Ranked Skirmish is the biggest tile.',
    points: [
      'Menu tiles use the same icon language: a textured plate with the icon top-right, a large faint copy as a watermark, a serial code (OP·01 to PRC·06), grain and hatching across the tile, hazard tape in the corner, and a halftone in the tile colour that strengthens on hover.',
      'Header icons are drawn in code, Arknights-style: a halftone dot gradient (real dots, sized by position), fine hatching, corner brackets and one teal accent stroke each; PvP adds a red guard for the rival side. Tabs carry film grain, diagonal hatching and a serial code (PLY·01 to LDR·05); the active tab adds a teal halftone fade from the right.',
      'The header has no bar. Back, logo, the five section tabs and the SFX and Notes toggles are separate chips floating over the arena, like the menu tiles. The active tab gets a teal underline.',
      'Your account is the last chip of the top bar: handle and credits. Click it for the card with network, credits, wallet and ranked Elo with its title. It steps aside on the live match.',
      'Every mode is 2-crew PvP on closed maps.',
      "The lead agent's barks carry a channel tag (TEAM, SAY, HEARD), the same tags the match uses.",
      'The ticker states the season split, talk rule and fees from the v2 design doc.',
    ],
  },
  maps: {
    title: 'Map atlas',
    lead: 'All 10 maps, sized by difficulty: 31×13 up to 55×25.',
    points: [
      'Pick Easy, Normal, Hard, Agentic or Mega Agentic under the map. The goal box changes with it: 50 goals in all.',
      'The map number is the play button: click the diamond for Practice at the picked difficulty, Ranked or Details.',
      'Agentic levels change the rivals, not just the hazard: Open talk, more bluffs, fog, and on Mega a full 3-agent crew and a 4:00 clock.',
      'Map tiers (Starter, Veteran, Extreme) never share a name with a difficulty.',
      'Difficulty sets size, middle-band width, routes, contested items, switches, supply drops, fog and stealing. Goals rise from 2 to 6.',
      'Each arena is a base room plus its mirror, joined by a center column with the shared delivery point.',
      'Each crew gets goal − 1 items on its half plus one contested item in the center: fewer than both crews need.',
      'Hazards peak after a few waves, then burn out or recede, so a 5:00 match never seals the map for good.',
      'Verbs show their effect class, which is what skills target.',
    ],
  },
  hub: {
    title: 'Skirmish',
    lead: 'Ranked queue, season pool and ladder.',
    points: [
      'Match found takes the screen with a 10 s accept. The rival crew stays hidden until both lock in.',
      'The pool panel shows the decided split: 30 / 20 / 15, then 5% each for 4th to 10th.',
      'The earn-back panel is the v2 answer to "how do I make my money back": prizes, sales, royalties and rentals against credits spent.',
    ],
  },
  agent: {
    title: 'Agent editor',
    lead: 'Same composition as the command deck: the agent is the hero, its loadout is the tile grid.',
    points: [
      "System prompt is the agent's persona and habits. It is always yours and editable; edits apply from the next match.",
      'Skill prompts stay encrypted when bought. Your own skills show their text.',
      'Stats explain what each number does in tiles, so vision and comms read as rules, not flavour.',
      'The inner-voice tile previews the same lines that play as subtitles in third person.',
    ],
  },
  crew: {
    title: 'Lock in',
    lead: 'Valorant-style lock-in with a 30 s timer in ranked.',
    points: [
      'Difficulty sits under Mode. Each of the 5 levels has its own goal on every map; ranked locks to Normal.',
      'Edit on any agent card, or tap its skill, opens the agent editor.',
      "Up to 3 agents. The head-start rule shows live: each agent beyond the rival's costs 10 s.",
      'Talk tier per agent. Ranked locks every agent to Standard; practice unlocks Quiet and Open.',
      'The credit estimate is 150 ticks × the sum of tier rates.',
      'Models are fixed for everyone: Haiku plans, Jev acts.',
    ],
  },
  match: {
    title: 'Live match',
    lead: 'Both crews on one shared map, 2 s ticks, 5:00.',
    points: [
      'Fog is a soft light: the edge of what your crew sees fades over about two tiles, tiles you have explored stay dimly lit, and rivals fade instead of popping.',
      '"Heard by" is an amber ear: on speech bubbles, in the feed, subtitles and the mind panel. Hover it for names.',
      "Every agent card has a 2-slot inventory with the map's item icon. The bottom stripe shows where it came from: teal own half, amber middle, violet supply drop, red stolen.",
      'Third person lists the watched agent\'s inventory in full, with where and when each item was picked up.',
      'The entrance plays as a cutscene: the map drops in, title, the goal in big type, then the hazard and both crews. Skip with the button or Enter.',
      '3rd person (V, or double-click a card) switches to a chase camera behind one agent. Subtitles show what it thinks, says and hears; the mind panel shows its plan.',
      'Story pace holds each subtitle on screen long enough to read.',
      'Ranked hides rival minds; your own crew\'s plans show, except for agents running a bought skill.',
      'Speech bubbles carry a channel label. Team messages show who overheard them.',
      "The comms feed filters by channel. A rival's team chat only appears if one of your agents was in range.",
      'Callouts flag the big moments: center taken, a themed verb fired.',
    ],
  },
  result: {
    title: 'Debrief',
    lead: 'Result, Elo, talk stats and credits.',
    points: [
      'Talk stats are the scoreboard: messages, overheard, bluffs told and seen through.',
      'Credits show held vs used vs returned, per the earn-back flow.',
      "The replay is an action log hash, since LLM output can't be re-simulated.",
    ],
  },
  market: {
    title: 'Exchange',
    lead: 'Every listing leads with proof.',
    points: [
      'Benchmark at mint on hidden seeds, ranked record per map at Standard talk, counter stats, and the hijack gauntlet.',
      'Try before you buy runs 3 sandbox matches with your own crew on the current map.',
      'Version lock: an edit is a new version and its stats start at zero.',
      "The buy sheet shows the 5% platform fee and the creator's resale royalty.",
    ],
  },
} as const satisfies Record<string, ScreenNote>;

export type NoteKey = keyof typeof NOTES;

/** The shared look notes, under every screen's card ("From the Command Deck"). */
export const DECK_NOTES: readonly string[] = [
  'Same type (Saira Condensed, Barlow, JetBrains Mono), same cut corners, same wipe and motion curve.',
  'Added from Valorant: red vs teal sides, match-found takeover, lock-in timer. From Arknights: role class icons, hazard tape, code labels like CH-05.',
];

/** Route screen keys (`screenOf(path).key` in lib/routes) → the prototype screen they show. */
const SCREEN_NOTE: Partial<Record<string, NoteKey>> = {
  home: 'lobby',
  maps: 'maps',
  pvp: 'hub',
  ladder: 'hub',
  agent: 'agent',
  crew: 'crew',
  match: 'match',
  'match-result': 'result',
  market: 'market',
  skills: 'market',
};

/** The note for a route's screen key; the Command deck's for screens the prototype has none for. */
export function notesFor(screenKey: string | null | undefined): ScreenNote {
  return NOTES[(screenKey && SCREEN_NOTE[screenKey]) || 'lobby'];
}

// ---------- open / closed ----------

type Listener = () => void;
let open = false;
const listeners = new Set<Listener>();

export const notesStore = {
  get: (): boolean => open,
  set(next: boolean): void {
    if (next === open) return;
    open = next;
    listeners.forEach((l) => l());
  },
  toggle(): void {
    notesStore.set(!open);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Whether the notes aside is open (server render: closed). */
export function useNotesOpen(): boolean {
  return useSyncExternalStore(notesStore.subscribe, notesStore.get, () => false);
}
