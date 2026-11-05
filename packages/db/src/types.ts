// Shapes shared by the repositories and their callers (api, worker, realtime, @skirm/server).
import type { ActionKind, AgentAppearance, AgentProgression, Tag, Unlock } from '@skirm/shared';

/** Envelope-encrypted skill text (Spec §9, arch.md Secrets). Produced by @skirm/server's vault. */
export interface SealedSkill {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  wrappedKey: Uint8Array;
  /** Which key-encryption key wrapped `wrappedKey`. */
  keyId: string;
  /** sha256(prompt + '\n' + (reflexes ?? '')), 64 hex chars. */
  promptSha256: string;
}

/**
 * Envelope-encrypted crew playbook text, the same envelope as a skill (`promptSha256` is the sha256 of
 * the playbook text). Sealed under its own AAD, so a playbook row never opens as a skill or back.
 */
export type SealedPlaybook = SealedSkill;

/** Anything that can seal skill text (the vault). The db package never sees a KEK. */
export interface SkillSealer {
  encryptSkill(prompt: string, reflexes?: string): Promise<SealedSkill>;
}

/** What an account owns, as `runCrewValidation` (in @skirm/server) needs it. */
export interface CrewOwnership {
  agents: { id: string; unlocks: Unlock[] }[];
  skills: {
    id: string;
    version: number;
    requiresActions: Extract<ActionKind, 'place_block' | 'dig' | 'extinguish'>[];
    handlesTags: Tag[];
  }[];
}

/** v2 roles and talk tiers (the engine's Role and TalkTier; @skirm/db does not depend on the engine). */
export const V2_ROLES = ['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'] as const;
export type V2Role = (typeof V2_ROLES)[number];
export const V2_TALK_TIERS = ['quiet', 'standard', 'open'] as const;
export type V2TalkTier = (typeof V2_TALK_TIERS)[number];
/** Longest owner's instructions an agent carries (agents.system_prompt; the DB checks it too). */
export const AGENT_SYSTEM_PROMPT_MAX = 600;

export interface AgentView {
  id: string;
  name: string;
  elo: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  skills: { id: string; version: number; name: string }[];
  unlocks: Unlock[];
  role: V2Role;
  vision: number;
  comms: number;
  tier: V2TalkTier;
  /** v2: the owner's instructions, ahead of the skills in the agent's system prompt. Owner only. */
  systemPrompt: string | null;
  /** Stored look, or the agent's default when none is stored. */
  appearance: AgentAppearance;
  /** XP, level and traits (@skirm/shared progressionOf). */
  progression: AgentProgression;
}

export interface UnlockItemView {
  id: string;
  kind: Unlock;
  attachedAgentId: string | null;
}

/** `local`: written by the NoopRegistry (NEAR off in local mode); nothing went onchain. */
export type RegistryState = 'none' | 'pending' | 'recorded' | 'failed' | 'local';

/** Domain error with a stable code; messages never carry skill text. */
export class RepoError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RepoError';
  }
}
