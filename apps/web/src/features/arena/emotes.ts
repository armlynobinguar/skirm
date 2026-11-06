// Agent reactions: short emotes over agents (and in the comms feed) for the moments that make the
// AI's behaviour readable at a glance: fooled by a bluff ("?!" once it finds the item was there
// after all), a bluff that landed, winning or losing a race to a middle item or supply drop, a
// delivery, being knocked down, stunned or swept out, putting a fire out, and a teammate saving it.
//
// Everything is derived on the client from what the frame already carries (its events, its agents
// and its rows), so the engine log and its hash chain are untouched. A crew's frame is already
// fogged by the engine, and on top of that an emote only ever goes to an agent that is in the
// frame (in sight): a rival out of sight never gets one, and a rival's name only shows when that
// rival is in sight too.
//
// drawEmotes is the arena's single hook: it draws each live emote as a small team-coloured pill
// above the agent's name tag, stacked clear of name tags and speech bubbles, for EMOTE_MS.
import {
  BLUFF_AVOID_TICKS,
  mapV2,
  type FrameAgent,
  type Team,
  type V2Frame,
} from '@skirm/engine/v2';

export type EmoteKind =
  | 'fooled'
  | 'bluffed'
  | 'not_fooled'
  | 'won_race'
  | 'lost_race'
  | 'delivered'
  | 'knocked'
  | 'stunned'
  | 'out'
  | 'extinguished'
  | 'saved';

/** The glyph and short label each emote wears over the agent. */
export const EMOTE_LOOK: Readonly<Record<EmoteKind, { glyph: string; label: string }>> = {
  fooled: { glyph: '?!', label: 'Fooled' },
  bluffed: { glyph: ';)', label: 'Bluffed' },
  not_fooled: { glyph: '-_-', label: 'Not fooled' },
  won_race: { glyph: '!!', label: 'Got it' },
  lost_race: { glyph: ':(', label: 'Too late' },
  delivered: { glyph: '+1', label: 'Delivered' },
  knocked: { glyph: 'x_x', label: 'Knocked down' },
  stunned: { glyph: '@_@', label: 'Stunned' },
  out: { glyph: '×', label: 'Out' },
  extinguished: { glyph: '~*', label: 'Fire out' },
  saved: { glyph: '<3', label: 'Saved' },
};

/** When one agent has several in one tick, the strongest is the one it shows. */
const PRIORITY: Readonly<Record<EmoteKind, number>> = {
  out: 10,
  knocked: 9,
  fooled: 8,
  delivered: 7,
  won_race: 6,
  lost_race: 6,
  bluffed: 5,
  stunned: 5,
  saved: 4,
  extinguished: 3,
  not_fooled: 2,
};

export interface AgentEmote {
  kind: EmoteKind;
  agent: string;
  name: string;
  team: Team;
  tick: number;
  glyph: string;
  label: string;
  /** One plain line for the feed, e.g. "Fooled: the lamp oil was there all along". */
  text: string;
}

/** A bluff an agent believed that has not yet been found out (from the feed: the "Copy. Falling back." reply). */
export interface PendingBluff {
  victim: string;
  at: [number, number];
  tick: number;
}

/** Ticks past the bluff's avoid window a fooled agent can still find the item out. */
export const FOOLED_GRACE_TICKS = 8;
/** A rival within this many tiles (Manhattan) of a pickup was racing for it. */
export const RACE_RANGE = 2;
/** A teammate within this many tiles of a stunned rival or a doused fire was saved by it. */
export const SAVE_RANGE = 3;
/** How long an emote stays up over an agent (wall ms). */
export const EMOTE_MS = 2000;

const dist = (a: { x: number; y: number }, b: readonly [number, number]) =>
  Math.abs(a.x - b[0]) + Math.abs(a.y - b[1]);

const HAZARD_NAME: Record<string, string> = {
  water: 'the water',
  fire: 'the fire',
  lava: 'the lava',
  switch: 'a switch flood',
};

/** The structural bits of a feed line pendingBluffs reads (V2CommsLine fits). */
export interface EmoteHistoryLine {
  tick: number;
  from: string;
  channel: string;
  bluff?: 'landed' | 'doubted';
  bluffReply?: true;
  at?: [number, number];
  emote?: EmoteKind;
}

/**
 * Bluffs still waiting to be found out at `tick`: a landed bluff's reply line (it carries the tile)
 * from an earlier tick, still inside its window, with no "fooled" emote for that agent since.
 */
