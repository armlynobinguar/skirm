// One v2 match held in memory. Both crews accept within 10 s,
// then lock in their talk tiers within 30 s, and may change the crew while they do (swap, remove or
// add up to the map's crew limit; the head start is re-sent). The rival's handle stays hidden until
// the start. Then the shared map plays in 2 s ticks at the match's difficulty: every agent that can
// act or speak asks the brain, whatever is not back by the action deadline is a wait, talk is
// delivered by the engine, and each crew gets its own fogged frame with its own plan. Credits: a hold
// of every tick at the crew's talk rates up front (whole credits, rounded up once), then each tick
// the crew's cost in hundredths of a credit is added to a running total and only the whole credits
// it newly crosses are charged, so charges never exceed the hold; the rest is returned at the end
// (all of it on a void). A free crew (the practice bot, or a practice player on the greedy brain)
// holds and pays nothing. The match log is hash-chained per tick. At the end each crew gets its
// debrief, and every frame is kept for replay. A player may send live commands (command()): each crew
// has DEFAULTS.commands.perMatch, applied on the next tick, logged in the hash chain and shown only
// to that crew. Draft mode (casual, `setup.draft`): between accept and lock-in each crew in turn
// bans one of the rival's equipped skills (DEFAULTS.draft: bans per crew, the time per step; a step
// not answered in time passes). A banned skill is unequipped from the rival crew for this match,
// also from a crew swapped in at lock-in, and every ban is in both debriefs. Hybrid control
// (control(), steer(); casual and practice only): a player may steer one agent of their own crew by
// hand. Its action each tick comes from the player's latest input (steerAction) instead of the brain,
// a wait when none came by the action deadline; the crew planner is told who is steered, the frames
// mark it and every tick's log entry lists the steered agents (`controlled`), so replays and results
// stay verifiable.
import { V2_ACTION_DEADLINE_MS, V2_PLANNER_DEADLINE_MS, filterSpeech, maySpeak, type V2AgentCommand, type V2Brain, type V2Decision } from '@skirm/decision-engine/v2';
import { DEFAULTS, chargeDue, playerTier, type PlayerTier } from '@skirm/shared';
import {
  commandOrder,
  dropTargets,
  RANKED_DIFFICULTY,
  TICK_MS,
  V2_REPLAN_EVERY,
  actionText,
  appendTick,
  createMatch,
  frameFor,
  holdFor,
  logAgent,
  logHash,
  observe,
  skillActivity,
  startLog,
  steerAction,
  stepMatch,
  tickCostPer100,
  type Action,
  type AgentSpec,
  type CommandPreset,
  type CrewCommand,
  type Difficulty,
  type FrameCommand,
  type FrameSkill,
  type FrameView,
  type MapDefV2,
  type MatchEvent,
  type MatchLog,
  type MatchState,
  type Observation,
  type SayInput,
  type SkillTrigger,
  type SteerInput,
  type TalkTier,
  type Team,
  type V2Frame,
} from '@skirm/engine/v2';
import type { MatchTimelineInput, V2MatchMessageInput } from '@skirm/db';
import type { V2Debrief, V2DraftBan, V2DraftSkill, V2EndReason, V2ServerMessage } from '@skirm/server';
import type { Logger } from '../deps';
import type { Scheduler } from '../timing';
import { DebriefTally, buildDebrief } from './debrief';
import { DecisionTimeline } from './timeline';

export const TEAMS: readonly Team[] = ['A', 'B'];

export interface V2Timing {
  acceptMs: number;
  /** Draft mode: the time each ban step lasts. */
  draftStepMs: number;
  lockMs: number;
  tickMs: number;
  actionMs: number;
  planMs: number;
  /** The crew plan is rewritten every this many ticks. */
  replanEvery: number;
}

export const DEFAULT_V2_TIMING: V2Timing = {
  acceptMs: 10_000,
  draftStepMs: DEFAULTS.draft.stepMs,
  lockMs: 30_000,
  tickMs: TICK_MS,
  actionMs: V2_ACTION_DEADLINE_MS,
  planMs: V2_PLANNER_DEADLINE_MS,
  replanEvery: V2_REPLAN_EVERY,
};

/** The ledger seen from a match: one hold per crew, charged per tick, the rest returned. */
export interface V2Credits {
  hold(team: Team, accountId: string, amount: number): Promise<{ ok: true } | { ok: false; need: number; have: number }>;
  charge(team: Team, amount: number): Promise<void>;
  /** Ends the hold, returning what was not charged. */
  settle(team: Team): Promise<void>;
  /** Voids the hold, returning everything. */
  release(team: Team): Promise<void>;
}

/** A crew as it plays: the agents, their skill prompts and which run a bought skill. */
export interface V2Roster {
  crew: AgentSpec[];
  /** Each agent's equipped skill prompts (secret: sent to its model only). */
  skills: string[][];
  /** Per agent: runs a skill this player did not write (its plan is never shown). Absent: none. */
  bought?: boolean[];
  /** Per agent: the owner's instructions (agents.system_prompt), private like the skills. */
  instructions?: (string | null)[];
  /** Per agent: the skill versions it plays with (recorded on v2_matches.crews, never in the log). */
  skillKeys?: { id: string; version: number }[][];
  /** Per agent: a brain of its own (its player's external agent) instead of the crew's. Absent: none. */
  brains?: (V2Brain | null)[];
  /** Per agent: the public names of `skillKeys`, in the same order (the draft's ban pool). */
  skillNames?: string[][];
  /**
   * Per agent, in skill order: each skill's public name and trigger (null: always). A skill joins
   * its agent's prompt only on ticks its trigger holds. Absent: every skill always plays.
   */
  skillMeta?: V2SkillMeta[][];
}

/** A skill's public metadata as a match uses it. */
export interface V2SkillMeta {
  name: string;
  trigger: SkillTrigger | null;
}

/**
 * A player's crew playbook as a match plays it: the planner reads the text whole, each actor one line.
 * Private like the skills: the text never leaves the server, and only the player's own frames carry
 * the name. Never recorded on the match, its log or its replays.
 */
export interface V2Playbook {
  id: string;
  name: string;
  text: string;
}

export interface V2Side extends V2Roster {
  accountId: string;
  handle: string;
  /** The crew playbook (the one selected when the match was made; lock-in may change it). */
  playbook?: V2Playbook | null;
  /** The player's Elo and ranked matches when they queued (the tiers on a ranked v2_found). */
  rank?: { elo: number; rankedMatches: number };
}

