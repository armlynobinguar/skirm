// Bluffs (the prototype's "manipulation" step). An agent in voice range of a rival who is closing on
// a middle item tells it the item is gone, or that the delivery point is flooding, or that its own
// items are unguarded. The lie is an ordinary say: it needs a free-text talk tier and a turn to
// speak, counts as a message sent, and lands in the inboxes of everyone in range. Whether the target
// believes it is the engine's call, from what its crew can see: an item in sight is never doubted
// away; out of sight, sharper vision doubts more. A fooled agent treats the item as gone for
// BLUFF_AVOID_TICKS: it reads it as open floor and walks over it without picking it up.
//
// Each crew tells at most `lieCap` bluffs a match (BLUFF_CAP by default; the practice bot's comes
// from the difficulty) and one a tick. The roll is a hash of the tick and both agents, so a match
// still replays the same from the same inputs.
import type { AgentState, MatchEvent, MatchState } from './match';
import { manhattan } from './match';
import { clean, rangeOf, TALK_TIERS, type SayInput } from './talk';

/** Bluffs each crew may tell in a match unless the match sets its own cap. */
export const BLUFF_CAP = 3;
/** Ticks a fooled agent treats the item as gone. */
export const BLUFF_AVOID_TICKS = 7;
/** A rival counts as closing on a middle item when it is at most this many tiles from it. */
export const BLUFF_REACH = 6;

export interface PlannedBluff {
  liar: AgentState;
  victim: AgentState;
  /** The middle item tile the victim is closing on. */
  tile: number;
  say: SayInput;
}

/** The lines the prototype's rivals use, in turn. */
export function bluffLine(s: MatchState, n: number): string {
  const item = s.map.def.item.toLowerCase();
  const lines = [
    `The middle ${item} is gone. I already have it.`,
    `${s.map.def.deliverTo} is flooding. Turn back while you can.`,
    `Your ${item} on the far side is unguarded. Better go check.`,
  ];
  return clean(lines[n % lines.length]!);
}

/** The middle item tile an agent is closing on: its nearest item, if that one is in the middle and within reach. */
function closingOn(s: MatchState, a: AgentState): number | null {
  const { w } = s.map;
  let best: number | null = null;
  let bestD = Infinity;
  s.grid.forEach((t, i) => {
    if (t !== 'item') return;
    const d = manhattan(a, { x: i % w, y: (i / w) | 0 });
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best !== null && bestD <= BLUFF_REACH && s.middle.includes(best) ? best : null;
}

/** Can this agent speak free text this tick? */
function canTell(s: MatchState, a: AgentState): boolean {
  const tier = TALK_TIERS[a.tier];
  return tier.freeText && s.tick - a.lastSpoke >= tier.every;
}

/**
 * At most one bluff per crew this tick: the first agent of the crew in range of a rival closing on
 * a middle item, with its cap not reached. Agents that already chose to speak this tick keep their
 * own message.
 */
export function planBluffs(s: MatchState, says: readonly SayInput[]): PlannedBluff[] {
  const speaking = new Set(says.map((m) => m.agent));
  const up = (a: AgentState) => !a.out && !a.down;
  const out: PlannedBluff[] = [];
  for (const T of ['A', 'B'] as const) {
    if (s.tally[T].lies >= s.lieCap[T]) continue;
    for (const victim of s.agents) {
      if (victim.team === T || !up(victim) || victim.carrying.length >= (victim.role === 'Hauler' ? 3 : 2)) continue;
      const tile = closingOn(s, victim);
      if (tile === null) continue;
      const liar = s.agents.find((a) => a.team === T && up(a) && !a.stun && !speaking.has(a.id) && canTell(s, a) && manhattan(a, victim) <= rangeOf(a.comms));
      if (!liar) continue;
      out.push({ liar, victim, tile, say: { agent: liar.id, channel: 'say', text: bluffLine(s, s.tally[T].lies) } });
      break;
    }
  }
  return out;
}

/** A number in [0, 1) from the tick and both agents: the same match always rolls the same. */
export function bluffRoll(tick: number, liar: string, victim: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${tick}|${liar}|${victim}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/** The chance a target believes a bluff about `tile` (the prototype's odds). */
export function believeChance(s: MatchState, victim: AgentState, tile: number): number {
  if (s.map.def.fog) return s.visible[victim.team][tile] ? 0 : Math.max(0, 0.78 - victim.vision * 0.08);
  return Math.max(0, 0.7 - victim.vision * 0.11);
}

/**
 * Judges each planned bluff whose message was spoken and reached its target, after talk: counts it,
 * rolls belief and, when believed, makes the target treat the item as gone.
 */
export function judgeBluffs(s: MatchState, planned: readonly PlannedBluff[], spoken: readonly MatchEvent[]): MatchEvent[] {
  const ev: MatchEvent[] = [];
  for (const b of planned) {
    const said = spoken.find((e) => e.kind === 'said' && e.agent === b.liar.id && e.text === b.say.text);
    if (!said || said.kind !== 'said') continue;
    // The engine spoke it for the agent (not the agent's own message): marked for stats that count a brain's speech.
    said.bluff = true;
    if (!said.heardBy.includes(b.victim.id)) continue;
    const T = s.tally[b.liar.team];
    T.lies++;
    b.liar.bluffs.told++;
    const believed = bluffRoll(s.tick, b.liar.id, b.victim.id) < believeChance(s, b.victim, b.tile);
    b.victim.heardBluff = { by: b.liar.name, tile: b.tile, tick: s.tick, believed };
    if (believed) {
      T.believed++;
      b.liar.bluffs.landed++;
      b.victim.avoid = { tile: b.tile, until: s.tick + BLUFF_AVOID_TICKS };
    } else b.victim.bluffs.seenThrough++;
    const { w } = s.map;
    ev.push({ kind: 'bluff', agent: b.liar.id, victim: b.victim.id, at: [b.tile % w, (b.tile / w) | 0], believed });
  }
  return ev;
}

/** The tile an agent currently believes is empty, or null. */
export function avoidedTile(s: MatchState, a: AgentState): number | null {
  return a.avoid && s.tick < a.avoid.until ? a.avoid.tile : null;
}
