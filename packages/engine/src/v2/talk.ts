// Agent talk (design doc "Talk and manipulation"). Two channels:
// - say reaches every agent within the speaker's range (2 + comms tiles), either crew;
// - team reaches every teammate anywhere, and any rival within the speaker's range overhears it.
// Each agent's talk tier sets how often it may speak; every message is at most 120 characters, and
// every agent reads at most its own tier's heard-text budget per tick, newest first, so a rival can
// neither raise your bill nor flood your agent's context. Ranked fixes every tier at Standard.
import { DEFAULTS } from '@skirm/shared';
import type { MatchEvent, MatchState } from './match';
import { manhattan } from './match';
import { commsOf } from './traits';

export type TalkTier = 'quiet' | 'standard' | 'open';
export type Channel = 'say' | 'team';

export const MAX_MESSAGE_CHARS = 120;

/**
 * Quiet speaks in fixed callouts only. ratePer100 is integer credits per 100 agent-ticks, from
 * DEFAULTS.talk (Quiet makes the same model calls as Standard, so it costs the same).
 */
export const TALK_TIERS: Readonly<Record<TalkTier, { every: number; budget: number; ratePer100: number; freeText: boolean }>> = {
  quiet: { every: 1, budget: 120, ratePer100: DEFAULTS.talk.ratePer100.quiet, freeText: false },
  standard: { every: 5, budget: 360, ratePer100: DEFAULTS.talk.ratePer100.standard, freeText: true },
  open: { every: 1, budget: 720, ratePer100: DEFAULTS.talk.ratePer100.open, freeText: true },
};

/** What Quiet agents can say. */
export const CALLOUTS: readonly string[] = [
  'On it.',
  'Need help here.',
  'Item here.',
  'Danger ahead.',
  'Delivering.',
  'Going middle.',
  'Holding.',
  'Switch is ready.',
];

export interface SayInput {
  agent: string;
  channel: Channel;
  text: string;
}

export interface HeardMessage {
  tick: number;
  from: string;
  fromName: string;
  team: 'A' | 'B';
  channel: Channel;
  text: string;
  /** A rival's team message this agent overheard. */
  overheard: boolean;
}

export const rangeOf = (comms: number) => 2 + comms;

/** Speaks every accepted message and fills each listener's inbox for the next tick. */
export function deliverTalk(s: MatchState, says: SayInput[]): MatchEvent[] {
  for (const a of s.agents) a.inbox = [];
  const ev: MatchEvent[] = [];
  const spoke = new Set<string>();
  for (const m of says) {
    const a = s.agents.find((x) => x.id === m.agent);
    if (!a || a.out || spoke.has(a.id)) continue;
    const tier = TALK_TIERS[a.tier];
    const text = clean(m.text);
    if (!text) continue;
    if (!tier.freeText && !CALLOUTS.includes(text)) {
      ev.push({ kind: 'refused', agent: a.id, reason: 'Quiet agents speak in callouts only' });
      continue;
    }
    if (s.tick - a.lastSpoke < tier.every) {
      ev.push({ kind: 'refused', agent: a.id, reason: `talk tier ${a.tier} allows one message every ${tier.every} ticks` });
      continue;
    }
    spoke.add(a.id);
    a.lastSpoke = s.tick;
    const range = rangeOf(commsOf(a));
    const heardBy: string[] = [];
    const overheardBy: string[] = [];
    for (const o of s.agents) {
      if (o === a || o.out) continue;
      const near = manhattan(o, a) <= range;
      const mate = o.team === a.team;
      let overheard = false;
      if (m.channel === 'say') {
        if (!near) continue;
      } else if (!mate) {
        if (!near) continue;
        overheard = true;
      }
      o.inbox.push({ tick: s.tick, from: a.id, fromName: a.name, team: a.team, channel: m.channel, text, overheard });
      (overheard ? overheardBy : heardBy).push(o.id);
    }
    ev.push({ kind: 'said', agent: a.id, channel: m.channel, text, heardBy, overheardBy });
  }
  // Each listener keeps its newest messages within its tier's budget.
  for (const o of s.agents) {
    const budget = TALK_TIERS[o.tier].budget;
    let used = 0;
    const kept: HeardMessage[] = [];
    for (const msg of [...o.inbox].reverse()) {
      if (used + msg.text.length > budget) break;
      used += msg.text.length;
      kept.unshift(msg);
    }
    o.inbox = kept;
  }
  return ev;
}

/** One line, at most 120 characters. */
export function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_CHARS);
}