export interface V2Setup {
  matchId: string;
  map: MapDefV2;
  ranked: boolean;
  /** Casual only; ranked always plays RANKED_DIFFICULTY. Default Normal. */
  difficulty?: Difficulty;
  sides: Record<Team, V2Side>;
  /** Practice against the greedy bot (casual): the rival's handle is shown from v2_found on. */
  practice?: boolean;
  /** Crews that hold and pay nothing: the bot, or a practice player on the offline greedy brain. */
  free?: Partial<Record<Team, true>>;
  /** Extra ticks a crew waits at the start (the practice bot on Easy, practiceRival). */
  hold?: Partial<Record<Team, number>>;
  /** Bluffs a crew may tell when not BLUFF_CAP (the practice bot, practiceRival). */
  lieCap?: Partial<Record<Team, number>>;
  /** A private lobby's talk rule: every agent of both crews plays this tier. */
  talk?: TalkTier;
  /** A private lobby's crew size: at most this many agents a crew (the map may allow fewer). */
  crewMax?: number;
  /** Draft mode (casual): a ban phase between accept and lock-in. */
  draft?: boolean;
}

/** What the hub knows once the result is written: each player's Elo change, the registry line and (ranked) the season points. */
export interface V2Finish {
  eloDelta: Partial<Record<Team, number>>;
  registry: V2Debrief['registry'];
  season?: Partial<Record<Team, NonNullable<V2Debrief['season']>>>;
  /** XP each crew's agents earned (from the stored debriefs). */
  xp?: Partial<Record<Team, NonNullable<V2Debrief['xp']>>>;
}

/** Most agents a crew fields on this map (both sides start from the same number of tiles). */
export const crewLimitOf = (map: MapDefV2) => Math.min(3, map.starts.A.length, map.starts.B.length);

export interface V2MatchEnd {
  matchId: string;
  result: MatchState['result'];
  reason: V2EndReason;
  log: MatchLog | null;
  /** The crew at fault for a void (did not accept, declined, short of credits). */
  fault?: Team;
  stats: Record<Team, { timeouts: number; errors: number; illegal: number; refusedSays: number; costUsd: number; charged: number }>;
  /** Every line the engine delivered ('said' events), in tick order; refused lines never appear. */
  messages: V2MatchMessageInput[];
}

export interface V2MatchDeps {
  /** The brain each crew's agents use (practice: the bot plays greedy against the player's brain). */
  brains: Record<Team, V2Brain>;
  scheduler: Scheduler;
  timing?: Partial<V2Timing>;
  credits: V2Credits;
  send(team: Team, msg: V2ServerMessage): void;
  watch?(msg: V2ServerMessage): void;
  /** Writes the result (Elo, registry job, stored frames) before v2_end goes out with the debrief. */
  finish?(end: V2MatchEnd): Promise<V2Finish>;
  log: Logger;
}

type Phase = 'found' | 'draft' | 'lockin' | 'live' | 'ended';

/** A live command as the player sends it: one agent (absent: the whole crew), a preset and/or free text. */
export interface V2CommandInput {
  agentId?: string;
  preset?: CommandPreset;
  text?: string;
}

export type V2CommandError = 'not_live' | 'no_commands' | 'rate_limited' | 'invalid_command' | 'command_refused';

export type V2BanError = 'not_your_turn' | 'invalid_ban';

export type V2BanResult = { ok: true } | { ok: false; code: V2BanError; message: string };

export type V2CommandResult = { ok: true; left: number; tick: number } | { ok: false; code: V2CommandError; message: string };

export type V2ControlError = 'not_live' | 'control_casual' | 'invalid_command' | 'not_controlling';

export type V2ControlResult = { ok: true; agentId: string | null } | { ok: false; code: V2ControlError; message: string };

export class V2Match {
  readonly matchId: string;
  readonly timing: V2Timing;
  readonly difficulty: Difficulty;
  readonly crewLimit: number;
  phase: Phase = 'found';
  state: MatchState | null = null;
  lastFrames: Partial<Record<Team | 'watch', V2ServerMessage>> = {};
  private accepted = new Set<Team>();
  private locked = new Map<Team, TalkTier[]>();
  private declined: Team | null = null;
  private stopReason: string | null = null;
  private poke: (() => void) | null = null;
  private plans: Record<Team, string | null> = { A: null, B: null };
  /** The planner's reason for each crew's plan (the planner trace). */
  private planWhys: Record<Team, string | null> = { A: null, B: null };
  /** Each agent's latest inner voice (its THINK line), by agent id. */
  private thoughts = new Map<string, string>();
  /** Each agent's skills on its latest turn and whether their triggers held, by agent id (own crew's mind panel). */
  private skillsActive = new Map<string, FrameSkill[]>();
  /** Each crew's decision timeline for the debrief; set when the match goes live. */
  private timeline: DecisionTimeline | null = null;
  /** Holds still open (released on a void). */
  private held = new Map<Team, number>();
  /** What each crew had held, kept for the debrief. */
  private heldFor: Partial<Record<Team, number>> = {};
  private lockBy = 0;
  /** Draft mode: every ban step so far, the crew whose turn it is and when its step runs out. */
  private readonly bans: V2DraftBan[] = [];
  private draftTurn: Team | null = null;
  private draftBy = 0;
  private readonly tally: DebriefTally;
  /** Every frame sent, per view, for replay once the match has ended. */
  private readonly frames: Record<FrameView, V2Frame[]> = { A: [], B: [], watch: [] };
  /** Each agent's last actions with where it stood (the brain sees the last 4). */
  private recent = new Map<string, string[]>();
  private readonly messages: V2MatchMessageInput[] = [];
  /** Live commands each crew can still send. */
  private commandsLeft: Record<Team, number> = { A: DEFAULTS.commands.perMatch, B: DEFAULTS.commands.perMatch };
  /** A command waiting for the next tick, per crew. */
  private pendingCommand: Record<Team, CrewCommand | null> = { A: null, B: null };
  /** Tick each crew last sent a command on (the cooldown runs from it). */
  private commandAt: Record<Team, number> = { A: -Infinity, B: -Infinity };
  /** The tick the next waiting command lands on (a tick already deciding has taken its commands). */
  private nextCommandTick = 1;
  /** Every command applied, per crew, for its frames and debrief. */
  private readonly commandLog: Record<Team, FrameCommand[]> = { A: [], B: [] };
  /** The order in force for each agent (by id), until its last tick. */
  private readonly orders = new Map<string, { preset: CommandPreset | null; order: string; until: number }>();
  /** Hybrid control: the agent each crew's player steers (null: the brain runs the whole crew). */
  private readonly controlled: Record<Team, string | null> = { A: null, B: null };
  /** The player's one-tick input waiting for the steered agent's next turn (the latest wins). */
  private readonly steerNext: Record<Team, SteerInput | null> = { A: null, B: null };
  /** The standing order the steered agent walks each tick until it is done (take, deliver, goto). */
  private readonly steerStanding: Record<Team, SteerInput | null> = { A: null, B: null };
  /** Wakes a steered agent's turn that is waiting for input. */
  private readonly steerWake: Record<Team, (() => void) | null> = { A: null, B: null };
  private stats: V2MatchEnd['stats'] = {
    A: { timeouts: 0, errors: 0, illegal: 0, refusedSays: 0, costUsd: 0, charged: 0 },
    B: { timeouts: 0, errors: 0, illegal: 0, refusedSays: 0, costUsd: 0, charged: 0 },
  };

