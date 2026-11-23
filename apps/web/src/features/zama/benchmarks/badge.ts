// The benchmark seeds badge's steps (no imports: the Exchange cards use it without chain code).
import type { OnchainBenchmark } from '@skirm/shared';

export type BadgeStep = 'drawn' | 'sealed' | 'revealed';
export type StepState = 'done' | 'current' | 'pending';

/**
 * Each badge step's state for a seed status: committed has the seed drawn and sealed (the run is on
 * or about to be), published has it open and the proof pending, revealed has every step done.
 */
export function badgeSteps(status: OnchainBenchmark['status'] | null | undefined): Record<BadgeStep, StepState> {
  if (status === 'revealed') return { drawn: 'done', sealed: 'done', revealed: 'done' };
  if (status === 'published') return { drawn: 'done', sealed: 'done', revealed: 'current' };
  if (status === 'committed') return { drawn: 'done', sealed: 'current', revealed: 'pending' };
  return { drawn: 'pending', sealed: 'pending', revealed: 'pending' };
}
