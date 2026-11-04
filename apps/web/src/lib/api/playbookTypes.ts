// Crew playbooks (apps/api playbooks.controller.ts; docs/backend-contract.md, Crew playbooks). One
// crew-level strategy per player, picked at lock-in. The text comes back only from GET /playbooks/:id,
// to its owner; lists carry names alone.

export interface Playbook {
  id: string;
  name: string;
  /** The one lock-in starts with (at most one). */
  selected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookWithText extends Playbook {
  text: string;
}

export interface PlaybookList {
  playbooks: Playbook[];
  /** How many a player may keep. */
  max: number;
  /** Longest text, in characters. */
  maxChars: number;
}