  constructor(
    readonly setup: V2Setup,
    private readonly deps: V2MatchDeps,
  ) {
    this.matchId = setup.matchId;
    this.timing = { ...DEFAULT_V2_TIMING, ...deps.timing };
    this.difficulty = setup.ranked ? RANKED_DIFFICULTY : (setup.difficulty ?? RANKED_DIFFICULTY);
    this.crewLimit = Math.min(crewLimitOf(setup.map), setup.crewMax ?? 3);
    this.tally = new DebriefTally((id) => this.state?.agents.find((a) => a.id === id)?.team);
  }

  accept(team: Team): void {
    if (this.phase !== 'found' || this.accepted.has(team)) return;
    this.accepted.add(team);
    this.toAll({ type: 'v2_accepted', matchId: this.matchId, team });
    this.poke?.();
  }

  decline(team: Team): void {
    if (this.phase !== 'found') return;
    this.declined ??= team;
    this.poke?.();
  }

  /**
   * Talk tier per agent, in crew order (ranked plays Standard whatever is sent). `roster`, when
   * given, replaces the crew (its agents' tiers win) and both crews are sent the new head start.
   * `playbook`, when given, is the crew playbook for the match (null: none); absent keeps the side's.
   * Returns false when the crew can no longer lock in (not in lock-in, or already locked).
   */
  lockIn(team: Team, tiers: TalkTier[], roster?: V2Roster, playbook?: V2Playbook | null): boolean {
    if (this.phase !== 'lockin' || this.locked.has(team)) return false;
    const side = this.setup.sides[team];
    if (playbook !== undefined) side.playbook = playbook;
    if (roster) {
      roster = this.withoutBans(team, roster);
      if (roster.crew.length < 1 || roster.crew.length > this.crewLimit) throw new Error(`crew ${team} must field 1 to ${this.crewLimit} agents`);
      side.crew = roster.crew;
      side.skills = roster.skills;
      side.bought = roster.bought ?? [];
      side.instructions = roster.instructions ?? [];
      side.skillKeys = roster.skillKeys ?? [];
      side.brains = roster.brains ?? [];
      side.skillMeta = roster.skillMeta ?? [];
    }
    const forced = this.setup.talk;
    this.locked.set(team, side.crew.map((a, i) => forced ?? (roster ? a.tier : (tiers[i] ?? a.tier))));
    if (roster) for (const t of TEAMS) this.deps.send(t, this.lockinMessage(t));
    this.toAll({ type: 'v2_locked', matchId: this.matchId, team });
    this.poke?.();
    return true;
  }

  /** Draft mode, the steps of the ban phase: DEFAULTS.draft.bansPerSide per crew, A first. */
  get draftSteps(): number {
    return this.setup.draft ? DEFAULTS.draft.bansPerSide * TEAMS.length : 0;
  }

  /**
   * Draft mode: `team` bans one skill of the rival's crew (or passes, `skillId` null) on its own step.
   * Only a skill in its pool (draftPool) may be banned.
   */
  ban(team: Team, skillId: string | null): V2BanResult {
    if (this.phase !== 'draft' || this.draftTurn !== team) return { ok: false, code: 'not_your_turn', message: 'it is not your ban' };
    let name: string | null = null;
    if (skillId !== null) {
      const pick = this.draftPool(team).find((s) => s.skillId === skillId);
      if (!pick) return { ok: false, code: 'invalid_ban', message: 'that skill is not one the rival has equipped' };
      name = pick.name;
    }
    this.bans.push({ team, step: this.bans.length, skillId, name });
    this.draftTurn = null;
    this.poke?.();
    return { ok: true };
  }

  /** The rival's equipped skills `team` may still ban (ids and public names only, never prompts). */
  draftPool(team: Team): V2DraftSkill[] {
    const rival = this.setup.sides[other(team)];
    const banned = this.bannedFor(other(team));
    const out = new Map<string, V2DraftSkill>();
    (rival.skillKeys ?? []).forEach((keys, i) => {
      const seen = new Set<string>();
      keys.forEach((k, j) => {
        if (banned.has(k.id) || seen.has(k.id)) return;
        seen.add(k.id);
        const cur = out.get(k.id);
        if (cur) cur.agents++;
        else out.set(k.id, { skillId: k.id, name: rival.skillNames?.[i]?.[j] ?? k.id, agents: 1 });
      });
    });
    return [...out.values()];
  }

  /** v2_draft for a crew: whose step it is, the time left, its pool and every ban so far. */
  draftMessage(team: Team): V2ServerMessage {
    return {
      type: 'v2_draft',
      matchId: this.matchId,
      turn: this.draftTurn,
      step: this.bans.length,
      steps: this.draftSteps,
      stepMs: this.draftTurn ? Math.max(0, this.draftBy - this.deps.scheduler.now()) : 0,
      pool: this.draftPool(team),
      bans: this.bans.map((b) => ({ ...b })),
    };
  }

  /** The skill ids the rival banned from `team`'s crew. */
  private bannedFor(team: Team): Set<string> {
    return new Set(this.bans.filter((b) => b.team !== team && b.skillId !== null).map((b) => b.skillId!));
  }

