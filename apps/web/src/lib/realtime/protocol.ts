// WebSocket messages of apps/realtime (path /ws). Mirrors WsClientMessage / WsServerMessage in
// packages/server/src/queues.ts and the parser in apps/realtime/src/protocol.ts; copied here because
// @skirm/server is Node-only (bullmq, ioredis). Keep in sync.
import type { CommandPreset, Difficulty, FrameAgent, FrameCommand, FrameItem, ItemOrigin, MatchResult, TalkTier, Team, V2Frame } from '@skirm/engine/v2';
import type { PlayerTier, Side } from '@skirm/shared';

export type { Side, V2Frame, FrameAgent, FrameCommand, FrameItem, ItemOrigin, TalkTier, Team, MatchResult, Difficulty, CommandPreset };

/** v2 (packages/server/src/v2.ts): found → accept (10 s) → lock-in (30 s) → live (2 s ticks) → end. */
/** Who a v2_queue plays: absent for a matchmade rival, 'bot' for practice against the greedy bot. */
export type V2Opponent = 'bot';

export interface V2CrewEntry {
  agentId: string;
  tier: TalkTier;
}

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
  /** The live commands this crew's player sent, as applied (tick order); absent when none. */
  commands?: V2DebriefCommand[];
}

/** One live command in the debrief transcript. */
export interface V2DebriefCommand {
  tick: number;
  agents: { id: string; name: string }[];
  preset: CommandPreset | null;
  text: string | null;
}

export type V2ClientMessage =
  /**
   * Casual only: `mapId` and `difficulty` pick the board; only matching entries pair. Ranked ignores
   * them. `opponent: 'bot'` is practice against the greedy bot: casual only, no matchmaking, it
   * starts at once (the server picks DEFAULT_PRACTICE when no board is given).
   */
  | { type: 'v2_queue'; crew: V2CrewEntry[]; ranked: boolean; mapId?: string; difficulty?: Difficulty; opponent?: V2Opponent }
  | { type: 'v2_cancel_queue' }
  | { type: 'v2_watch'; matchId: string }
  | { type: 'v2_unwatch'; matchId: string }
  | { type: 'v2_accept'; matchId: string }
  | { type: 'v2_decline'; matchId: string }
  /** `tiers` is per queued agent; `crew`, when sent, replaces the queued crew (up to `crewLimit`) and its tiers win. */
  | { type: 'v2_lock_in'; matchId: string; tiers: TalkTier[]; crew?: V2CrewEntry[] }
  /** Every stored frame of an ended match (answered with v2_frames), for replay at another speed. */
  | { type: 'v2_replay'; matchId: string }
  /** A live command to your own crew: one agent or all of it, a preset and/or free text. Answered with v2_command_ok. */
  | { type: 'v2_command'; matchId: string; agentId?: string; preset?: CommandPreset; text?: string };

/** What practice adds to v2_found and v2_lockin. */
export interface V2PracticeFlags {
  /** Against the greedy bot (no matchmaking, no Elo). */
  practice?: true;
  /** This crew holds and pays nothing (the bot, or a player on the server's offline greedy brain). */
  free?: true;
  /** The rival's handle when it is known before the start (the bot's). */
  rivalHandle?: string;
}

/** What ranked adds to v2_found: both players' ranked tiers as they queued (the rival stays unnamed). */
export interface V2FoundTiers {
  tiers?: { you: PlayerTier; rival: PlayerTier };
}

export type V2ServerMessage =
  | ({ type: 'v2_found'; matchId: string; team: Team; mapId: string; ranked: boolean; acceptMs: number; difficulty?: Difficulty } & V2PracticeFlags & V2FoundTiers)
  | { type: 'v2_accepted'; matchId: string; team: Team }
  /** `crewLimit`: most agents this map takes; `headStartTicks`: each crew's hold with the crews as they stand. */
  | ({ type: 'v2_lockin'; matchId: string; lockMs: number; rival: { agents: number }; crewLimit?: number; headStartTicks?: Record<Team, number> } & V2PracticeFlags)
  | { type: 'v2_locked'; matchId: string; team: Team }
  | { type: 'v2_start'; matchId: string; team: Team; rival: { handle: string }; tickMs: number; holdTicks: Record<Team, number> }
  | { type: 'v2_frame'; matchId: string; frame: V2Frame }
  | { type: 'v2_end'; matchId: string; result: MatchResult | null; reason: V2EndReason; logHash: string | null; debrief?: V2Debrief }
  /** Answer to v2_replay: a player's own crew view (the whole board for anyone else), ascending tick. */
  | { type: 'v2_frames'; matchId: string; frames: V2Frame[] }
  /** The command is applied on `tick`; `left` remain this match. */
  | { type: 'v2_command_ok'; matchId: string; tick: number; left: number };

export type WsClientMessage = { type: 'auth'; token?: string; devUser?: string } | V2ClientMessage;

export type WsServerMessage =
  | { type: 'queue_status'; searchingMs: number; eloRange: number }
  | { type: 'error'; code: WsErrorCode; message: string }
  | V2ServerMessage;

/** apps/realtime/src/protocol.ts ErrorCode. */
export type WsErrorCode =
  | 'bad_json'
  | 'bad_message'
  | 'unknown_type'
  | 'too_large'
  | 'unauthenticated'
  | 'auth_failed'
  | 'already_authenticated'
  | 'already_queued'
  | 'not_queued'
  | 'in_match'
  | 'invalid_crew'
  | 'not_in_lockin'
  | 'agent_busy'
  | 'insufficient_credits'
  | 'match_void'
  | 'not_found'
  | 'not_live'
  | 'no_commands'
  | 'rate_limited'
  | 'invalid_command'
  | 'command_refused'
  | 'too_many_subscriptions'
  | 'unavailable'
  | 'internal'
  | (string & {});

export type WsServerMessageOf<T extends WsServerMessage['type']> = Extract<WsServerMessage, { type: T }>;
