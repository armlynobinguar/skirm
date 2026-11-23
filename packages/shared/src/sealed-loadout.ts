// Sealed loadouts (Zama FHEVM, packages/fhevm SkirmMatch.sol): a PvP lock-in as nine small integers
// the player encrypts in the browser and the contract keeps as euint8 ciphertexts until both sides
// have sealed. This module is the one mapping between skirm's crew model and those integers; the
// web encodes with it and the game server decodes the revealed plaintexts with it.
//
// Per crew slot i (0..2):
// - agents[i]  0 = empty slot, n = the n-th agent (1-based) of the player's roster sorted by agent id.
//              Sorting by id makes the index independent of how a client happens to list agents.
// - skills[i]  bitmask over that agent's equipped skills in equipped order (bit j: skill j plays).
//              0 benches every skill; ALL bits of the equipped count is the normal lock-in.
// - tiers[i]   talk tier: 0 quiet, 1 standard, 2 open.
// Occupied slots come first (no gaps) and an agent appears once. Values are uint8 on chain.
import type { TalkTierName } from './talk';

/** Crew slots a sealed loadout carries (the map crew limit never exceeds 3). */
export const SEALED_SLOTS = 3;
/** Talk tiers by their encoded value. */
export const SEALED_TIERS: readonly TalkTierName[] = ['quiet', 'standard', 'open'];
/** Largest roster an index can address (uint8, 0 is the empty slot). */
export const MAX_SEALED_ROSTER = 255;
/** Equipped skills a uint8 mask can address. */
export const MAX_SEALED_SKILLS = 8;

type Triple = [number, number, number];

/** The contract's three encrypted arrays, as plaintexts. */
export interface EncodedLoadout {
  agents: Triple;
  skills: Triple;
  tiers: Triple;
}

/** What the roster index and the skill mask are computed against. */
export interface SealedRosterAgent {
  id: string;
  /** Equipped skills, in equipped order. */
  skills: readonly { id: string }[];
}

/** One crew slot as the player picks it. */
export interface SealedPick {
  agentId: string;
  tier: TalkTierName;
  /** Skills of this agent that play (ids). Absent: every equipped skill. */
  skillIds?: readonly string[];
}

/** One crew slot as decoded from revealed plaintexts. */
export interface DecodedPick {
  agentId: string;
  tier: TalkTierName;
  /** The equipped skills that play, in equipped order. */
  skillIds: string[];
}

export class SealedLoadoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedLoadoutError';
  }
}

/** The roster in index order: sorted by agent id (a copy; the input is untouched). */
export function sealedRoster<T extends { id: string }>(agents: readonly T[]): T[] {
  return [...agents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const allBits = (n: number) => (1 << Math.min(n, MAX_SEALED_SKILLS)) - 1;

/**
 * Encodes a crew (1 to SEALED_SLOTS picks, in crew order) against the player's roster.
 * Throws SealedLoadoutError for an agent not in the roster, a duplicate, an unknown skill or tier.
 */
export function encodeLoadout(picks: readonly SealedPick[], roster: readonly SealedRosterAgent[]): EncodedLoadout {
  if (picks.length < 1 || picks.length > SEALED_SLOTS) throw new SealedLoadoutError(`a sealed crew has 1 to ${SEALED_SLOTS} agents`);
  const sorted = sealedRoster(roster);
  if (sorted.length > MAX_SEALED_ROSTER) throw new SealedLoadoutError(`a sealed roster holds at most ${MAX_SEALED_ROSTER} agents`);
  const out: EncodedLoadout = { agents: [0, 0, 0], skills: [0, 0, 0], tiers: [0, 0, 0] };
  const seen = new Set<string>();
  picks.forEach((p, i) => {
    const at = sorted.findIndex((a) => a.id === p.agentId);
    if (at < 0) throw new SealedLoadoutError(`agent ${p.agentId} is not in the roster`);
    if (seen.has(p.agentId)) throw new SealedLoadoutError(`agent ${p.agentId} is picked twice`);
    seen.add(p.agentId);
    const tier = SEALED_TIERS.indexOf(p.tier);
    if (tier < 0) throw new SealedLoadoutError(`unknown talk tier ${String(p.tier)}`);
    const equipped = sorted[at]!.skills.slice(0, MAX_SEALED_SKILLS);
    let mask = allBits(equipped.length);
    if (p.skillIds) {
      mask = 0;
      for (const id of p.skillIds) {
        const j = equipped.findIndex((s) => s.id === id);
        if (j < 0) throw new SealedLoadoutError(`skill ${id} is not equipped on agent ${p.agentId}`);
        mask |= 1 << j;
      }
    }
    out.agents[i] = at + 1;
    out.skills[i] = mask;
    out.tiers[i] = tier;
  });
  return out;
}

/**
 * Decodes revealed plaintexts against the player's roster, validating everything the contract
 * cannot (it stores whatever was encrypted). Throws SealedLoadoutError on any invalid value.
 */
export function decodeLoadout(enc: EncodedLoadout, roster: readonly SealedRosterAgent[]): DecodedPick[] {
  const sorted = sealedRoster(roster);
  const out: DecodedPick[] = [];
  const seen = new Set<number>();
  let ended = false;
  for (let i = 0; i < SEALED_SLOTS; i++) {
    const index = enc.agents[i]!;
    const mask = enc.skills[i]!;
    const tierValue = enc.tiers[i]!;
    for (const v of [index, mask, tierValue]) {
      if (!Number.isInteger(v) || v < 0 || v > 255) throw new SealedLoadoutError(`slot ${i}: ${v} is not a uint8`);
    }
    if (index === 0) {
      ended = true;
      continue;
    }
    if (ended) throw new SealedLoadoutError(`slot ${i}: an agent after an empty slot`);
    const agent = sorted[index - 1];
    if (!agent) throw new SealedLoadoutError(`slot ${i}: roster index ${index} is out of range (${sorted.length} agents)`);
    if (seen.has(index)) throw new SealedLoadoutError(`slot ${i}: agent ${agent.id} is picked twice`);
    seen.add(index);
    const tier = SEALED_TIERS[tierValue];
    if (!tier) throw new SealedLoadoutError(`slot ${i}: unknown talk tier ${tierValue}`);
    const equipped = agent.skills.slice(0, MAX_SEALED_SKILLS);
    if (mask & ~allBits(equipped.length)) throw new SealedLoadoutError(`slot ${i}: skill mask ${mask} names a skill agent ${agent.id} does not equip`);
    out.push({ agentId: agent.id, tier, skillIds: equipped.filter((_, j) => mask & (1 << j)).map((s) => s.id) });
  }
  if (!out.length) throw new SealedLoadoutError('a sealed crew has at least one agent');
  return out;
}

/** The nine values in contract order (agents, skills, tiers), as encrypted inputs are added. */
export function loadoutValues(enc: EncodedLoadout): number[] {
  return [...enc.agents, ...enc.skills, ...enc.tiers];
}

/** The inverse of loadoutValues (e.g. the contract's sealedLoadout handles, decrypted in order). */
export function loadoutFromValues(values: readonly (number | bigint)[]): EncodedLoadout {
  if (values.length !== 3 * SEALED_SLOTS) throw new SealedLoadoutError(`a loadout has ${3 * SEALED_SLOTS} values, got ${values.length}`);
  const n = values.map(Number);
  return { agents: [n[0]!, n[1]!, n[2]!], skills: [n[3]!, n[4]!, n[5]!], tiers: [n[6]!, n[7]!, n[8]!] };
}