  /** A roster for `team` with the skills its rival banned taken off every agent. */
  private withoutBans<R extends V2Roster>(team: Team, r: R): R {
    const banned = this.bannedFor(team);
    if (!banned.size || !r.skillKeys) return r;
    const keep = r.skillKeys.map((keys) => keys.map((k) => !banned.has(k.id)));
    const pick = <T,>(rows: T[][]) => rows.map((row, i) => row.filter((_, j) => keep[i]?.[j] ?? true));
    return { ...r, skills: pick(r.skills), skillKeys: pick(r.skillKeys), ...(r.skillNames ? { skillNames: pick(r.skillNames) } : {}), ...(r.skillMeta ? { skillMeta: pick(r.skillMeta) } : {}) };
  }

  /** The ban phase: each step waits for its crew's ban, or passes when it runs out (or the crew has nothing to ban). */
  private async draft(): Promise<void> {
    this.phase = 'draft';
    for (let step = 0; step < this.draftSteps; step++) {
      const turn = TEAMS[step % TEAMS.length]!;
      if (!this.draftPool(turn).length) {
        this.bans.push({ team: turn, step, skillId: null, name: null });
        continue;
      }
      this.draftTurn = turn;
      this.draftBy = this.deps.scheduler.now() + this.timing.draftStepMs;
      for (const t of TEAMS) this.deps.send(t, this.draftMessage(t));
      await this.waitFor(() => this.bans.length > step, this.timing.draftStepMs);
      if (this.stopReason) return;
      if (this.bans.length <= step) this.bans.push({ team: turn, step, skillId: null, name: null, timedOut: true });
      this.draftTurn = null;
    }
    for (const t of TEAMS) Object.assign(this.setup.sides[t], this.withoutBans(t, this.setup.sides[t]));
    for (const t of TEAMS) this.deps.send(t, this.draftMessage(t));
    const done = this.bans.filter((b) => b.skillId).map((b) => `${b.team} banned ${b.skillId}`);
    this.deps.log.info(`v2 match ${this.matchId}: draft over (${done.length ? done.join(', ') : 'no bans'})`);
  }

  /** v2_lockin for a crew: the time left, the rival's crew size and both head starts as the crews stand. */
  lockinMessage(team: Team): V2ServerMessage {
    const { sides } = this.setup;
    return {
      type: 'v2_lockin',
      matchId: this.matchId,
      lockMs: Math.max(0, this.lockBy - this.deps.scheduler.now()),
      rival: { agents: sides[team === 'A' ? 'B' : 'A'].crew.length },
      crewLimit: this.crewLimit,
      headStartTicks: this.headStart(),
      ...(this.setup.free?.[team] ? { free: true as const } : {}),
    };
  }

  /** v2_found for a crew (also re-sent on reconnect). */
  foundMessage(team: Team): V2ServerMessage {
    const { setup } = this;
    return {
      type: 'v2_found',
      matchId: this.matchId,
      team,
      mapId: setup.map.id,
      ranked: setup.ranked,
      acceptMs: this.timing.acceptMs,
      difficulty: this.difficulty,
      ...(setup.practice ? { practice: true as const, rivalHandle: setup.sides[team === 'A' ? 'B' : 'A'].handle } : {}),
      ...(setup.free?.[team] ? { free: true as const } : {}),
      ...(setup.draft ? { draft: true as const } : {}),
      ...this.foundTiers(team),
    };
  }

  /** Ranked: both players' tiers (as they queued) for v2_found. */
  private foundTiers(team: Team): { tiers?: { you: PlayerTier; rival: PlayerTier } } {
    const { setup } = this;
    const you = setup.sides[team].rank;
    const rival = setup.sides[team === 'A' ? 'B' : 'A'].rank;
    if (!setup.ranked || setup.practice || !you || !rival) return {};
    return { tiers: { you: playerTier(you.elo, you.rankedMatches), rival: playerTier(rival.elo, rival.rankedMatches) } };
  }

  /** Each crew's start hold with the crews as they stand, as the engine would set it. */
  private headStart(): Record<Team, number> {
    try {
      return { ...this.create(this.setup.sides.A.crew, this.setup.sides.B.crew).holdTicks };
    } catch {
      return { A: 0, B: 0 };
    }
  }

  private create(a: AgentSpec[], b: AgentSpec[]): MatchState {
    return createMatch(this.setup.map, { A: a, B: b }, {
      ranked: this.setup.ranked,
      difficulty: this.difficulty,
      ...(this.setup.hold ? { hold: this.setup.hold } : {}),
      ...(this.setup.lieCap ? { lieCap: this.setup.lieCap } : {}),
    });
  }

  /** Every frame a view was sent; empty until the match went live. */
  framesOf(view: FrameView): readonly V2Frame[] {
    return this.frames[view];
  }

  /** Each crew's decision timeline (the debrief's "why did it do that?"); empty until the match went live. */
  timelines(): MatchTimelineInput[] {
    return this.timeline?.records() ?? [];
  }

  /** Stops the match at the next checkpoint; it ends void with every credit returned. */
  abort(reason: string): void {
    this.stopReason ??= reason;
    this.poke?.();
  }

  async play(): Promise<V2MatchEnd> {
    let end: V2MatchEnd;
    try {
      end = await this.run();
    } catch (err) {
      this.deps.log.error(`v2 match ${this.matchId}: ${(err as Error).stack ?? String(err)}`);
      end = await this.voidMatch('error');
    }
    this.phase = 'ended';
    let fin: V2Finish = { eloDelta: {}, registry: null };
    if (this.deps.finish)
      fin = await this.deps.finish(end).catch((err: unknown) => {
        this.deps.log.error(`v2 match ${this.matchId}: finish failed: ${(err as Error).message}`);
        return fin;
      });
    const base = { type: 'v2_end' as const, matchId: this.matchId, result: end.result, reason: end.reason, logHash: end.log && end.result ? logHash(end.log) : null };
    for (const t of TEAMS) this.deps.send(t, { ...base, debrief: this.debrief(t, end, fin) });
    this.deps.watch?.(base);
    return end;
  }

  /** One crew's own numbers for v2_end. */
  debrief(team: Team, end: V2MatchEnd, fin: V2Finish): V2Debrief {
    const held = this.heldFor[team] ?? 0;
    const d = buildDebrief({
      state: this.state,
      team,
      difficulty: this.difficulty,
      tally: this.tally,
      held,
      charged: this.stats[team].charged,
      void: !end.result,
      eloDelta: end.result ? (fin.eloDelta[team] ?? null) : null,
      registry: end.result ? fin.registry : null,
      ...(end.result && fin.season?.[team] ? { season: fin.season[team] } : {}),
      ...(end.result && fin.xp?.[team]?.length ? { xp: fin.xp[team] } : {}),
      commands: this.commandLog[team],
    });
    return this.setup.draft ? { ...d, draft: { bans: this.bans.map((b) => ({ ...b })) } } : d;
  }

