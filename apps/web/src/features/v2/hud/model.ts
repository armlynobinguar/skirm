// The live match HUD's numbers and words, worked out from frames (no React here, so it is tested on
// its own): the clock line, callouts, inventory changes, the comms filter and the third person's
// subtitles. Copy and colours follow the prototype's hud(), flushLog(), floatInv() and pushSub().
import { DIFF_MODS, goalFor, mapV2, type Difficulty, type FrameAgent, type FrameItem, type ItemOrigin, type MapDefV2, type Team, type V2Frame } from '@skirm/engine/v2';
import { TOOL_INFO } from '@/features/arena/gear';
import type { V2CommsLine } from '../v2Store';

/** The goal item's icon per map, a 24×24 stroke path (the prototype's ITEM_ICON). */
export const ITEM_ICON: Readonly<Record<string, string>> = {
  'saltmarsh-weir': 'M9 3h6v3l2 2v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8l2-2zM9 6h6M17 10h2a2 2 0 0 1 0 4h-2',
  'ashfall-orchard': 'M6 3h12v18H6zM6 7h12M12 11c-2 1-2 4 0 5 2-1 2-4 0-5z',
  'frostline-depot': 'M5 6h14v12H5zM9 9c1 1 1 2 0 3s-1 2 0 3M13 9c1 1 1 2 0 3s-1 2 0 3',
  'glasshouse-ruins': 'M9 3h6M10 3v13a2 2 0 0 0 4 0V3M10 11h4',
  'copper-hollow': 'M9 5h6M12 2v3M8 8h8l-1 10H9zM7 21h10M10 12h4',
  'dust-bowl-silos': 'M6 6c0-1.5 12-1.5 12 0v12c0 1.5-12 1.5-12 0zM6 6c0 1.5 12 1.5 12 0M6 12c0 1.5 12 1.5 12 0',
  'monsoon-terraces': 'M9 4h6l-2 3c4 2 5 6 4 10-1 3-10 3-11 0-1-4 0-8 4-10zM10 7h4',
  'sunken-metro': 'M4 8h16v11H4zM9 8V5h6v3M12 11v5M9.5 13.5h5',
  'basalt-stair': 'M4 9c0-3 16-3 16 0v3c0 5-4 7-8 7s-8-2-8-7zM8 12h2M14 12h2M9 16h6',
  'blackout-harbor': 'M9 21l4-12M13 6l1-3M16 8l3-1M9 7 7 5M13 9l3 1',
};

export function itemIconOf(mapId: string): string {
  return ITEM_ICON[mapId] ?? ITEM_ICON['copper-hollow']!;
}

/** Where a carried item came from: the slot's stripe colour and its label. */
export const ORIGIN: Readonly<Record<ItemOrigin, { label: string; colour: string }>> = {
  own: { label: 'Own half', colour: 'var(--you)' },
  middle: { label: 'Middle', colour: 'var(--amber)' },
  drop: { label: 'Supply drop', colour: 'var(--violet)' },
  stolen: { label: 'Stolen', colour: 'var(--rival)' },
  recovered: { label: 'Recovered', colour: 'var(--you)' },
};

/** The map's goal item, plural when n is not 1 ("lamp oil" → "lamps", as the prototype says it). */
const PLURAL: Readonly<Record<string, string>> = { 'Lamp oil': 'lamps' };
export function plural(item: string, n: number): string {
  return n === 1 ? item.toLowerCase() : (PLURAL[item] ?? `${item.toLowerCase()}s`);
}

