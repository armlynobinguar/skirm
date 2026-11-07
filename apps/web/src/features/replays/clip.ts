// The debrief's highlight clip, the pure part: which single moment of the match to play, the ticks
// around it, and how long each frame shows so the loop runs about CLIP_MS.
//
// Candidates are the api's public highlights (goal, switch flood, drop fight, lead change) plus a
// few moments read off the frames this viewer was sent: a bluff that landed, a steal, a decoy that
// sprang. A player's frames are their own crew's view, so a bluff only shows up when one of their
// agents told it or was told it (the server filters the rest), and a decoy only when it was their
// own. A spectator's whole-board frames add steals only: bluffs and decoys stay with the crews.
import type { ReplayHighlight } from '@/lib/api/types';
import type { V2Frame } from '@/lib/realtime/protocol';

type Team = 'A' | 'B';

export type ClipKind = ReplayHighlight['kind'] | 'bluff' | 'steal' | 'decoy';

export interface ClipMoment {
  id: string;
  kind: ClipKind;
  tick: number;
  /** The crew the moment favours (null when neither). */
  team: Team | null;
  /** The kicker before the dot: "Bluff", "Winning delivery". */
  label: string;
  /** After the dot: "Moth fooled Vex". */
  caption: string;
  /** A line under it: the caster's line for an api highlight, the plain facts otherwise. */
  line: string;
  weight: number;
  /** The agent the camera should find, when known. */
  agent?: string;
  /** The tile the camera should find when no agent is known. */
  at?: readonly [number, number];
}

/** The loop's length, wall time. */
export const CLIP_MS = 6000;
/** Ticks of build-up before the moment and follow-through after it. */
export const CLIP_LEAD = 5;
export const CLIP_TAIL = 3;
/** The moment's own frame lingers this much longer (the beat). */
export const CLIP_BEAT_MS = 700;
/** The last frame holds this long before the loop starts over. */
export const CLIP_HOLD_MS = 900;
/** A frame shows at least / at most this long. */
const MIN_FRAME_MS = 280;
const MAX_FRAME_MS = 1100;

const sorted = (frames: readonly V2Frame[]) => frames.slice().sort((a, b) => a.tick - b.tick);

const LABEL: Record<ReplayHighlight['kind'], string> = {
  goal: 'Delivery',
  switch_flood: 'Flood',
  drop_fight: 'Drop fight',
  lead_change: 'Lead change',
};

/** An api highlight as a clip moment: "Winning delivery · Rook delivers the goal". */
export function momentOfHighlight(h: ReplayHighlight): ClipMoment {
  const comeback = h.kind === 'lead_change' && /^comeback:\s*/i.test(h.title);
  const label = comeback ? 'Comeback' : h.kind === 'goal' && /the goal$/i.test(h.title) ? 'Winning delivery' : LABEL[h.kind];
  return {
    id: h.id,
    kind: h.kind,
    tick: h.tick,
    team: h.team,
    label,
    caption: h.title.replace(/^comeback:\s*/i, ''),
    line: h.line || h.facts,
    weight: h.weight,
  };
}

export interface FrameMomentOptions {
  /** Crew names (the players' handles). */
  crews?: Partial<Record<Team, string | null>>;
}

/** Bluffs that landed, steals and sprung decoys in the frames this viewer was sent, oldest first. */
export function momentsOfFrames(frames: readonly V2Frame[], opts: FrameMomentOptions = {}): ClipMoment[] {
  const fs = sorted(frames);
  const names = new Map<string, { name: string; team: Team }>();
  for (const f of fs) for (const a of f.agents) if (!names.has(a.id)) names.set(a.id, { name: a.name, team: a.team });
  const nameOf = (id: string, fallback: string) => names.get(id)?.name ?? fallback;
  const teamOf = (id: string) => names.get(id)?.team ?? null;
  const crew = (t: Team) => opts.crews?.[t] || `Crew ${t}`;
  const out: ClipMoment[] = [];
  for (const f of fs) {
    const own = f.view === 'watch' ? null : f.view;
    for (const e of f.events) {
      if (e.kind === 'bluff' && e.believed && own) {
        // Only a crew's own frames carry a bluff, and only one its agents told or heard.
        const liarTeam = teamOf(e.agent);
        const ours = liarTeam === own;
        const liar = nameOf(e.agent, ours ? 'Your agent' : 'A rival');
        const victim = nameOf(e.victim, ours ? 'a rival' : 'your agent');
        out.push({
          id: `bluff-${f.tick}-${e.agent}`,
          kind: 'bluff',
          tick: f.tick,
          team: liarTeam,
          label: 'Bluff',
          caption: `${liar} fooled ${victim}`,
          line: ours ? `${liar} sold ${victim} a lie, and it landed.` : `${liar} talked ${victim} out of a sure thing.`,
          weight: ours ? 8 : 5,
          agent: e.agent,
          at: e.at,
        });
      } else if (e.kind === 'picked' && e.stolen) {
        const t = teamOf(e.agent);
        const who = nameOf(e.agent, 'An agent');
        const from = t ? crew(t === 'A' ? 'B' : 'A') : 'the rival';
        out.push({
          id: `steal-${f.tick}-${e.agent}`,
          kind: 'steal',
          tick: f.tick,
          team: t,
          label: 'Steal',
          caption: `${who} robs ${from}`,
          line: `${who} lifts an item right out of ${from}'s stash.`,
          weight: own && t !== own ? 5 : 7,
          agent: e.agent,
          at: e.at,
        });
      } else if (e.kind === 'decoy_sprung' && own && e.team === own) {
        const who = nameOf(e.agent, 'a rival');
        out.push({
          id: `decoy-${f.tick}-${e.agent}`,
          kind: 'decoy',
          tick: f.tick,
          team: e.team,
          label: 'Decoy',
          caption: `${who} took the bait`,
          line: `${who} reached for ${crew(e.team)}'s decoy and it went off.`,
          weight: 7,
          agent: e.agent,
          at: e.at,
        });
      }
    }
  }
  return out;
}