export function pendingBluffs(history: readonly EmoteHistoryLine[], tick: number): PendingBluff[] {
  const out: PendingBluff[] = [];
  for (const l of history) {
    if (!l.bluffReply || l.bluff !== 'landed' || !l.at || l.tick >= tick) continue;
    if (tick - l.tick > BLUFF_AVOID_TICKS + FOOLED_GRACE_TICKS) continue;
    if (history.some((h) => h.emote === 'fooled' && h.from === l.from && h.tick > l.tick)) continue;
    out.push({ victim: l.from, at: l.at, tick: l.tick });
  }
  return out;
}

/**
 * The emotes one frame shows, at most one per agent (the strongest). Only agents in the frame (in
 * this side's sight) get one; `pending` comes from pendingBluffs.
 */
export function emotesOf(
  frame: V2Frame,
  prev: V2Frame | null,
  pending: readonly PendingBluff[] = [],
): AgentEmote[] {
  const tick = frame.tick;
  const seen = new Map<string, FrameAgent>(frame.agents.map((a) => [a.id, a]));
  const item = (mapV2(frame.mapId)?.item ?? 'item').toLowerCase();
  const nameOf = (id: string, fallback: string) => seen.get(id)?.name ?? fallback;
  const up = (a: FrameAgent) => !a.out && !a.down;
  const got: AgentEmote[] = [];
  const add = (id: string, kind: EmoteKind, text: string, glyph?: string) => {
    const a = seen.get(id);
    if (!a) return; // out of sight: never an emote
    const look = EMOTE_LOOK[kind];
    got.push({
      kind,
      agent: a.id,
      name: a.name,
      team: a.team,
      tick,
      glyph: glyph ?? look.glyph,
      label: look.label,
      text,
    });
  };
  /** Teammates of `by` (not `by` itself) in sight, up, within SAVE_RANGE of `at`. */
  const savedNear = (by: FrameAgent, at: readonly [number, number]) =>
    frame.agents.filter(
      (a) => a.team === by.team && a.id !== by.id && up(a) && dist(a, at) <= SAVE_RANGE,
    );

  for (const e of frame.events) {
    switch (e.kind) {
      case 'delivered':
        add(
          e.agent,
          'delivered',
          `Delivered ${e.count > 1 ? `${e.count} items` : `the ${item}`}`,
          `+${e.count}`,
        );
        break;
      case 'knocked_down':
        add(
          e.agent,
          'knocked',
          `Knocked down by ${HAZARD_NAME[e.by] ?? e.by}${e.dropped ? `, dropped ${e.dropped}` : ''}`,
        );
        break;
      case 'eliminated':
        add(e.agent, 'out', `Swept out by ${HAZARD_NAME[e.by] ?? e.by}`);
        break;
      case 'shocked':
        add(e.agent, 'stunned', `Shocked by the ${e.by}`);
        break;
      case 'stunned': {
        add(e.agent, 'stunned', `Stunned by ${nameOf(e.by, 'a rival')}`);
        const by = seen.get(e.by);
        const victim = seen.get(e.agent);
        if (by && victim)
          for (const t of savedNear(by, [victim.x, victim.y]))
            add(t.id, 'saved', `Saved by ${by.name}: ${victim.name} stunned`);
        break;
      }
      case 'verb': {
        if (e.effect !== 'extinguish') break;
        add(e.agent, 'extinguished', 'Put the fire out');
        const by = seen.get(e.agent);
        if (by)
          for (const t of savedNear(by, e.at))
            add(t.id, 'saved', `Saved by ${by.name}: the fire is out`);
        break;
      }
      case 'picked': {
        if (e.origin !== 'middle' && e.origin !== 'drop') break;
        const winner = seen.get(e.agent);
        if (!winner) break;
        const near = (a: { x: number; y: number } | undefined) =>
          !!a && dist(a, e.at) <= RACE_RANGE;
        const losers = frame.agents.filter(
          (a) =>
            a.team !== winner.team &&
            up(a) &&
            (near(a) || near(prev?.agents.find((p) => p.id === a.id))),
        );
        if (!losers.length) break;
        const what = e.origin === 'drop' ? 'supply drop' : `middle ${item}`;
        add(winner.id, 'won_race', `Won the race to the ${what}`);
        for (const l of losers) add(l.id, 'lost_race', `Lost the ${what} to ${winner.name}`);
        break;
      }
      case 'bluff':
        if (e.believed) add(e.agent, 'bluffed', `Bluff landed on ${nameOf(e.victim, 'a rival')}`);
        else
          add(
            e.victim,
            'not_fooled',
            `Saw through ${seen.has(e.agent) ? `${nameOf(e.agent, '')}'s bluff` : 'a bluff'}`,
          );
        break;
      default:
        break;
    }
  }

  // A fooled agent finds out: the item it was told was gone is picked up, or still lies there once the lie wears off.
  for (const p of pending) {
    if (tick <= p.tick) continue;
    const [x, y] = p.at;
    const takenNow = frame.events.some(
      (e) => e.kind === 'picked' && e.at[0] === x && e.at[1] === y,
    );
    const stillThere = tick - p.tick >= BLUFF_AVOID_TICKS && frame.rows[y]?.[x] === '*';
    if (takenNow || stillThere) add(p.victim, 'fooled', `Fooled: the ${item} was there all along`);
  }

  // One per agent: the strongest (the first of equals).
  const best = new Map<string, AgentEmote>();
  for (const em of got) {
    const had = best.get(em.agent);
    if (!had || PRIORITY[em.kind] > PRIORITY[had.kind]) best.set(em.agent, em);
  }
  return got.filter((em) => best.get(em.agent) === em);
}

