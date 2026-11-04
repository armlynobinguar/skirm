// v2 match messages on /ws. A match goes found → accept (10 s,
// both crews) → lock-in (30 s: talk tiers and crew changes, the rival hidden) → live (2 s ticks) →
// end. Each crew gets its own frame through its own fog; watchers get the whole board.
import type { Difficulty, MatchResult, TalkTier, Team, V2Frame } from '@skirm/engine/v2';

export interface V2CrewEntry {
  agentId: string;
  tier: TalkTier;
}

/** Who a v2_queue plays: absent for a matchmade rival, 'bot' for practice against the greedy bot. */
export const V2_OPPONENTS = ['bot'] as const;
export type V2Opponent = (typeof V2_OPPONENTS)[number];

export const isV2Opponent = (v: unknown): v is V2Opponent => V2_OPPONENTS.includes(v as V2Opponent);

export type V2EndReason = MatchResult['reason'] | 'declined' | 'accept_timeout' | 'credits' | 'error' | 'aborted';

/** One agent's line in the debrief. MVP = delivered × 3 + used + picks. */
export interface V2DebriefAgent {
  agentId: string;
  name: string;
  /** Items delivered. */
  delivered: number;
  /** Themed verbs used. */
  used: number;
  /** Items picked up. */
  picks: number;
  /** Bluffs this agent told, how many the rival believed, and rival bluffs it heard and doubted. Absent before bluffs were judged. */
  bluffs?: { told: number; landed: number; seenThrough: number };
}

/** What one crew is told at the end (its own numbers only). */
export interface V2Debrief {
  /** Ranked: this player's Elo change; null for casual and void matches. */
  eloDelta: number | null;
  /** The crew's best agent (id), null when nobody played. */
  mvp: string | null;
  /** The difficulty goal first, then the standing checks shown as stars. */
  goals: { title: string; met: boolean; available?: boolean; progress?: string | null }[];
  /** Messages your crew sent, and rival team messages your agents overheard. */
  talk: { sent: number; overheard: number };
  /** Bluffs your crew told and the rival believed; rival bluffs your agents heard and saw through. Absent before bluffs were judged. */
  bluffs?: { told: number; believed: number; heard: number; seenThrough: number };
  /** Credits held at lock-in, charged for the ticks played, and returned. */
  credits: { held: number; used: number; returned: number };
  /** Ranked results go to the NEAR registry: pending until the worker writes it; null for casual. */
  registry: 'pending' | 'written' | null;
  agents: V2DebriefAgent[];
  difficulty?: Difficulty;
  /** Ranked: the season this result counted towards and the standings points it gave; absent otherwise. */
  season?: { number: number; points: number };
}

export type V2ClientMessage =
  /**
   * Casual only: `mapId` and `difficulty` pick the board; only matching entries pair. Ranked ignores
   * them. `opponent: 'bot'` is practice against the greedy bot: casual only (ranked is refused with
   * practice_unranked), no matchmaking, it starts at once (default board: DEFAULT_PRACTICE).
   */
  | { type: 'v2_queue'; crew: V2CrewEntry[]; ranked: boolean; mapId?: string; difficulty?: Difficulty; opponent?: V2Opponent }
  | { type: 'v2_cancel_queue' }
  | { type: 'v2_watch'; matchId: string }
  | { type: 'v2_unwatch'; matchId: string }
  | { type: 'v2_accept'; matchId: string }
  | { type: 'v2_decline'; matchId: string }
  /**
   * `tiers` is per queued agent (slot order). `crew`, when sent, replaces the queued crew (swap,
   * remove, or add up to `crewLimit`) and its tiers win over `tiers`.
   */
  | { type: 'v2_lock_in'; matchId: string; tiers: TalkTier[]; crew?: V2CrewEntry[] }
  /** Every stored frame of an ended match (answered with v2_frames), for replay at another speed. */
  | { type: 'v2_replay'; matchId: string }
  /**
   * Readies a crew in a private lobby (made and joined over REST). The match starts, through the
   * usual accept and lock-in, once both players have readied; v2_cancel_queue steps back out.
   */
  | { type: 'v2_lobby_ready'; lobbyId: string; crew: V2CrewEntry[] };

export type V2ServerMessage =
  /**
   * `practice`: against the greedy bot, whose handle (`rivalHandle`) is known at once. `free`: this
   * crew holds and pays nothing (the bot, or a player on the offline greedy brain).
   */
  | { type: 'v2_found'; matchId: string; team: Team; mapId: string; ranked: boolean; acceptMs: number; difficulty?: Difficulty; practice?: true; free?: true; rivalHandle?: string }
  | { type: 'v2_accepted'; matchId: string; team: Team }
  /** `crewLimit`: most agents this map takes; `headStartTicks`: the hold each crew gets with the crews as they stand. */
  /** `free`: as on v2_found, this crew is not held for the match. */
  | { type: 'v2_lockin'; matchId: string; lockMs: number; rival: { agents: number }; crewLimit?: number; headStartTicks?: Record<Team, number>; free?: true }
  | { type: 'v2_locked'; matchId: string; team: Team }
  | { type: 'v2_start'; matchId: string; team: Team; rival: { handle: string }; tickMs: number; holdTicks: Record<Team, number> }
  | { type: 'v2_frame'; matchId: string; frame: V2Frame }
  | { type: 'v2_end'; matchId: string; result: MatchResult | null; reason: V2EndReason; logHash: string | null; debrief?: V2Debrief }
  /** Answer to v2_replay: a player's own crew view (the whole board for anyone else), ascending tick. */
  | { type: 'v2_frames'; matchId: string; frames: V2Frame[] }
  /** A private lobby's players readied or stepped back (sent to both). */
  | { type: 'v2_lobby'; lobbyId: string; ready: { host: boolean; guest: boolean } };