  /** Commands a crew can still send. */
  commandsLeftFor(team: Team): number {
    return this.commandsLeft[team];
  }

  /**
   * A live command from a crew's player, applied on the next tick. Refused when the match is not
   * live, the crew has none left, one is already waiting or was sent within
   * DEFAULTS.commands.cooldownTicks, the agent is not one of the crew's still playing, or the text is
   * refused by the speech filter (it must keep the crew's skills secret like any line its agents say).
   */
  command(team: Team, input: V2CommandInput): V2CommandResult {
    const s = this.state;
    const cfg = DEFAULTS.commands;
    if (this.phase !== 'live' || !s || s.result) return { ok: false, code: 'not_live', message: 'commands are sent during a live match' };
    if (this.commandsLeft[team] <= 0) return { ok: false, code: 'no_commands', message: `no commands left (${cfg.perMatch} a match)` };
    if (this.pendingCommand[team]) return { ok: false, code: 'rate_limited', message: 'a command is already on its way' };
    const lands = this.nextCommandTick;
    if (lands - 1 - this.commandAt[team] < cfg.cooldownTicks) return { ok: false, code: 'rate_limited', message: `one command every ${cfg.cooldownTicks} ticks` };
    const playing = s.agents.filter((a) => a.team === team && !a.out);
    let agents: string[];
    if (input.agentId !== undefined) {
      if (!playing.some((a) => a.id === input.agentId)) return { ok: false, code: 'invalid_command', message: 'that agent is not one of your crew in the match' };
      agents = [input.agentId];
    } else agents = playing.map((a) => a.id);
    if (!agents.length) return { ok: false, code: 'invalid_command', message: 'nobody is left to command' };
    let text: string | null = null;
    if (input.text !== undefined) {
      const raw = input.text.replace(/\s+/g, ' ').trim();
      if ([...raw].length > cfg.maxChars) return { ok: false, code: 'invalid_command', message: `a command is at most ${cfg.maxChars} characters` };
      if (raw) {
        const side = this.setup.sides[team];
        const secrets = [...side.skills.flat(), ...(side.instructions ?? []).filter((t): t is string => !!t), ...(side.playbook ? [side.playbook.text] : [])];
        const f = filterSpeech(raw, secrets);
        if (!f.ok) return { ok: false, code: 'command_refused', message: f.reason === 'leak' ? 'the command repeats a skill' : 'the command was refused by the filter' };
        text = f.text;
      }
    }
    const preset = input.preset ?? null;
    if (!preset && !text) return { ok: false, code: 'invalid_command', message: 'a command needs a preset or text' };
    this.pendingCommand[team] = { team, agents, preset, text };
    this.commandsLeft[team]--;
    this.commandAt[team] = lands - 1;
    return { ok: true, left: this.commandsLeft[team], tick: lands };
  }

  /** The agent `team`'s player steers, or null. */
  controlledBy(team: Team): string | null {
    return this.controlled[team];
  }

  /**
   * Hybrid control: `team`'s player takes over one of its agents still playing (`agentId`), or
   * hands it back to the brain (null). One at a time: taking another hands the first one back.
   * Casual and practice only: refused in ranked, where every move must be the crew's brain's.
   */
  control(team: Team, agentId: string | null): V2ControlResult {
    const s = this.state;
    if (this.phase !== 'live' || !s || s.result) return { ok: false, code: 'not_live', message: 'control is taken during a live match' };
    if (this.setup.ranked) return { ok: false, code: 'control_casual', message: 'steering an agent is for casual and practice matches only' };
    if (agentId !== null && !s.agents.some((a) => a.id === agentId && a.team === team && !a.out))
      return { ok: false, code: 'invalid_command', message: 'that agent is not one of your crew in the match' };
    if (this.controlled[team] === agentId) return { ok: true, agentId };
    this.setControl(team, agentId);
    // The planner learns who is steered on its next plan; a fresh one now so the crew adapts at once.
    void this.replan(team);
    return { ok: true, agentId };
  }

  /**
   * Hybrid control: the player's input for the agent it steers. A one-tick input (move, wait, use)
   * waits for the agent's next turn and replaces any earlier one; a standing order (take, deliver,
   * goto) replaces the last and is walked each tick until done; stop drops both.
   */
  steer(team: Team, input: SteerInput): V2ControlResult {
    const s = this.state;
    if (this.phase !== 'live' || !s || s.result) return { ok: false, code: 'not_live', message: 'steering is during a live match' };
    const id = this.controlled[team];
    if (!id) return { ok: false, code: 'not_controlling', message: 'take control of an agent first' };
    if (input.kind === 'stop') {
      this.steerNext[team] = null;
      this.steerStanding[team] = null;
    } else if (input.kind === 'take' || input.kind === 'deliver' || input.kind === 'goto') {
      this.steerNext[team] = null;
      this.steerStanding[team] = input;
    } else this.steerNext[team] = input;
    this.steerWake[team]?.();
    return { ok: true, agentId: id };
  }

  private setControl(team: Team, agentId: string | null) {
    this.controlled[team] = agentId;
    this.steerNext[team] = null;
    this.steerStanding[team] = null;
    this.steerWake[team]?.();
  }

  /** The steered agent's action this tick from the player's input; null when there is none yet. */
  private steered(team: Team, o: Observation): V2Decision | null {
    const next = this.steerNext[team];
    if (next) {
      this.steerNext[team] = null;
      return { action: steerAction(o, next).action, reason: 'chosen', say: null };
    }
    const standing = this.steerStanding[team];
    if (!standing) return null;
    const r = steerAction(o, standing);
    if (r.done) this.steerStanding[team] = null;
    return { action: r.action, reason: 'chosen', say: null };
  }

  /** A steered agent's turn: the input already waiting, else the first to arrive by the action deadline, else a wait. */
  private steerDecide(team: Team, o: Observation): Promise<V2Decision> {
    const wait: V2Decision = { action: { type: 'wait' }, reason: 'chosen', say: null };
    const now = this.steered(team, o);
    if (now) return Promise.resolve(now);
    const sched = this.deps.scheduler;
    return new Promise((resolve) => {
      const finish = (d: V2Decision) => {
        sched.clearTimeout(h);
        this.steerWake[team] = null;
        resolve(d);
      };
      const h = sched.setTimeout(() => finish(this.steered(team, o) ?? wait), this.timing.actionMs);
      this.steerWake[team] = () => {
        // Handed back to the brain or to another agent meanwhile: this turn waits.
        if (this.controlled[team] !== o.me.id) return finish(wait);
        const d = this.steered(team, o);
        if (d) finish(d);
      };
    });
  }

