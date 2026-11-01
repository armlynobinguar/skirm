// New-account defaults (docs/backend-contract.md, Game Spec §8, UI/UX small defaults).
import type { Tag, Unlock } from '@skirm/shared';

export const STARTER_AGENT_NAMES = ['Rook', 'Wren', 'Moss'] as const;
export const STARTER_UNLOCKS: readonly Unlock[] = ['builder', 'digger', 'firefighter'];

/** Platform account that creates the starter skill. Never signs in (handle is not a valid login). */
export const SYSTEM_ACCOUNT_ID = 'acc_00000000000000000000000000';
export const SYSTEM_HANDLE = '@skirm';

/** Flood Warden: account-bound, never onchain. Id is the Spec §9 example id. */
export const STARTER_SKILL = {
  id: 'skl_01JB7Z3K9QX4M2T8V6N5R1C0DE',
  version: 1,
  name: 'Flood Warden',
  summary: 'Seals the leak before it spreads, then does the job.',
  royaltyBps: 500,
  requiresActions: ['place_block'] as ('place_block' | 'dig' | 'extinguish')[],
  handlesTags: ['spreads', 'liquid'] as Tag[],
  /** Equipped on the first starter agent, which also gets the Builder unlock. */
  equipOn: 'Rook',
  unlockOn: 'builder' as Unlock,
} as const;

/**
 * Spec §9 example text. Used once, to seal the starter skill into the vault; it is never returned
 * by any API (the creator is the system account, so no player gets a read-back).
 */
export const STARTER_SKILL_TEXT = {
  prompt:
    'Before any task, find every tile tagged spreads+liquid that touches open floor through a gap one tile wide. Work out the tick it reaches the gap from its spread interval. If you can stand next to the gap before then, go there first and place a block in it. Only then start the goal.',
  reflexes:
    'If a spreads+liquid tile is 1 tile from an open gap and place_block is legal toward the gap, place it.',
} as const;
