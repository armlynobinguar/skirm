'use client';
// What this tab knows about its v2 matches, built from the server's v2_* messages. One listener per
// Realtime client feeds it for the life of the tab, so nothing is lost between the hub navigating
// on v2_found and the match screen mounting. The comms feed keeps every message a frame carried,
// plus the verbs, switches and supply drops it reported and each change of your agents' plans.
// A tab that never played the match builds its view from the first frame it gets: a spectator's
// whole-board frame (v2_watch) gives a watch view, a player's own frame (resumed after a reload) a
// player view. A player view never takes a whole-board frame; a watch view that gets a crew's frame
// turns into that crew's view, since the server sends those only to the crew's own player.
// `said` keeps every say and team line for the debrief's transcript, uncapped (talk is rate-limited
// per tier), unlike the feed, which keeps the last MAX_COMMS lines of everything. Your own live
// commands (the frame's `commands`, never in the rival's) join both as 'order' lines. Draft mode adds
// a 'draft' phase between found and lock-in, built from v2_draft (whose ban it is, the pool, the bans).
import { commandLabel, mapV2 } from '@skirm/engine/v2';
import type { PlayerTier } from '@skirm/shared';
import { useEffect, useSyncExternalStore } from 'react';
import type { Realtime } from '@/lib/realtime/client';
import type { Difficulty, FrameAgent, MatchResult, TalkTier, Team, V2Debrief, V2DraftBan, V2DraftSkill, V2EndReason, V2Frame, WsServerMessage } from '@/lib/realtime/protocol';
import { useRealtime } from '@/lib/services';

export interface V2QueuedAgent {
  agentId: string;
  name: string;
  tier: TalkTier;
}

export type V2Phase = 'found' | 'draft' | 'lockin' | 'live' | 'ended';

/** Draft mode as the latest v2_draft left it. */
export interface V2DraftView {
  /** Whose ban it is; null before the first step and once the draft is over. */
  turn: Team | null;
  step: number;
  steps: number;
  /** Wall time (ms) the current step runs out; null when no step is open. */
  by: number | null;
  /** The rival's skills you may still ban. */
  pool: V2DraftSkill[];
  bans: V2DraftBan[];
  /** The last step has been played (v2_draft with no turn). */
  done: boolean;
}

export interface V2CommsLine {
  tick: number;
  from: string;
  fromName: string;
  team: Team;
  /** Talk (say, team), an agent's action (verb), the arena itself (supply drops), a plan change (mind), or your own live command (order). */
  channel: 'say' | 'team' | 'verb' | 'arena' | 'mind' | 'order';
  text: string;
  /** A rival's team message your agents overheard. */
  overheard: boolean;
  /** Your crew's message: the rival agents that overheard it. */
  overheardBy?: string[];
  /** verb lines: the verb's name, e.g. "Dig rubble". */
  verb?: string;
  /** A bluff and its target's answer: whether the target believed it (engine `bluff` event). */
  bluff?: 'landed' | 'doubted';
  /** The target's answer to a bluff (the line after it). */
  bluffReply?: true;
  /** mind lines: the agent's inner voice (its THINK line), not a plan change. */
  thought?: true;
  /** order lines: who the command went to ("Crew" or the agent's name). */
  orderTo?: string;
}

/** What a bluff's target answers (the prototype's lines). */
export const BLUFF_REPLY = { landed: 'Copy. Falling back.', doubted: 'Not buying it. Going to look.' } as const;