// --- The arena layer -------------------------------------------------------------------------------

/** An emote as the arena draws it. */
export interface LiveEmote {
  /** Stable for the emote: `<tick>|<agent>|<kind>`. */
  id: string;
  agent: string;
  team: Team;
  tick: number;
  glyph: string;
  label: string;
}

/** The feed's emote lines of the last `span` ticks up to `tick`, as the arena's emotes. */
export function liveEmotesOf(
  lines: readonly {
    tick: number;
    from: string;
    team: Team;
    channel: string;
    emote?: EmoteKind;
    glyph?: string;
  }[],
  tick: number,
  span = 2,
): LiveEmote[] {
  const out: LiveEmote[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.tick <= tick - span) break;
    if (l.channel !== 'emote' || !l.emote || l.tick > tick) continue;
    const look = EMOTE_LOOK[l.emote];
    out.push({
      id: `${l.tick}|${l.from}|${l.emote}`,
      agent: l.from,
      team: l.team,
      tick: l.tick,
      glyph: l.glyph ?? look.glyph,
      label: look.label,
    });
  }
  return out.reverse();
}

/** What the arena hands the hook: where it drew each agent this frame. */
export interface DrawnItem {
  agent?: { id: string; name: string; team: string; out?: boolean };
  sx?: number;
  sy?: number;
  hop?: number;
  af?: number;
}

export interface EmoteDrawOpts {
  /** The arena tile size and board origin (to place an agent that was not drawn, e.g. knocked down). */
  T: number;
  ox: number;
  oy: number;
  /** Wall ms now. */
  now: number;
  /** Reduced motion: no pop or rise, and only this frame's emotes (nothing animates them away). */
  still: boolean;
  /** Rectangles already taken this frame ([x0, y0, x1, y1]): the speech bubbles. */
  placed?: number[][];
}

/** First time (wall ms) the arena drew each emote, so each stays up EMOTE_MS from when it appeared. */
const firstSeen = new Map<string, number>();

/** The emote's opacity, pop scale and rise at `now`; null once it is over. */
export function emoteAnim(
  age: number,
  still: boolean,
): { alpha: number; scale: number; rise: number } | null {
  if (still) return { alpha: 1, scale: 1, rise: 0 };
  if (age < 0 || age >= EMOTE_MS) return null;
  const t = age / EMOTE_MS;
  const alpha = Math.min(1, age / 120, (EMOTE_MS - age) / 300);
  const pop = Math.min(1, age / 180);
  const scale = 0.6 + 0.4 * pop + 0.12 * Math.sin(Math.PI * pop);
  return { alpha, scale, rise: t * 6 };
}

const TEAM_COL: Record<string, string> = { A: '#34e0c8', B: '#ff4655' };

const overlaps = (r: number[], q: number[]) =>
  r[0]! < q[2]! && r[2]! > q[0]! && r[1]! < q[3]! && r[3]! > q[1]!;

/**
 * The arena's emote hook: each live emote as a pill over its agent, above the name tag and clear of
 * the speech bubbles. Rivals only where this crew can see them (the arena's fog), never out of sight.
 */