export interface PickOptions extends FrameMomentOptions {
  /** The viewer's crew: on a tie, its moment wins. */
  team?: Team | null;
}

/**
 * The single best moment to clip: the heaviest of the api's highlights and the frames' own moments
 * that fall inside the frames this viewer has. Ties go to the viewer's crew, then the later moment.
 * Null when there is nothing worth a clip (or no frames).
 */
export function pickClipMoment(highlights: readonly ReplayHighlight[], frames: readonly V2Frame[], opts: PickOptions = {}): ClipMoment | null {
  if (!frames.length) return null;
  const fs = sorted(frames);
  const first = fs[0]!.tick;
  const last = fs[fs.length - 1]!.tick;
  const all = [...highlights.map(momentOfHighlight), ...momentsOfFrames(fs, opts)].filter((m) => m.tick >= first && m.tick <= last);
  if (!all.length) return null;
  const mine = (m: ClipMoment) => (opts.team && m.team === opts.team ? 1 : 0);
  all.sort((a, b) => b.weight - a.weight || mine(b) - mine(a) || b.tick - a.tick);
  return all[0]!;
}

export interface ClipWindow {
  /** Index into the tick-sorted frames of the first and last frame played. */
  from: number;
  to: number;
  /** Index of the moment's frame. */
  moment: number;
}

/**
 * The frames around a moment: CLIP_LEAD ticks before, CLIP_TAIL after, clamped to the match; when
 * the moment sits near an end, the window slides so it still spans lead + tail + 1 frames where it can.
 * `frames` must be sorted by tick.
 */
export function clipWindow(frames: readonly Pick<V2Frame, 'tick'>[], tick: number, lead = CLIP_LEAD, tail = CLIP_TAIL): ClipWindow | null {
  if (!frames.length) return null;
  let moment = frames.findIndex((f) => f.tick >= tick);
  if (moment < 0) moment = frames.length - 1;
  const span = lead + tail + 1;
  let from = Math.max(0, moment - lead);
  let to = Math.min(frames.length - 1, moment + tail);
  // Slide toward the side with room so the clip keeps its length.
  if (to - from + 1 < span) {
    if (from === 0) to = Math.min(frames.length - 1, from + span - 1);
    else if (to === frames.length - 1) from = Math.max(0, to - span + 1);
  }
  return { from, to, moment };
}

/**
 * How long each of `count` frames shows (ms), the moment's frame with its beat and the last with the
 * hold, so one pass takes about `total` ms (each frame clamped to a readable pace).
 */
export function clipDurations(count: number, momentAt: number, total = CLIP_MS): number[] {
  if (count <= 0) return [];
  const extra = CLIP_BEAT_MS + CLIP_HOLD_MS;
  const base = Math.round(Math.min(MAX_FRAME_MS, Math.max(MIN_FRAME_MS, (total - extra) / count)));
  return Array.from({ length: count }, (_, i) => base + (i === momentAt ? CLIP_BEAT_MS : 0) + (i === count - 1 ? CLIP_HOLD_MS : 0));
}

/** "Bluff · Moth fooled Vex". */
export const clipCaption = (m: Pick<ClipMoment, 'label' | 'caption'>) => `${m.label} · ${m.caption}`;

/**
 * Where the camera looks on the moment's frame: the moment's agent when this view shows it, else
 * the agents named in that frame's events, else the moment's tile, else the live agents' middle.
 */
export function clipFocus(frame: Pick<V2Frame, 'agents' | 'events'>, m: Pick<ClipMoment, 'agent' | 'at'>): { x: number; y: number } | null {
  const pos = new Map(frame.agents.filter((a) => !a.out).map((a) => [a.id, a] as const));
  const a = m.agent ? pos.get(m.agent) : undefined;
  if (a) return { x: a.x, y: a.y };
  const named = frame.events.flatMap((e) => ('agent' in e && typeof e.agent === 'string' && pos.has(e.agent) ? [pos.get(e.agent)!] : []));
  const pick = named.length ? named : m.at ? [] : [...pos.values()];
  if (!pick.length) return m.at ? { x: m.at[0], y: m.at[1] } : null;
  return { x: pick.reduce((n, p) => n + p.x, 0) / pick.length, y: pick.reduce((n, p) => n + p.y, 0) / pick.length };
}