/** m:ss for a number of seconds. */
export function clock(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function difficultyOf(d: Difficulty | null | undefined): Difficulty {
  return d ?? 'normal';
}

/** The match's clock line: hazards rising or receding, switches ready, the next supply drop and the head start. */
export interface ClockLine {
  /** Whole seconds left on the clock. */
  left: number;
  hazards: { kind: string; receding: boolean; nextIn: number }[];
  switches: { ready: number | null; total: number } | null;
  /** Seconds until the next supply drop, null when none is left. */
  dropIn: number | null;
  /** Seconds this crew still waits at the start (the rival's head start). */
  holding: number;
}

export function clockLine(frame: V2Frame, team: Team, difficulty: Difficulty, tickMs: number): ClockLine {
  const def = mapV2(frame.mapId);
  const secs = (ticks: number) => Math.ceil((ticks * tickMs) / 1000);
  const tick = frame.tick;
  const scale = DIFF_MODS[difficulty].hazardScale;
  const hazards = (def?.hazards ?? []).map((h) => {
    const every = Math.max(1, Math.round(h.every * scale));
    const live = frame.hazards?.find((x) => x.kind === h.kind);
    return { kind: hazardName(def, h.kind), receding: live?.receding ?? false, nextIn: secs(every - (tick % every)) };
  });
  const total = def?.switches.length ?? 0;
  const ready = frame.switchReady ? frame.switchReady.filter((t) => t <= tick).length : null;
  const next = def?.drops.find((d) => tick < d.tick);
  return {
    left: secs(frame.limit - tick),
    hazards,
    switches: total ? { ready, total } : null,
    dropIn: next ? secs(next.tick - tick) : null,
    holding: Math.max(0, secs((frame.holdTicks[team] ?? 0) - tick)),
  };
}

const HAZARD_NAME: Readonly<Record<string, string>> = { water: 'Flood', fire: 'Fire', lava: 'Lava' };
function hazardName(def: MapDefV2 | undefined, kind: string): string {
  if (def?.id === 'saltmarsh-weir' || (def?.id === 'blackout-harbor' && kind === 'water')) return 'Tide';
  return HAZARD_NAME[kind] ?? kind;
}

/** A map's gas, ice or live water, for the HUD's legend: a swatch, a short name and a tooltip. */
export interface FieldHazard {
  key: 'gas' | 'ice' | 'shock';
  name: string;
  /** What it does, in one line (the tooltip). */
  hint: string;
  /** Gas: in sight now. Shock: a cable is live now. Ice is always shown. */
  live: boolean;
}

/** The legend for a map's gas vents, ice patches and sparking cables (none on most maps). */
export function fieldHazards(frame: V2Frame): FieldHazard[] {
  const def = mapV2(frame.mapId);
  const out: FieldHazard[] = [];
  if (def?.ice?.length) out.push({ key: 'ice', name: 'Ice', hint: 'Stepping onto ice slides you one more tile the same way, unless that tile is blocked.', live: true });
  if (def?.gas?.length)
    out.push({ key: 'gas', name: 'Gas', hint: 'Vents puff a green cloud that drifts and thins. Inside it an agent loses every other action.', live: !!frame.gas?.length });
  if (def?.sparks?.length)
    out.push({
      key: 'shock',
      name: 'Live water',
      hint: `${def.sparks.map((s) => s.name).join(' and ')} electrify the water they touch now and then. On or next to live water an agent is stunned for 2 ticks.`,
      live: !!frame.shock?.length,
    });
  return out;
}

/** The difficulty's goal as the clock's tag shows it. */
export function goalTag(mapId: string, difficulty: Difficulty): { name: string; colour: string; title: string; text: string } {
  const g = goalFor(mapId, difficulty);
  const d = DIFF_MODS[difficulty];
  return { name: d.name, colour: d.colour, title: g.title, text: g.text };
}

/** A big moment of this tick, for the banner under the clock (the prototype's M.callout). */
export interface Callout {
  text: string;
  side: 'you' | 'rival' | 'arena';
}

export function calloutOf(frame: V2Frame, team: Team): Callout | null {
  const def = mapV2(frame.mapId);
  const item = (def?.item ?? 'item').toLowerCase();
  const mid = def ? def.exit[0] : -1;
  const agent = (id: string) => frame.agents.find((a) => a.id === id);
  const side = (t: Team) => (t === team ? 'you' : 'rival');
  let out: Callout | null = null;
  for (const e of frame.events) {
    if (e.kind === 'supply_drop') out = { text: 'Supply drop · middle', side: 'arena' };
    else if (e.kind === 'sparked') out = { text: `${e.name} · the water is live`, side: 'arena' };
    else if (e.kind === 'shocked') {
      const a = agent(e.agent);
      if (a) out = { text: `${a.name} shocked by live water`, side: side(a.team) };
    }
    else if (e.kind === 'tool_dropped') out = { text: `Supply drop · ${TOOL_INFO[e.tool].name.toLowerCase()} inside`, side: 'arena' };
    else if (e.kind === 'tool_used' || e.kind === 'tool_picked') {
      const a = agent(e.agent);
      if (!a) continue;
      const name = TOOL_INFO[e.tool].name.toLowerCase();
      out = { text: e.kind === 'tool_used' ? `${a.name} placed the ${name}` : `${a.name} took the ${name}`, side: side(a.team) };
    }
    else if (e.kind === 'verb' || e.kind === 'switch') {
      const a = agent(e.agent);
      if (!a) continue;
      const name = e.kind === 'verb' ? (def?.verbs.find((v) => v.id === e.verb)?.name ?? e.verb) : e.name;
      out = { text: `${a.name} · ${name}`, side: side(a.team) };
    } else if (e.kind === 'picked') {
      const a = agent(e.agent);
      if (!a) continue;
      if (e.stolen) out = { text: `${a.name} stole a dropped ${item}`, side: side(a.team) };
      else if (e.at[0] === mid) out = { text: `${a.name} took a middle ${item}`, side: side(a.team) };
    } else if (e.kind === 'bluff') {
      // Either agent may be out of sight: the crew still heard the lie or told it.
      const liar = agent(e.agent);
      const victim = agent(e.victim);
      const liarTeam: Team = liar?.team ?? (victim ? (victim.team === 'A' ? 'B' : 'A') : team);
      const liarName = liar?.name ?? 'A rival';
      if (e.believed) out = { text: `${liarName}'s bluff landed`, side: side(liarTeam) };
      else if (victim) out = { text: `${victim.name} saw through ${liarName}'s bluff`, side: side(victim.team) };
    }
  }
  return out;
}

/** What changed in an agent's hands since the last frame: picked up, delivered or dropped. */
export interface InvChange {
  kind: 'picked' | 'delivered' | 'dropped';
  n: number;
}

export function invChange(prev: FrameAgent | undefined, next: FrameAgent): InvChange | null {
  if (!prev) return null;
  const a = prev.items.length;
  const b = next.items.length;
  if (b > a) return { kind: 'picked', n: b - a };
  if (b < a) {
    const dl = next.delivered - prev.delivered;
    return dl > 0 ? { kind: 'delivered', n: dl } : { kind: 'dropped', n: a - b };
  }
  return null;
}

/** One inventory slot as the cards and the third person draw it. */
export type Slot = { state: 'unknown' } | { state: 'empty'; n: number } | { state: 'full'; item: FrameItem; fresh: boolean };

/** Carry slots of an agent: 2 (a Hauler 3); `known` false shows "?" (a rival out of sight). */
export function slotsOf(agent: FrameAgent | null, slots: number, known: boolean, tick: number): Slot[] {
  return Array.from({ length: slots }, (_, i): Slot => {
    if (!known || !agent) return { state: 'unknown' };
    const item = agent.items[i];
    return item ? { state: 'full', item, fresh: item.tick === tick } : { state: 'empty', n: i + 1 };
  });
}

/** Comms filter: everything (not plans), team talk, say and actions, overheard rival talk, or plans. */
export type FeedFilter = 'all' | 'team' | 'say' | 'heard' | 'mind';

/** The tag a feed line wears. */
export type FeedTag = 'team' | 'rteam' | 'say' | 'heard' | 'verb' | 'arena' | 'mind' | 'order' | 'emote';

export function feedTag(line: V2CommsLine, team: Team): FeedTag {
  if (line.channel === 'team') return line.overheard ? 'heard' : line.team === team ? 'team' : 'rteam';
  return line.channel;
}

export function inFilter(line: V2CommsLine, team: Team, filter: FeedFilter): boolean {
  const tag = feedTag(line, team);
  switch (filter) {
    case 'all':
      return tag !== 'mind';
    case 'team':
      return tag === 'team' || tag === 'rteam' || tag === 'order';
    case 'say':
      return tag === 'say' || tag === 'verb' || tag === 'arena' || tag === 'emote';
    case 'heard':
      return tag === 'heard';
    case 'mind':
      return tag === 'mind';
  }
}

/** A subtitle in third person: what the watched agent thinks, does, says and hears. */
export interface Sub {
  kind: 'think' | 'verb' | 'arena' | 'say' | 'heard';
  who: string;
  team: Team | null;
  /** say and heard: team, say or overheard. */
  ch?: 'team' | 'say' | 'overheard';
  text: string;
  /** Seconds it stays up (longer lines stay longer). */
  dur: number;
}

/**
 * This tick's subtitles for the watched agent, in feed order. Its own lines, its crew's team talk,
 * talk it heard, the arena; its plan (as thinking) only for your own crew. A rival watched in
 * ranked shows its team talk as private.
 */
export function subtitlesFor(lines: V2CommsLine[], agent: FrameAgent, team: Team, ranked: boolean): Sub[] {
  const rival = agent.team !== team;
  const out: Sub[] = [];
  const dur = (text: string) => Math.min(6.5, Math.max(2.4, 1.5 + text.length * 0.05));
  const push = (s: Omit<Sub, 'dur'>) => out.push({ ...s, dur: dur(s.text) });
  for (const l of lines) {
    if (l.channel === 'order') continue; // your own commands stay in the feed, not the subtitles
    if (l.channel === 'arena') push({ kind: 'arena', who: 'Arena', team: null, text: l.text });
    else if (l.channel === 'mind') {
      if (l.from === agent.id && !rival) push({ kind: 'think', who: l.fromName, team: l.team, text: l.text });
    } else if (l.channel === 'verb' || l.channel === 'emote') {
      if (l.from === agent.id) push({ kind: 'verb', who: l.fromName, team: l.team, text: l.text });
    } else if (l.from === agent.id) {
      const hidden = rival && ranked && l.channel === 'team';
      push({ kind: 'say', who: l.fromName, team: l.team, ch: l.channel, text: hidden ? '··· private channel' : l.text });
    } else if (!rival && (l.team === agent.team || l.overheard || l.channel === 'say')) {
      push({ kind: 'heard', who: l.fromName, team: l.team, ch: l.overheard ? 'overheard' : l.channel === 'team' ? 'team' : 'say', text: l.text });
    }
  }
  return out;
}

/**
 * The mind panel's "Heard" list, newest first. Your agent: its crew's team talk, rival talk it
 * overheard and says nearby. A rival: only what your crew knows of it, its says and overheard talk.
 */
export function heardBy(lines: V2CommsLine[], agent: FrameAgent, team: Team, max = 4): V2CommsLine[] {
  const out: V2CommsLine[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    const l = lines[i]!;
    if (l.channel === 'verb' || l.channel === 'arena' || l.channel === 'mind' || l.channel === 'emote') continue;
    if (agent.team !== team) {
      if (l.from === agent.id) out.push(l);
    } else if (l.from !== agent.id && (l.team === agent.team || l.overheard || l.channel === 'say')) out.push(l);
  }
  return out;
}
