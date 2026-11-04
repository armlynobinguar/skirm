// The single-player campaign: three chapters of missions against the greedy bot, each mission a
// practice match on a fixed map, difficulty and crew size with a short briefing and a win condition.
// Clearing every mission of a chapter unlocks its rewards once: an account-bound starter skill (never
// minted, never traded; @skirm/db CAMPAIGN_SKILL_TEXT holds its sealed text) and, for the last
// chapter, a cosmetic. The engine plays a match the same way every time for the same map, difficulty
// and crews, so the map and difficulty are the mission's whole setup (no seed to pick).
//
// A test in packages/decision-engine plays every mission greedy against greedy and checks the
// offline brain can clear it, so the campaign is finishable on the keyless local stack.
import type { Tag } from './types';

/** A difficulty as @skirm/engine/v2 Difficulty names it (shared does not import the engine). */
export type CampaignDifficulty = 'easy' | 'normal' | 'hard' | 'agentic' | 'mega';

/**
 * What clears a mission, read from the match result (player is crew A):
 * `win`: win the match; `win_within`: win by tick `ticks`; `shutout`: win with the bot scoring nothing.
 */
export type CampaignObjective = { kind: 'win' } | { kind: 'win_within'; ticks: number } | { kind: 'shutout' };

export interface CampaignMission {
  /** `c<chapter>-m<n>`, stable: progress rows key on it. */
  id: string;
  title: string;
  /** Two or three sentences shown before the match. */
  briefing: string;
  mapId: string;
  difficulty: CampaignDifficulty;
  /** Most agents the player fields (the bot matches the crew; Mega fields a full three). */
  crewSize: 1 | 2 | 3;
  objective: CampaignObjective;
}

/** An account-bound starter skill a chapter unlocks (public metadata; the text stays sealed). */
export interface CampaignSkillReward {
  id: string;
  version: 1;
  name: string;
  summary: string;
  requiresActions: ('place_block' | 'dig' | 'extinguish')[];
  handlesTags: Tag[];
}

export interface CampaignChapter {
  /** `c<n>`. */
  id: string;
  title: string;
  /** One line under the chapter title. */
  blurb: string;
  missions: readonly CampaignMission[];
  rewards: {
    skill: CampaignSkillReward;
    /** A @skirm/shared COSMETICS id granted with the skill. */
    cosmetic?: string;
  };
}

export const CAMPAIGN_CHAPTERS: readonly CampaignChapter[] = [
  {
    id: 'c1',
    title: 'High Water',
    blurb: 'Rising water on the easy boards: learn to read a hazard before it reads you.',
    missions: [
      {
        id: 'c1-m1',
        title: 'Weir Watch',
        briefing:
          'Saltmarsh Weir floods from the sluice. One agent, two items to deliver, and the bot waits before it moves. Get your agent to the goal before the water closes the path.',
        mapId: 'saltmarsh-weir',
        difficulty: 'easy',
        crewSize: 1,
        objective: { kind: 'win' },
      },
      {
        id: 'c1-m2',
        title: 'Lamp Oil Run',
        briefing:
          'Copper Hollow leaks from the old pump shaft and fog hides the far side. Carry Lamp oil to the Cage lift faster than the bot crew.',
        mapId: 'copper-hollow',
        difficulty: 'easy',
        crewSize: 1,
        objective: { kind: 'win' },
      },
      {
        id: 'c1-m3',
        title: 'Terrace Sweep',
        briefing:
          'Monsoon Terraces drains downhill in waves. Field two agents this time and split the work: one on the route, one on the water.',
        mapId: 'monsoon-terraces',
        difficulty: 'easy',
        crewSize: 2,
        objective: { kind: 'win' },
      },
    ],
    rewards: {
      skill: {
        id: 'skl_01JBK0CAMPA1GNWATER0000001',
        version: 1,
        name: 'Levee Line',
        summary: 'Blocks the gap the water reaches first, then carries supplies home.',
        requiresActions: ['place_block'],
        handlesTags: ['spreads', 'liquid', 'goal'],
      },
    },
  },
  {
    id: 'c2',
    title: 'Wildfire Season',
    blurb: 'Fire spreads faster than water and burns what it reaches. Normal rules from here.',
    missions: [
      {
        id: 'c2-m1',
        title: 'Orchard Burn',
        briefing:
          'Ashfall Orchard is dry and the fire is already in the trees. Two agents, the map as designed: keep a tile between you and the flames.',
        mapId: 'ashfall-orchard',
        difficulty: 'normal',
        crewSize: 2,
        objective: { kind: 'win' },
      },
      {
        id: 'c2-m2',
        title: 'Glass and Ember',
        briefing:
          'Glasshouse Ruins is fogged and the fire spreads through the beds. Win without letting the bot deliver a single item: get there first and keep it that way.',
        mapId: 'glasshouse-ruins',
        difficulty: 'normal',
        crewSize: 2,
        objective: { kind: 'shutout' },
      },
      {
        id: 'c2-m3',
        title: 'Silo Sprint',
        briefing:
          'Dust Bowl Silos burns from the east. Win, and win quickly: deliver before tick 120 (4:00), while the bot is still on its way.',
        mapId: 'dust-bowl-silos',
        difficulty: 'normal',
        crewSize: 2,
        objective: { kind: 'win_within', ticks: 120 },
      },
      {
        id: 'c2-m4',
        title: 'Depot Lockdown',
        briefing:
          'Frostline Depot has no hazard at all, only a faster clock and a bot that bluffs more. Field all three agents, out-talk it and out-run it.',
        mapId: 'frostline-depot',
        difficulty: 'hard',
        crewSize: 3,
        objective: { kind: 'win' },
      },
    ],
    rewards: {
      skill: {
        id: 'skl_01JBK0CAMPA1GNF1RE00000001',
        version: 1,
        name: 'Fire Line',
        summary: 'Puts out the flames on its route and keeps the crew a tile clear of fire.',
        requiresActions: ['extinguish'],
        handlesTags: ['spreads', 'damages', 'flammable', 'goal'],
      },
    },
  },
  {
    id: 'c3',
    title: 'Lights Out',
    blurb: 'Night, fog and a full crew of three. The last boards in the atlas.',
    missions: [
      {
        id: 'c3-m1',
        title: 'Metro Flood',
        briefing:
          'Sunken Metro floods tunnel by tunnel under fog. Field all three agents on a faster hazard and a shorter clock.',
        mapId: 'sunken-metro',
        difficulty: 'hard',
        crewSize: 3,
        objective: { kind: 'win' },
      },
      {
        id: 'c3-m2',
        title: 'Basalt Climb',
        briefing:
          'Basalt Stair is dark and the lava climbs with you. Six items to deliver: plan the route before the first step.',
        mapId: 'basalt-stair',
        difficulty: 'hard',
        crewSize: 3,
        objective: { kind: 'win' },
      },
      {
        id: 'c3-m3',
        title: 'Harbor Blackout',
        briefing:
          'Blackout Harbor on Agentic: water and fire at once, at night, in fog, against a bot that talks every tick and bluffs often. Win it and the campaign is yours.',
        mapId: 'blackout-harbor',
        difficulty: 'agentic',
        crewSize: 3,
        objective: { kind: 'win' },
      },
    ],
    rewards: {
      skill: {
        id: 'skl_01JBK0CAMPA1GNN1GHT0000001',
        version: 1,
        name: 'Night Runner',
        summary: 'No unlock needed: finds the shortest safe route through fog and runs supplies home.',
        requiresActions: [],
        handlesTags: ['collectible', 'goal'],
      },
      cosmetic: 'outfit_obsidian',
    },
  },
];

