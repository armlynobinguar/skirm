// Private lobbies and tournaments (apps/api lobbies.controller.ts; docs/backend-contract.md,
// Lobbies and tournaments). A lobby is a private unranked match; a tournament is a bracket of them.
import type { Difficulty } from '@skirm/engine/v2';
import type { LobbyTalkRule } from '@skirm/shared';

export type { LobbyTalkRule };

export interface PlayerRef {
  id: string;
  handle: string;
}

export type LobbyStatus = 'open' | 'playing' | 'done' | 'cancelled';

export interface LobbySettings {
  mapId: string;
  difficulty: Difficulty;
  talk: LobbyTalkRule;
  crewSize: number;
}

export interface Lobby {
  id: string;
  /** Share code (6 characters). */
  code: string;
  host: PlayerRef;
  guest: PlayerRef | null;
  mapId: string;
  difficulty: Difficulty;
  talk: LobbyTalkRule;
  crewSize: number;
  status: LobbyStatus;
  /** The match being played, or the last one. */
  matchId: string | null;
  /** The last match's winner (null for a draw, a void or before the first match). */
  winnerId: string | null;
  /** Set for a bracket match. */
  tournamentId: string | null;
  round: number | null;
  slot: number | null;
  /** Who has a crew readied (bracket no-shows are decided from this). */
  ready: { host: boolean; guest: boolean };
  openedAt: string;
  createdAt: string;
}

export type TournamentStatus = 'open' | 'running' | 'done' | 'cancelled';

export interface TournamentSummary {
  id: string;
  name: string;
  creator: PlayerRef;
  size: 4 | 8 | 16;
  entrants: number;
  mapId: string;
  difficulty: Difficulty;
  talk: LobbyTalkRule;
  crewSize: number;
  /** Paid credits paid to the top finishers. */
  prizePool: number;
  status: TournamentStatus;
  champion: PlayerRef | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** The caller is entered (false when signed out). */
  joined?: boolean;
}

export interface BracketMatch {
  lobbyId: string;
  code: string;
  round: number;
  slot: number;
  hostId: string;
  guestId: string | null;
  status: LobbyStatus;
  matchId: string | null;
  winnerId: string | null;
}

export interface TournamentDetail extends TournamentSummary {
  rounds: number;
  entries: { account: PlayerRef; seed: number | null; elo: number | null; place: number | null; prize: number }[];
  matches: BracketMatch[];
  /** Signed in: the caller's entry and the bracket lobby they have to play now. */
  you?: { joined: boolean; creator: boolean; place: number | null; prize: number; lobbyId: string | null };
}

export interface CreateTournament extends Partial<Omit<LobbySettings, 'mapId'>> {
  name: string;
  size: 4 | 8 | 16;
  mapId: string;
  prizePool?: number;
  /** The creator plays too (default true). */
  join?: boolean;
}
