// The match log: every tick's actions and accepted messages, hash-chained. LLM output cannot be
// re-simulated, so the record is the log itself: anyone can re-check the chain, and replaying the
// logged actions through the engine reproduces the match exactly.
import { canonicalJson, sha256Hex } from '../canonical';
import type { Difficulty } from './difficulty';
import type { CrewCommand } from './commands';
import type { Action, MatchResult } from './match';
import type { SayInput } from './talk';

export interface LogHeader {
  schema: 'skirm.match/v2';
  map: string;
  crews: Record<'A' | 'B', { id: string; name: string; role: string; vision: number; comms: number; tier: string }[]>;
  ranked: boolean;
  /** The level played (replaying needs it). Absent means Normal: a Normal log leaves it out. */
  difficulty?: Difficulty;
  models: { planner: string; actor: string; speech: string };
}

export interface LogTick {
  tick: number;
  actions: Record<string, Action>;
  says: SayInput[];
  /** Live commands applied this tick (absent when none, so older logs hash the same). */
  commands?: CrewCommand[];
  /** Hybrid control: the agents whose action this tick came from their player (absent when none). */
  controlled?: string[];
}

export interface MatchLog {
  header: LogHeader;
  ticks: LogTick[];
  /** Hash after the header and after each tick. */
  hashes: string[];
  result: MatchResult | null;
}

export function startLog(header: LogHeader): MatchLog {
  return { header, ticks: [], hashes: [sha256Hex(canonicalJson(header))], result: null };
}

export function appendTick(log: MatchLog, t: LogTick): string {
  const prev = log.hashes[log.hashes.length - 1]!;
  const h = sha256Hex(prev + canonicalJson(t));
  log.ticks.push(t);
  log.hashes.push(h);
  return h;
}

/** The final hash: what goes on chain. */
export function logHash(log: MatchLog): string {
  return log.hashes[log.hashes.length - 1]!;
}

/** Re-checks the chain; returns the first tick whose hash does not match, or null. */
export function verifyLog(log: MatchLog): number | null {
  let h = sha256Hex(canonicalJson(log.header));
  if (h !== log.hashes[0]) return 0;
  for (let i = 0; i < log.ticks.length; i++) {
    h = sha256Hex(h + canonicalJson(log.ticks[i]));
    if (h !== log.hashes[i + 1]) return log.ticks[i]!.tick;
  }
  return null;
}
