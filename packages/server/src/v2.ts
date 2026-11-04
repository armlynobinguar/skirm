// v2 match messages on /ws. A match goes found → accept (10 s,
// both crews) → lock-in (30 s: talk tiers and crew changes, the rival hidden) → live (2 s ticks) →
// end. Each crew gets its own frame through its own fog; watchers get the whole board.
import type { CommandPreset, Difficulty, MatchResult, TalkTier, Team, V2Frame } from '@skirm/engine/v2';
import type { PlayerTier } from '@skirm/shared';

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

/** XP one agent earned from the match, with its total and level after it (agent progression). */
export interface V2DebriefXp {
  agentId: string;
  name: string;
  gained: number;
  xp: number;
  level: number;
  leveledUp: boolean;
  /** A trait pick is waiting (earned and not yet taken). */
  traitReady: boolean;
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
  /** XP each of the crew's agents earned (ranked and casual matches played to the end); absent when none. */
  xp?: V2DebriefXp[];
  /** The live commands this crew's player sent, as applied (tick order); absent when none. Never the rival's. */
  commands?: V2DebriefCommand[];
  /** Draft mode: every ban step of the match, both crews' (bans are public to both players). */
  draft?: { bans: V2DraftBan[] };
}

/**
 * Draft mode: a skill the rival crew has equipped, as the ban screen shows it. Only its id and public
 * name (and how many rival agents run it), never its prompt.
 */
export interface V2DraftSkill {
  skillId: string;
  name: string;
  agents: number;
}

/** One ban step: the crew that banned, the skill it banned (null: passed), and whether the step ran out. */
export interface V2DraftBan {
  team: Team;
  step: number;
  skillId: string | null;
  name: string | null;
  timedOut?: true;
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
   * them. `opponent: 'bot'` is practice against the greedy bot: casual only (ranked is refused with
   * practice_unranked), no matchmaking, it starts at once (default board: DEFAULT_PRACTICE).
   */
  /**
   * `draft: true` queues draft mode (casual only, `draft_casual`): draft searches pair only with
   * draft searches, and after accept each crew bans a rival skill in turn (v2_draft / v2_ban).
   */
  | { type: 'v2_queue'; crew: V2CrewEntry[]; ranked: boolean; mapId?: string; difficulty?: Difficulty; opponent?: V2Opponent; draft?: boolean }
  | { type: 'v2_cancel_queue' }
  | { type: 'v2_watch'; matchId: string }
  | { type: 'v2_unwatch'; matchId: string }
  | { type: 'v2_accept'; matchId: string }
  | { type: 'v2_decline'; matchId: string }
  /**
   * `tiers` is per queued agent (slot order). `crew`, when sent, replaces the queued crew (swap,
   * remove, or add up to `crewLimit`) and its tiers win over `tiers`. `playbookId` picks one of the
   * player's crew playbooks for this match (null: none); absent keeps the one selected over REST.
   */
  | { type: 'v2_lock_in'; matchId: string; tiers: TalkTier[]; crew?: V2CrewEntry[]; playbookId?: string | null }
  /** Every stored frame of an ended match (answered with v2_frames), for replay at another speed. */
  | { type: 'v2_replay'; matchId: string }
  /**
   * Readies a crew in a private lobby (made and joined over REST). The match starts, through the
   * usual accept and lock-in, once both players have readied; v2_cancel_queue steps back out.
   */
  | { type: 'v2_lobby_ready'; lobbyId: string; crew: V2CrewEntry[] }
  /**
   * A live command to the player's own crew: one agent (`agentId`) or all of it, a preset and/or free
   * text (at most DEFAULTS.commands.maxChars, through the speech filter). Answered with v2_command_ok.
   */
  | { type: 'v2_command'; matchId: string; agentId?: string; preset?: CommandPreset; text?: string }
  /** Draft mode, on your turn: ban one of the rival's equipped skills (from v2_draft `pool`), or pass with null. */
  | { type: 'v2_ban'; matchId: string; skillId: string | null };

export type V2ServerMessage =
  /**
   * `practice`: against the greedy bot, whose handle (`rivalHandle`) is known at once. `free`: this
   * crew holds and pays nothing (the bot, or a player on the offline greedy brain). `tiers`: ranked
   * only, both players' ranked tiers as they queued (the rival stays unnamed).
   */
  | { type: 'v2_found'; matchId: string; team: Team; mapId: string; ranked: boolean; acceptMs: number; difficulty?: Difficulty; practice?: true; free?: true; rivalHandle?: string; draft?: true; tiers?: { you: PlayerTier; rival: PlayerTier } }
  | { type: 'v2_accepted'; matchId: string; team: Team }
  /**
   * Draft mode, after accept and before lock-in: sent to both crews at each ban step and once when the
   * draft is over (`turn` null). `turn` bans within `stepMs` (else it passes); `pool` is what this
   * crew may ban (the rival's equipped skills not banned yet); `bans` every step so far.
   */
  | { type: 'v2_draft'; matchId: string; turn: Team | null; step: number; steps: number; stepMs: number; pool: V2DraftSkill[]; bans: V2DraftBan[] }
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
  | { type: 'v2_lobby'; lobbyId: string; ready: { host: boolean; guest: boolean } }
  /** Answer to v2_command, to the sender's crew only: the command is applied on `tick`; `left` remain. */
  | { type: 'v2_command_ok'; matchId: string; tick: number; left: number };