  /** The commands waiting for `tick` (the one about to be played), now in force. */
  private applyCommands(tick: number): CrewCommand[] {
    const out: CrewCommand[] = [];
    const until = tick + DEFAULTS.commands.activeTicks - 1;
    this.nextCommandTick = tick + 1;
    for (const t of TEAMS) {
      const c = this.pendingCommand[t];
      if (!c) continue;
      this.pendingCommand[t] = null;
      out.push(c);
      const order = commandOrder(c);
      for (const id of c.agents) this.orders.set(id, { preset: c.preset, order, until });
      this.commandLog[t].push({ tick, until, agents: [...c.agents], preset: c.preset, text: c.text });
    }
    return out;
  }

  /** The order an agent follows on `tick`, if one is still in force. */
  private orderFor(s: MatchState, id: string, tick: number): V2AgentCommand | null {
    const o = this.orders.get(id);
    if (!o || o.until < tick) return null;
    return { preset: o.preset, order: o.order, ticksLeft: o.until - tick + 1, ...(o.preset === 'go_drop' ? { targets: dropTargets(s) } : {}) };
  }

  private toAll(msg: V2ServerMessage) {
    for (const t of TEAMS) this.deps.send(t, msg);
  }

  /** Resolves once `done()` holds (re-checked on every poke) or after `ms`. */
  private waitFor(done: () => boolean, ms: number): Promise<void> {
    const s = this.deps.scheduler;
    return new Promise((resolve) => {
      const finish = () => {
        s.clearTimeout(h);
        this.poke = null;
        resolve();
      };
      const h = s.setTimeout(finish, ms);
      this.poke = () => {
        if (done() || this.stopReason) finish();
      };
      this.poke();
    });
  }

  private async run(): Promise<V2MatchEnd> {
    const { setup, timing } = this;
    for (const t of TEAMS) this.deps.send(t, this.foundMessage(t));
    await this.waitFor(() => this.accepted.size === 2 || this.declined !== null, timing.acceptMs);
    if (this.stopReason) return this.voidMatch('aborted');
    if (this.declined) return this.voidMatch('declined', this.declined);
    if (this.accepted.size < 2) return this.voidMatch('accept_timeout', TEAMS.find((t) => !this.accepted.has(t)));

    if (setup.draft) {
      await this.draft();
      if (this.stopReason) return this.voidMatch('aborted');
    }

    this.phase = 'lockin';
    this.lockBy = this.deps.scheduler.now() + timing.lockMs;
    for (const t of TEAMS) this.deps.send(t, this.lockinMessage(t));
    await this.waitFor(() => this.locked.size === 2, timing.lockMs);
    if (this.stopReason) return this.voidMatch('aborted');
    const crews = {} as Record<Team, AgentSpec[]>;
    for (const t of TEAMS) {
      const tiers = this.locked.get(t);
      crews[t] = setup.sides[t].crew.map((a, i) => ({ ...a, tier: tiers?.[i] ?? a.tier }));
    }

    // The state first (it is pure): the difficulty sets the clock the hold covers. A free crew holds nothing.
    const s = this.create(crews.A, crews.B);
    const pays = TEAMS.filter((t) => !setup.free?.[t]);
    for (const t of pays) {
      const amount = holdFor(crews[t], setup.ranked, s.limit);
      const r = await this.deps.credits.hold(t, setup.sides[t].accountId, amount);
      if (!r.ok) return this.voidMatch('credits', t);
      this.held.set(t, amount);
      this.heldFor[t] = amount;
    }

    this.state = s;
    const crewOf = (t: Team) => ({ brain: this.deps.brains[t].kind, bought: setup.sides[t].bought ?? [], skillKeys: setup.sides[t].skillKeys ?? [] });
    this.timeline = new DecisionTimeline({ A: crewOf('A'), B: crewOf('B') });
    // One model name when both crews share a brain, else each crew's (as the headless runner writes it).
    const { A: brainA, B: brainB } = this.deps.brains;
    const model = brainA.model === brainB.model ? brainA.model : `A:${brainA.model} B:${brainB.model}`;
    const log = startLog({
      schema: 'skirm.match/v2',
      map: setup.map.id,
      crews: { A: s.agents.filter((a) => a.team === 'A').map(header), B: s.agents.filter((a) => a.team === 'B').map(header) },
      ranked: setup.ranked,
      ...(this.difficulty !== RANKED_DIFFICULTY ? { difficulty: this.difficulty } : {}),
      models: { planner: model, actor: model, speech: model },
    });

    await Promise.all(TEAMS.map((t) => this.replan(t)));
    this.phase = 'live';
    for (const t of TEAMS)
      this.deps.send(t, { type: 'v2_start', matchId: this.matchId, team: t, rival: { handle: setup.sides[t === 'A' ? 'B' : 'A'].handle }, tickMs: timing.tickMs, holdTicks: { ...s.holdTicks } });
    this.publish([]);

    const sched = this.deps.scheduler;
    /** Each crew's running cost in hundredths of a credit; stats.charged is what has been charged. */
    const cum100: Record<Team, number> = { A: 0, B: 0 };
    while (!s.result) {
      if (this.stopReason) return this.voidMatch('aborted', undefined, log);
      const tickStart = sched.now();
      const costPer100 = { A: tickCostPer100(s, 'A'), B: tickCostPer100(s, 'B') };
      const live = s.agents.filter((a) => !a.out);
      const commands = this.applyCommands(s.tick + 1);
      const steered = live.filter((a) => this.controlled[a.team] === a.id).map((a) => a.id);
      const decisions = await Promise.all(live.map((a) => this.decide(s, a.id)));
      if (this.stopReason) return this.voidMatch('aborted', undefined, log);
      const actions: Record<string, Action> = {};
      const says: SayInput[] = [];
      live.forEach((a, i) => {
        const d = decisions[i]!;
        actions[a.id] = d.action;
        const r = this.recent.get(a.id) ?? [];
        r.push(`${actionText(d.action)} from ${a.x},${a.y}`);
        this.recent.set(a.id, r.slice(-4));
        if (d.say) says.push({ agent: a.id, channel: d.say.channel, text: d.say.text });
        // The inner voice is never part of the match (not in the log, never heard); only its own crew's frames show it.
        if (d.thought) this.thoughts.set(a.id, d.thought);
        this.count(a.team, d);
        this.timeline?.turn(a, d);
      });
      const ev = stepMatch(s, { actions, says });
      appendTick(log, { tick: s.tick, actions, says, ...(commands.length ? { commands } : {}), ...(steered.length ? { controlled: steered } : {}) });
      // A steered agent that is out goes back to nobody: there is nothing left to steer.
      for (const t of TEAMS) if (this.controlled[t] && s.agents.find((a) => a.id === this.controlled[t])?.out) this.setControl(t, null);
      this.tally.add(ev);
      this.timeline?.resolve(s, ev);
      this.collect(s, ev);
      for (const t of pays) {
        cum100[t] += costPer100[t];
        const due = chargeDue(cum100[t], this.stats[t].charged);
        if (due > 0) {
          await this.deps.credits.charge(t, due);
          this.stats[t].charged += due;
        }
      }
      this.publish(ev);
      if (s.result) break;
      if (s.tick % timing.replanEvery === 0) for (const t of TEAMS) void this.replan(t);
      await this.sleepUntil(tickStart + timing.tickMs);
    }
    log.result = s.result;
    for (const t of this.held.keys()) await this.deps.credits.settle(t).catch((e: unknown) => this.deps.log.warn(`v2 match ${this.matchId} ${t}: settle failed: ${(e as Error).message}`));
    return { matchId: this.matchId, result: s.result, reason: s.result!.reason, log, stats: this.stats, messages: this.messages };
  }