export interface V2MatchView {
  matchId: string;
  phase: V2Phase;
  team: Team;
  mapId: string;
  ranked: boolean;
  /** Practice against the greedy bot (v2_found `practice`). */
  practice: boolean;
  /** This crew holds and pays nothing (v2_found / v2_lockin `free`). */
  free: boolean;
  /** Spectating: built from whole-board frames; `team` is only the side drawn as the left crew. */
  watch: boolean;
  /** Casual difficulty from v2_found; null when the server did not say (ranked plays Normal). */
  difficulty: Difficulty | null;
  /** Wall time (ms) the accept / lock-in window closes. */
  acceptBy: number;
  lockBy: number | null;
  accepted: Team[];
  locked: Team[];
  rivalAgents: number | null;
  /** From v2_lockin: most agents this map takes, and each crew's hold with the crews as they stand. */
  crewLimit: number | null;
  headStartTicks: Record<Team, number> | null;
  rivalHandle: string | null;
  /** Ranked: both players' tiers from v2_found (the rival stays unnamed until the start). */
  tiers?: { you: PlayerTier; rival: PlayerTier } | null;
  tickMs: number;
  holdTicks: Record<Team, number> | null;
  frame: V2Frame | null;
  /** The frame before it (cards and the third person diff the two). */
  prevFrame: V2Frame | null;
  /** Wall time the latest frame arrived. */
  frameAt: number;
  comms: V2CommsLine[];
  /** Every say and team line this tab saw delivered, oldest first, not capped like `comms`. */
  said: V2CommsLine[];
  /** Every rival agent this crew has seen, as last seen (first-seen order). */
  rivals: FrameAgent[];
  /** The crew this tab queued (names and tiers), when the search started here. */
  crew: V2QueuedAgent[] | null;
  end: { result: MatchResult | null; reason: V2EndReason; logHash: string | null; debrief: V2Debrief | null } | null;
  /** Wall time v2_end arrived. */
  endAt: number | null;
  /** Every stored frame of the ended match (v2_frames, after sending v2_replay); null until asked. */
  replay: V2Frame[] | null;
  /** The last v2_command_ok: the tick the command lands on and how many are left. */
  commandAck: { tick: number; left: number } | null;
  /** Draft mode (v2_found `draft`): the ban phase; null outside draft mode. */
  draft: V2DraftView | null;
}

/** Most comms lines kept per match. */
export const MAX_COMMS = 200;

export function reduceV2(prev: V2MatchView | undefined, m: WsServerMessage, now: number): V2MatchView | undefined {
  if (m.type === 'v2_found')
    return {
      matchId: m.matchId,
      phase: 'found',
      team: m.team,
      mapId: m.mapId,
      ranked: m.ranked,
      practice: !!m.practice,
      free: !!m.free,
      watch: false,
      difficulty: m.difficulty ?? null,
      acceptBy: now + m.acceptMs,
      lockBy: null,
      accepted: [],
      locked: [],
      rivalAgents: null,
      crewLimit: null,
      headStartTicks: null,
      rivalHandle: m.rivalHandle ?? null,
      tiers: m.tiers ?? null,
      tickMs: 2000,
      holdTicks: null,
      frame: null,
      prevFrame: null,
      frameAt: 0,
      comms: [],
      said: [],
      rivals: [],
      crew: prev?.crew ?? null,
      end: null,
      endAt: null,
      replay: null,
      commandAck: null,
      draft: m.draft ? { turn: null, step: 0, steps: 0, by: null, pool: [], bans: [], done: false } : null,
      // A repeat (reconnect) keeps what was already known.
      ...(prev && prev.phase === 'found' ? { accepted: prev.accepted } : {}),
    };
  // A replay asked for from a tab that never saw the match: enough of a view to play it back.
  if (!prev && m.type === 'v2_frames' && m.frames.length) return replayView(m.matchId, m.frames);
  // A spectator's first frame, or a player's after a reload: a view from the frame alone.
  if (!prev && m.type === 'v2_frame') return frameView(m.matchId, m.frame, now);
  if (!prev || !('matchId' in m) || m.matchId !== prev.matchId) return prev;
  switch (m.type) {
    case 'v2_accepted':
      return prev.accepted.includes(m.team) ? prev : { ...prev, accepted: [...prev.accepted, m.team] };
    case 'v2_draft':
      return {
        ...prev,
        phase: prev.phase === 'found' ? 'draft' : prev.phase,
        draft: { turn: m.turn, step: m.step, steps: m.steps, by: m.turn ? now + m.stepMs : null, pool: m.pool, bans: m.bans, done: m.turn === null && m.bans.length >= m.steps },
      };
    case 'v2_lockin':
      return {
        ...prev,
        phase: prev.phase === 'found' || prev.phase === 'draft' ? 'lockin' : prev.phase,
        lockBy: now + m.lockMs,
        rivalAgents: m.rival.agents,
        crewLimit: m.crewLimit ?? prev.crewLimit,
        headStartTicks: m.headStartTicks ?? prev.headStartTicks,
        practice: prev.practice || !!m.practice,
        free: prev.free || !!m.free,
        rivalHandle: m.rivalHandle ?? prev.rivalHandle,
      };
    case 'v2_locked':
      return prev.locked.includes(m.team) ? prev : { ...prev, locked: [...prev.locked, m.team] };
    case 'v2_start':
      return { ...prev, phase: 'live', team: m.team, rivalHandle: m.rival.handle, tickMs: m.tickMs, holdTicks: m.holdTicks };
    case 'v2_frame': {
      // Only a player of the match gets its crew frames: this tab plays it, whatever it spectated.
      if (prev.watch && m.frame.view !== 'watch') return frameView(m.matchId, m.frame, now);
      if (!prev.watch && m.frame.view === 'watch') return prev;
      if (prev.frame && m.frame.tick <= prev.frame.tick) return prev;
      const lines = linesOf(m.frame, prev.frame);
      const said = [...ordersOf(m.frame, prev.frame), ...saidOf(m.frame)];
      return {
        ...prev,
        phase: prev.phase === 'ended' ? 'ended' : 'live',
        frame: m.frame,
        prevFrame: prev.frame,
        frameAt: now,
        comms: lines.length ? [...prev.comms, ...lines].slice(-MAX_COMMS) : prev.comms,
        said: said.length ? [...prev.said, ...said] : prev.said,
        rivals: rivalsSeen(prev.rivals, m.frame),
      };
    }
    case 'v2_end':
      return { ...prev, phase: 'ended', end: { result: m.result, reason: m.reason, logHash: m.logHash, debrief: m.debrief ?? null }, endAt: now };
    case 'v2_frames':
      return { ...prev, replay: m.frames };
    case 'v2_command_ok':
      return { ...prev, commandAck: { tick: m.tick, left: m.left } };
    default:
      return prev;
  }
}

