// The match log: every tick's actions and accepted messages, hash-chained. LLM output cannot be
// re-simulated, so the record is the log itself: anyone can re-check the chain, and replaying the
// logged actions through the engine reproduces the match exactly.
import { canonicalJson, sha256Hex } from '../canonical';
import type { Difficulty } from './difficulty';
import type { CrewCommand } from './commands';
import type { TraitId } from '@skirm/shared';
import type { Action, AgentSpec, AgentState, MatchResult, Role } from './match';
import type { TalkTier } from './talk';
import type { SayInput } from './talk';

/** One agent as the log header records it: its base stats, and the traits it played with (absent when none, so older logs hash the same). */
export interface LogAgent {
  id: string;
  name: string;
  role: string;
  vision: number;
  comms: number;
  tier: string;
  traits?: readonly TraitId[];
}

export interface LogHeader {
  schema: 'skirm.match/v2';
  map: string;
  crews: Record<'A' | 'B', LogAgent[]>;
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

/** An agent as it played, for the log header (ranked without traits records none). */
export function logAgent(a: Pick<AgentState, 'id' | 'name' | 'role' | 'vision' | 'comms' | 'tier' | 'traits'>): LogAgent {
  return { id: a.id, name: a.name, role: a.role, vision: a.vision, comms: a.comms, tier: a.tier, ...(a.traits?.length ? { traits: [...a.traits] } : {}) };
}

/** The crews a header records, as createMatch takes them: replaying the logged ticks on these reproduces the match. */
export function specsFromHeader(header: LogHeader): Record<'A' | 'B', AgentSpec[]> {
  const spec = (a: LogAgent): AgentSpec => ({
    id: a.id,
    name: a.name,
    role: a.role as Role,
    vision: a.vision,
    comms: a.comms,
    tier: a.tier as TalkTier,
    ...(a.traits?.length ? { traits: a.traits } : {}),
  });
  return { A: header.crews.A.map(spec), B: header.crews.B.map(spec) };
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