  /** The lines the engine delivered this tick, with who heard and who overheard them. */
  private collect(s: MatchState, ev: readonly MatchEvent[]) {
    for (const e of ev) {
      if (e.kind !== 'said') continue;
      const a = s.agents.find((x) => x.id === e.agent);
      if (!a) continue;
      this.messages.push({ tick: s.tick, team: a.team, agentId: a.id, agentName: a.name, channel: e.channel, text: e.text, heardBy: [...e.heardBy], overheardBy: [...e.overheardBy] });
    }
  }

  private async sleepUntil(at: number): Promise<void> {
    const ms = at - this.deps.scheduler.now();
    if (ms > 0) await this.waitFor(() => false, ms);
  }

  /** The brain's answer, or a wait at the action deadline. Agents that can neither act nor speak skip the call. */
  private decide(s: MatchState, id: string): Promise<V2Decision> {
    const a = s.agents.find((x) => x.id === id)!;
    const o = observe(s, id);
    this.timeline?.observe(id, o);
    const canSpeak = maySpeak(a.tier, s.tick + 1, a.lastSpoke);
    const wait: Action = { type: 'wait' };
    const side = this.setup.sides[a.team];
    const skills = side.skills[a.slot] ?? [];
    const meta = side.skillMeta?.[a.slot] ?? [];
    const skillTriggers = skills.map((_, i) => meta[i]?.trigger ?? null);
    const active = skillActivity(skillTriggers, o);
    if (skills.length) this.skillsActive.set(id, skills.map((_, i) => ({ name: meta[i]?.name ?? `Skill ${i + 1}`, trigger: skillTriggers[i] ?? { kind: 'always' }, active: active[i]! })));
    // Hybrid control: the player's input, never the brain (a steered agent does not speak).
    if (this.controlled[a.team] === id) return this.steerDecide(a.team, o);
    if (o.legal.length <= 1 && !canSpeak) return Promise.resolve({ action: o.legal[0] ?? wait, reason: 'chosen', say: null });
    const command = this.orderFor(s, id, s.tick + 1);
    const ctx = { skills, skillTriggers, instructions: side.instructions?.[a.slot] ?? null, playbook: side.playbook?.text ?? null, plan: this.plans[a.team], canSpeak, recent: this.recent.get(id) ?? [], command };
    const sched = this.deps.scheduler;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (d: V2Decision) => {
        if (settled) return;
        settled = true;
        sched.clearTimeout(h);
        resolve(d);
      };
      const h = sched.setTimeout(() => finish({ action: wait, reason: 'timeout', say: null }), this.timing.actionMs);
      this.brainOf(a.team, a.slot).act(o, ctx).then(finish, () => finish({ action: wait, reason: 'error', say: null }));
    });
  }

  /** The agent's own brain (its player's external agent) when it has one, else its crew's. */
  private brainOf(team: Team, slot: number): V2Brain {
    return this.setup.sides[team].brains?.[slot] ?? this.deps.brains[team];
  }

  private count(team: Team, d: V2Decision) {
    const st = this.stats[team];
    if (d.reason === 'timeout') st.timeouts++;
    else if (d.reason === 'error') st.errors++;
    else if (d.reason === 'illegal') st.illegal++;
    if (d.refusedSay) st.refusedSays++;
    st.costUsd += d.call?.costUsd ?? 0;
  }

  /** The crew plan, written from its first agent still in the match (kept as is on failure). */
  private async replan(team: Team): Promise<void> {
    const s = this.state!;
    const lead = s.agents.find((a) => a.team === team && !a.out);
    if (!lead) return;
    const side = this.setup.sides[team];
    const skills = side.skills.flat();
    // The plan is written from the lead's view, so each skill joins it when its trigger holds there.
    const skillTriggers = side.skills.flatMap((sk, slot) => sk.map((_, i) => side.skillMeta?.[slot]?.[i]?.trigger ?? null));
    const instructions = (this.setup.sides[team].instructions ?? []).filter((t): t is string => !!t).join('\n\n') || null;
    let timer: unknown;
    const late = new Promise<null>((r) => (timer = this.deps.scheduler.setTimeout(() => r(null), this.timing.planMs)));
    const r = await Promise.race([this.deps.brains[team].plan(observe(s, lead.id), { skills, skillTriggers, instructions, playbook: side.playbook?.text ?? null, controlled: this.controlledName(team) }).catch(() => null), late]);
    this.deps.scheduler.clearTimeout(timer);
    if (r) {
      this.stats[team].costUsd += r.call?.costUsd ?? 0;
      if (r.text) {
        this.plans[team] = r.text;
        this.planWhys[team] = r.why ?? null;
        this.timeline?.plan(team, s.tick + 1, r.text, r.why ?? null);
      }
    }
  }

  /** The name of the agent `team`'s player steers, for the planner. */
  private controlledName(team: Team): string | null {
    const id = this.controlled[team];
    return id ? (this.state?.agents.find((a) => a.id === id)?.name ?? null) : null;
  }

  private publish(ev: MatchEvent[]) {
    const s = this.state!;
    for (const t of TEAMS) {
      let frame = withOwnCrew(frameFor(s, t, ev), s, t, ev, this.plans[t], this.setup.sides[t].bought ?? [], { why: this.planWhys[t], thoughts: this.thoughts, skills: this.skillsActive });
      // Its own live commands: the rival's frames and the watch view never carry them.
      frame = { ...frame, commands: { left: this.commandsLeft[t], log: this.commandLog[t].map((c) => ({ ...c, agents: [...c.agents] })) } };
      // Its crew playbook by name only (the owner's mind panel); never the text, never another view.
      const playbook = this.setup.sides[t].playbook;
      if (playbook) frame.playbook = playbook.name;
      // Hybrid control: who its player steers and the standing order it walks (its own frames only).
      const steering = this.controlled[t];
      const standing = this.steerStanding[t];
      if (steering) frame.steer = { agentId: steering, standing: standing ? { ...standing } : null };
      frame = withControlled(frame, this.controlled);
      // Practice shows all minds (the prototype): the player also sees the bot's plan, reason and inner voice.
      if (this.setup.practice) {
        const r: Team = t === 'A' ? 'B' : 'A';
        frame = withRivalMind(frame, t, this.plans[r], this.planWhys[r], this.thoughts, this.setup.sides[r].bought ?? []);
      }
      const msg: V2ServerMessage = { type: 'v2_frame', matchId: this.matchId, frame };
      this.frames[t].push(frame);
      this.lastFrames[t] = msg;
      this.deps.send(t, msg);
    }
    const watch = withControlled(frameFor(s, 'watch', ev), this.controlled);
    this.frames.watch.push(watch);
    if (this.deps.watch) {
      const msg: V2ServerMessage = { type: 'v2_frame', matchId: this.matchId, frame: watch };
      this.lastFrames.watch = msg;
      this.deps.watch(msg);
    }
  }

  private async voidMatch(reason: V2EndReason, fault?: Team, log: MatchLog | null = null): Promise<V2MatchEnd> {
    this.deps.log.warn(`v2 match ${this.matchId}: void (${reason}${fault ? `, crew ${fault}` : ''})`);
    for (const t of this.held.keys()) await this.deps.credits.release(t).catch(() => undefined);
    this.held.clear();
    return { matchId: this.matchId, result: null, reason, log, ...(fault ? { fault } : {}), stats: this.stats, messages: this.messages };
  }
}