/** Every mission in play order. */
export const CAMPAIGN_MISSIONS: readonly CampaignMission[] = CAMPAIGN_CHAPTERS.flatMap((c) => c.missions);

export function campaignMission(id: string): CampaignMission | undefined {
  return CAMPAIGN_MISSIONS.find((m) => m.id === id);
}

export function campaignChapterOf(missionId: string): CampaignChapter | undefined {
  return CAMPAIGN_CHAPTERS.find((c) => c.missions.some((m) => m.id === missionId));
}

/** The match result as the objective reads it (the player is crew A). */
export interface CampaignResult {
  winner: 'A' | 'B' | 'draw';
  score: { A: number; B: number };
  ticks: number;
}

/** Whether a result clears the mission's objective. */
export function objectiveMet(objective: CampaignObjective, r: CampaignResult): boolean {
  if (r.winner !== 'A') return false;
  switch (objective.kind) {
    case 'win':
      return true;
    case 'win_within':
      return r.ticks <= objective.ticks;
    case 'shutout':
      return r.score.B === 0;
  }
}

/** One line for the mission card, e.g. "Win before tick 120". */
export function objectiveLabel(objective: CampaignObjective): string {
  switch (objective.kind) {
    case 'win':
      return 'Win the match';
    case 'win_within':
      return `Win by tick ${objective.ticks}`;
    case 'shutout':
      return 'Win without the bot delivering anything';
  }
}

/** A chapter is complete when every mission in it is cleared. */
export function chapterComplete(chapter: CampaignChapter, cleared: ReadonlySet<string>): boolean {
  return chapter.missions.every((m) => cleared.has(m.id));
}

/**
 * Whether a mission can be played: the first chapter's first mission always; every other mission
 * once the one before it in its chapter is cleared; a chapter's first mission once the chapter
 * before is complete. Cleared missions stay playable (replays never undo a clear).
 */
export function missionUnlocked(missionId: string, cleared: ReadonlySet<string>): boolean {
  for (let c = 0; c < CAMPAIGN_CHAPTERS.length; c++) {
    const chapter = CAMPAIGN_CHAPTERS[c]!;
    const i = chapter.missions.findIndex((m) => m.id === missionId);
    if (i < 0) continue;
    if (i > 0) return cleared.has(chapter.missions[i - 1]!.id);
    return c === 0 || chapterComplete(CAMPAIGN_CHAPTERS[c - 1]!, cleared);
  }
  return false;
}