export function drawEmotes(
  c: CanvasRenderingContext2D,
  /** renderArena's return: its draw list (tiles and agents; only the agents are read). */
  items: readonly object[] | null | undefined,
  arena: {
    emotes?: LiveEmote[] | null;
    tick?: number;
    team?: Team;
    vis?: boolean[] | null;
    A: { w: number };
    state: { agents: { id: string; name: string; team: string; x: number; y: number }[] };
  },
  o: EmoteDrawOpts,
): void {
  const list = arena.emotes;
  for (const [k, t] of firstSeen) if (o.now - t > EMOTE_MS * 4) firstSeen.delete(k);
  if (!list?.length) return;
  const { T } = o;
  const fs = Math.max(10, T * 0.2);
  const bf = Math.max(11, T * 0.2);
  const slab = T * 0.13;
  const placed = o.placed ?? [];
  // Name tags take room too (the arena draws them at the same spot: see renderArena's tags).
  const drawn = new Map<string, DrawnItem>();
  c.font = `600 ${fs}px Barlow, sans-serif`;
  const tags: number[][] = [];
  for (const it of (items ?? []) as readonly DrawnItem[]) {
    if (!it.agent || it.sx == null || it.sy == null) continue;
    drawn.set(it.agent.id, it);
    if (it.agent.out) continue;
    const tw = c.measureText(it.agent.name).width + fs * 0.8;
    const ty = it.sy - (it.hop ?? 0) - T * 1.05;
    tags.push([it.sx - tw / 2, ty - fs, it.sx + tw / 2, ty + fs * 0.35]);
  }
  const taken = [...placed, ...tags];
  const stack = new Map<string, number>();
  const w = arena.A.w;
  for (const em of list) {
    if (o.still && em.tick !== arena.tick) continue;
    const at = firstSeen.get(em.id) ?? o.now;
    if (!firstSeen.has(em.id)) firstSeen.set(em.id, at);
    const anim = emoteAnim(o.now - at, o.still);
    if (!anim) continue;
    const a = arena.state.agents.find((g) => g.id === em.agent);
    if (!a) continue; // left this side's sight
    const rival = arena.team ? a.team !== arena.team : false;
    if (rival && arena.vis && !arena.vis[a.y * w + a.x]) continue;
    const it = drawn.get(a.id);
    const sx = it?.sx ?? o.ox + ((a.x - a.y) * T) / 2;
    const base = it?.sy != null ? it.sy - (it.hop ?? 0) : o.oy + ((a.x + a.y) * T) / 4 - slab;
    const fade = it?.af ?? 1;
    // The pill: glyph in the team colour, then the label.
    const gf = bf * 1.05 * anim.scale;
    const lf = bf * 0.6 * anim.scale;
    c.font = `800 ${gf}px Barlow, sans-serif`;
    const gw = c.measureText(em.glyph).width;
    c.font = `600 ${lf}px "JetBrains Mono", monospace`;
    const label = em.label.toUpperCase();
    const lw = c.measureText(label).width;
    const pad = bf * 0.45;
    const bw = gw + lw + pad * 3;
    const bh = bf * 1.5 * anim.scale;
    const n = stack.get(a.id) ?? 0;
    stack.set(a.id, n + 1);
    let top = base - T * 1.05 - fs - bh - 6 - anim.rise - n * (bh + 3);
    let r = [sx - bw / 2, top, sx + bw / 2, top + bh];
    for (let k = 0; k < 8 && taken.some((q) => overlaps(r, q)); k++) {
      top -= bh * 0.5 + 2;
      r = [sx - bw / 2, top, sx + bw / 2, top + bh];
    }
    taken.push(r);
    const col = TEAM_COL[em.team] ?? '#ece8e1';
    c.globalAlpha = anim.alpha * fade;
    c.fillStyle = 'rgba(5,8,13,.92)';
    c.beginPath();
    roundRect(c, r[0]!, r[1]!, bw, bh, bh / 2);
    c.fill();
    c.strokeStyle = col;
    c.lineWidth = 1.5;
    c.stroke();
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.font = `800 ${gf}px Barlow, sans-serif`;
    c.fillText(em.glyph, r[0]! + pad, top + bh / 2);
    c.fillStyle = '#ece8e1';
    c.font = `600 ${lf}px "JetBrains Mono", monospace`;
    c.fillText(label, r[0]! + pad * 2 + gw, top + bh / 2);
    c.textBaseline = 'alphabetic';
    c.textAlign = 'start';
    c.globalAlpha = 1;
  }
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const k = Math.min(r, w / 2, h / 2);
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}