/**
 * A crew's frame with what only that crew may see: the crew plan and the planner's reason on each of
 * its agents, each agent's inner voice, and the rival agents that overheard each of its team
 * messages. The plan is one crew plan written with every equipped skill in its prompt, so when any
 * agent of the crew runs a bought skill the plan and its reason are withheld from the whole crew
 * (`planHidden`): a bought skill never leaks through plan text. An agent's inner voice comes from its
 * own prompt, so it is withheld when that agent runs a bought (or rented) skill. Each agent's skills
 * show by name and trigger with whether the trigger held on its last turn (public metadata only).
 */
export function withOwnCrew(
  frame: V2Frame,
  s: MatchState,
  team: Team,
  ev: readonly MatchEvent[],
  plan: string | null,
  bought: readonly boolean[],
  mind: { why?: string | null; thoughts?: ReadonlyMap<string, string>; skills?: ReadonlyMap<string, FrameSkill[]> } = {},
): V2Frame {
  const hidden = bought.some(Boolean);
  const slotOf = (id: string) => s.agents.find((x) => x.id === id)?.slot ?? -1;
  const agents = frame.agents.map((a) => {
    if (a.team !== team) return a;
    const thought = bought[slotOf(a.id)] ? undefined : mind.thoughts?.get(a.id);
    // Skill names and triggers are public metadata, so they show even on a bought skill; never the prompt.
    const skills = mind.skills?.get(a.id);
    const own = { ...a, ...(thought ? { thought } : {}), ...(skills?.length ? { skills: skills.map((k) => ({ ...k })) } : {}) };
    if (hidden) return { ...own, planHidden: true };
    return plan ? { ...own, plan, ...(mind.why ? { planWhy: mind.why } : {}) } : own;
  });
  const nameOf = (id: string) => s.agents.find((a) => a.id === id)?.name ?? id;
  const comms = frame.comms.map((m) => {
    if (m.team !== team || m.overheardBy) return m;
    // An agent speaks at most once a tick, so its message this tick is its one 'said' event.
    const e = ev.find((x) => x.kind === 'said' && x.agent === m.from && x.text === m.text);
    const by = e?.kind === 'said' ? e.overheardBy.filter((id) => s.agents.find((a) => a.id === id)?.team !== team).map(nameOf) : [];
    return by.length ? { ...m, overheardBy: by } : m;
  });
  return { ...frame, agents, comms };
}

/**
 * Practice only: the rival agents in a crew's frame with their own crew's plan, its reason and each
 * agent's inner voice. Never in ranked or casual play against people, whose strategy stays theirs;
 * withheld like an own crew's for any rival on a bought skill.
 */
export function withRivalMind(
  frame: V2Frame,
  team: Team,
  plan: string | null,
  why: string | null,
  thoughts: ReadonlyMap<string, string>,
  rivalBought: readonly boolean[],
): V2Frame {
  if (rivalBought.some(Boolean)) return frame;
  const agents = frame.agents.map((a) => {
    if (a.team === team) return a;
    const thought = thoughts.get(a.id);
    return { ...a, ...(plan ? { plan } : {}), ...(plan && why ? { planWhy: why } : {}), ...(thought ? { thought } : {}) };
  });
  return { ...frame, agents };
}

/**
 * Hybrid control: marks the agents their players steer (`controlled`) in a frame, in every view
 * (own, rival and watch), as the match log does: a steered agent is never passed off as the brain's.
 */
export function withControlled(frame: V2Frame, controlled: Readonly<Record<Team, string | null>>): V2Frame {
  const ids = new Set(TEAMS.map((t) => controlled[t]).filter((id): id is string => !!id));
  if (!ids.size) return frame;
  return { ...frame, agents: frame.agents.map((a) => (ids.has(a.id) ? { ...a, controlled: true as const } : a)) };
}

const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');

const header = logAgent;