/**
 * What one frame adds to the feed: its talk, the verbs, switches and supply drops it reported, and
 * a "mind" line for each of your agents whose plan changed since the last frame.
 */
export function linesOf(frame: V2Frame, prev: V2Frame | null): V2CommsLine[] {
  const tick = frame.tick;
  const out: V2CommsLine[] = [...ordersOf(frame, prev), ...frame.comms.map((c) => ({ ...c, tick }))];
  const def = mapV2(frame.mapId);
  const agent = (id: string) => frame.agents.find((a) => a.id === id);
  for (const e of frame.events) {
    if (e.kind === 'verb' || e.kind === 'switch') {
      const a = agent(e.agent);
      if (!a) continue;
      const name = e.kind === 'verb' ? (def?.verbs.find((v) => v.id === e.verb)?.name ?? e.verb) : e.name;
      out.push({ tick, from: a.id, fromName: a.name, team: a.team, channel: 'verb', text: name, verb: name, overheard: false });
    } else if (e.kind === 'supply_drop') {
      out.push({ tick, from: 'arena', fromName: 'Arena', team: 'A', channel: 'arena', text: `Supply drop is down. One ${(def?.item ?? 'item').toLowerCase()} in the middle.`, overheard: false });
    } else if (e.kind === 'bluff') {
      // Tag the lie itself, then the target's answer right after it.
      const bluff = e.believed ? 'landed' : 'doubted';
      const lie = out.findIndex((l) => l.from === e.agent && l.channel === 'say' && !l.bluff);
      if (lie >= 0) out[lie] = { ...out[lie]!, bluff };
      const v = agent(e.victim);
      if (v) out.splice(lie >= 0 ? lie + 1 : out.length, 0, { tick, from: v.id, fromName: v.name, team: v.team, channel: 'say', text: BLUFF_REPLY[bluff], overheard: false, bluff, bluffReply: true });
    }
  }
  if (frame.view !== 'watch')
    for (const a of frame.agents) {
      if (a.team !== frame.view || !a.plan) continue;
      if (prev?.agents.find((p) => p.id === a.id)?.plan === a.plan) continue;
      out.push({ tick, from: a.id, fromName: a.name, team: a.team, channel: 'mind', text: a.plan, overheard: false });
    }
  // A new inner-voice line from one of your agents: the Mind feed and its third-person subtitles.
  if (frame.view !== 'watch')
    for (const a of frame.agents) {
      if (a.team !== frame.view || !a.thought) continue;
      if (prev?.agents.find((p) => p.id === a.id)?.thought === a.thought) continue;
      out.push({ tick, from: a.id, fromName: a.name, team: a.team, channel: 'mind', text: a.thought, overheard: false, thought: true });
    }
  return out;
}

/** Your live commands this frame applied (new in its `commands` log since `prev`), as order lines. */
export function ordersOf(frame: V2Frame, prev: V2Frame | null): V2CommsLine[] {
  if (frame.view === 'watch' || !frame.commands) return [];
  const seen = prev?.commands?.log.length ?? 0;
  const own = frame.agents.filter((a) => a.team === frame.view);
  return frame.commands.log.slice(seen).map((c) => {
    const to = c.agents.length === 1 && own.length !== 1 ? (own.find((a) => a.id === c.agents[0])?.name ?? 'Agent') : 'Crew';
    return { tick: c.tick, from: 'you', fromName: 'You', team: frame.view as Team, channel: 'order', text: commandLabel(c), overheard: false, orderTo: to };
  });
}

