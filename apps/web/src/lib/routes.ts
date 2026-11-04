// Every screen's URL (UI/UX Spec screen inventory). Link with these, never hand-written strings,
// so a route change is one edit. Screen ids in comments match the spec and the README table.
const e = encodeURIComponent;

/** Casual match difficulty in a URL (`?d=`), as in @skirm/engine/v2 Difficulty. */
export type RouteDifficulty = 'easy' | 'normal' | 'hard' | 'agentic' | 'mega';

export const routes = {
  signIn: () => '/', // S01
  home: () => '/play', // S02 Command deck
  atlas: () => '/maps', // v2 Map atlas
  crew: (mapId: string, difficulty?: RouteDifficulty) =>
    `/maps/${e(mapId)}/crew${difficulty ? `?d=${difficulty}` : ''}`, // S04, v2 casual crew (?d= difficulty)
  /** The v2 crew screen with "Vs Greedy bot" on (`?opponent=bot`), e.g. routes.practice(DEFAULT_PRACTICE). */
  practice: ({ mapId, difficulty }: { mapId: string; difficulty?: RouteDifficulty }) =>
    `/maps/${e(mapId)}/crew?${difficulty ? `d=${difficulty}&` : ''}opponent=bot`,
  /** The guided first match: the briefing, then practice vs the bot with tips over the match screen. */
  tutorial: () => '/tutorial',
  skills: (tab?: 'written' | 'owned') => (tab === 'owned' ? '/skills?tab=owned' : '/skills'), // S07
  newSkill: () => '/skills/new', // S08 (blank)
  editSkill: (skillId: string) => `/skills/${e(skillId)}/edit`, // S08
  market: () => '/market', // S09
  marketSkill: (skillId: string) => `/market/${e(skillId)}`, // S10
  pvp: () => '/pvp', // S11
  match: (matchId: string) => `/matches/${e(matchId)}`, // S12 v2 match: accept, lock-in, live, end
  matchResult: (matchId: string) => `/matches/${e(matchId)}/result`, // S13 v2 result: the debrief
  /** The replay of an ended match, from `tick` when given (a highlight's jump). */
  matchReplay: (matchId: string, tick?: number) => `/matches/${e(matchId)}${tick !== undefined ? `?t=${tick}` : ''}#replay`,
  /** A shared replay link (public; the whole board only). */
  replay: (shareId: string) => `/replays/${e(shareId)}`,
  leaderboards: () => '/leaderboards', // S14
  terms: () => '/terms',
  privacy: () => '/privacy',
  credits: () => '/account/credits', // S15
  account: () => '/account', // S16
  agent: (agentId: string) => `/agents/${e(agentId)}`, // v2 agent editor
  lobbies: () => '/lobbies', // private lobbies: make one, join by code
  lobby: (lobbyId: string) => `/lobbies/${e(lobbyId)}`, // a lobby: settings, crew, ready
  joinLobby: (code: string) => `/lobbies/join/${e(code)}`, // the share link of a lobby
  tournaments: () => '/tournaments', // tournaments: list and make one
  tournament: (id: string) => `/tournaments/${e(id)}`, // a bracket
} as const;

export type NavGroup = 'play' | 'skills' | 'market' | 'pvp' | 'leaderboards' | 'account';

/** Which header item a path belongs to (TopBar.dc.html `active`). */
export function navGroupOf(pathname: string): NavGroup | null {
  if (/^\/(play|maps|agents|tutorial)(\/|$)/.test(pathname)) return 'play';
  if (/^\/skills(\/|$)/.test(pathname)) return 'skills';
  if (/^\/market(\/|$)/.test(pathname)) return 'market';
  if (/^\/(pvp|matches|lobbies|tournaments)(\/|$)/.test(pathname)) return 'pvp';
  if (/^\/leaderboards(\/|$)/.test(pathname)) return 'leaderboards';
  if (/^\/account(\/|$)/.test(pathname)) return 'account';
  return null;
}

/** A screen's name in the HUD crumb and the wipe that carries you to it (v2 Arena look). */
export interface ScreenLabel {
  /** Changes when the player moves to another screen; the wipe plays on a change. */
  key: string;
  /** Crumb and wipe title, e.g. "Command". */
  title: string;
  /** Wipe subtitle, e.g. "// home". */
  sub: string;
  /** Where Back goes (the prototype's BACK map); null on the Command deck. */
  back: string | null;
}

const SCREENS: { re: RegExp; key: string; title: string; sub: string; back: string | null }[] = [
  { re: /^\/play\/?$/, key: 'home', title: 'Command', sub: '// home', back: null },
  { re: /^\/maps\/[^/]+\/crew\/?$/, key: 'crew', title: 'Lock in', sub: '// crew + talk', back: routes.home() },
  { re: /^\/tutorial\/?$/, key: 'tutorial', title: 'Tutorial', sub: '// first match', back: routes.home() },
  { re: /^\/agents(\/|$)/, key: 'agent', title: 'Agent', sub: '// prompt + stats', back: routes.home() },
  { re: /^\/maps(\/|$)/, key: 'maps', title: 'Atlas', sub: '// maps', back: routes.home() },
  { re: /^\/pvp(\/|$)/, key: 'pvp', title: 'Skirmish', sub: '// ranked', back: routes.home() },
  { re: /^\/lobbies\/?$/, key: 'lobbies', title: 'Lobbies', sub: '// private matches', back: routes.pvp() },
  { re: /^\/lobbies\//, key: 'lobby', title: 'Lobby', sub: '// friend challenge', back: routes.lobbies() },
  { re: /^\/tournaments\/?$/, key: 'tournaments', title: 'Tournaments', sub: '// brackets', back: routes.pvp() },
  { re: /^\/tournaments\//, key: 'tournament', title: 'Bracket', sub: '// single elimination', back: routes.tournaments() },
  { re: /^\/replays\/[^/]+\/?$/, key: 'replay', title: 'Replay', sub: '// shared', back: routes.pvp() },
  { re: /^\/matches\/[^/]+\/result\/?$/, key: 'match-result', title: 'Debrief', sub: '// replay hash on NEAR', back: routes.pvp() },
  { re: /^\/matches(\/|$)/, key: 'match', title: 'Live', sub: '// 2 s ticks', back: routes.pvp() },
  { re: /^\/leaderboards(\/|$)/, key: 'ladder', title: 'Ladder', sub: '// season', back: routes.home() },
  { re: /^\/terms\/?$/, key: 'terms', title: 'Terms', sub: '// the rules', back: routes.home() },
  { re: /^\/privacy\/?$/, key: 'privacy', title: 'Privacy', sub: '// your data', back: routes.home() },
  { re: /^\/market(\/|$)/, key: 'market', title: 'Exchange', sub: '// proof first', back: routes.home() },
  { re: /^\/skills(\/|$)/, key: 'skills', title: 'Skills', sub: '// your strategies', back: routes.home() },
  { re: /^\/account\/credits\/?$/, key: 'credits', title: 'Credits', sub: '// NEAR top-ups', back: routes.account() },
  { re: /^\/account(\/|$)/, key: 'account', title: 'Profile', sub: '// you', back: routes.home() },
];

/** The screen a path shows, for the HUD crumb, Back and the wipe; null for unknown paths. */
export function screenOf(pathname: string): ScreenLabel | null {
  const s = SCREENS.find((x) => x.re.test(pathname));
  return s ? { key: s.key, title: s.title, sub: s.sub, back: s.back } : null;
}