/** The talk one frame carried (say and team lines), for the transcript. */
export function saidOf(frame: V2Frame): V2CommsLine[] {
  return frame.comms.map((c) => ({ ...c, tick: frame.tick }));
}

/** Rival agents seen so far, updated with the ones in this frame's sight. */
export function rivalsSeen(prev: FrameAgent[], frame: V2Frame): FrameAgent[] {
  if (frame.view === 'watch') return prev;
  const inSight = frame.agents.filter((a) => a.team !== frame.view);
  if (!inSight.length) return prev;
  const out = prev.map((a) => inSight.find((b) => b.id === a.id) ?? a);
  for (const a of inSight) if (!prev.some((b) => b.id === a.id)) out.push(a);
  return out;
}

/** A view known only from frames: their map and side, nothing from v2_found. */
function bareView(matchId: string, last: V2Frame): V2MatchView {
  return {
    matchId,
    phase: 'live',
    team: last.view === 'watch' ? 'A' : last.view,
    mapId: last.mapId,
    ranked: false,
    practice: false,
    free: false,
    watch: last.view === 'watch',
    difficulty: null,
    acceptBy: 0,
    lockBy: null,
    accepted: [],
    locked: [],
    rivalAgents: null,
    crewLimit: null,
    headStartTicks: null,
    rivalHandle: null,
    tickMs: 2000,
    holdTicks: last.holdTicks,
    frame: last,
    prevFrame: null,
    frameAt: 0,
    comms: [],
    said: [],
    rivals: [],
    crew: null,
    end: null,
    endAt: null,
    replay: null,
    commandAck: null,
    draft: null,
  };
}

/** An ended match known only from its stored frames (replay in a fresh tab). */
export function replayView(matchId: string, frames: V2Frame[]): V2MatchView {
  const last = frames[frames.length - 1]!;
  return {
    ...bareView(matchId, last),
    phase: 'ended',
    end: last.result ? { result: last.result, reason: last.result.reason, logHash: null, debrief: null } : null,
    said: frames.flatMap((f, i) => [...ordersOf(f, frames[i - 1] ?? null), ...saidOf(f)]),
    replay: frames,
  };
}

/** A live match first seen through one frame: spectating (a whole-board frame) or a player's resumed view. */
function frameView(matchId: string, frame: V2Frame, now: number): V2MatchView {
  return { ...bareView(matchId, frame), frame, frameAt: now, comms: linesOf(frame, null), said: [...ordersOf(frame, null), ...saidOf(frame)], rivals: rivalsSeen([], frame) };
}

type Listener = () => void;

export class V2Store {
  private readonly matches = new Map<string, V2MatchView>();
  private readonly listeners = new Set<Listener>();
  /** The match this tab was last found for (the hub opens it). */
  current: string | null = null;
  /** The crew of this tab's search, attached to the match it finds. */
  queued: V2QueuedAgent[] | null = null;

  apply(m: WsServerMessage, now = Date.now()): void {
    const id = 'matchId' in m ? m.matchId : null;
    if (!id || !m.type.startsWith('v2_')) return;
    let next = reduceV2(this.matches.get(id), m, now);
    if (next && m.type === 'v2_found' && !next.crew && this.queued) next = { ...next, crew: this.queued };
    if (!next || next === this.matches.get(id)) return;
    this.matches.set(id, next);
    if (m.type === 'v2_found') this.current = id;
    for (const l of [...this.listeners]) l();
  }

  get(matchId: string): V2MatchView | undefined {
    return this.matches.get(matchId);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  clear(): void {
    this.matches.clear();
    this.current = null;
  }
}

const stores = new WeakMap<Realtime, V2Store>();

/** The tab's v2 store for this Realtime client, fed from its first use on. */
export function v2StoreFor(rt: Realtime): V2Store {
  let s = stores.get(rt);
  if (!s) {
    const store = new V2Store();
    stores.set(rt, store);
    rt.onMessage((m) => store.apply(m));
    s = store;
  }
  return s;
}

/** One v2 match as this tab knows it (undefined until a v2 message for it arrives). Opens the socket. */
export function useV2Match(matchId: string | null): V2MatchView | undefined {
  const rt = useRealtime();
  const store = v2StoreFor(rt);
  useEffect(() => rt.connect(), [rt]);
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => (matchId ? store.get(matchId) : undefined),
    () => undefined,
  );
}
