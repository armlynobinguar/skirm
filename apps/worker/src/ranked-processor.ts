// Ranked consumer: the repeatable Elo decay pass (every RANKED_DECAY_EVERY_MS). A placed player in
// DEFAULTS.ranked.decay.fromTier or above with no ranked result for `days` loses `amount` Elo, never
// below the floor of the tier they are in; one step per `days` (RankedRepo.decayInactive, which is
// safe to run again). `days` and `amount` come from RANKED_DECAY_DAYS / RANKED_DECAY_AMOUNT when set.
import type { EloDecayStep } from '@skirm/db';
import { DEFAULTS, rankedDecayFromEnv, type RankedDecayConfig } from '@skirm/shared';
import type { WorkerDeps } from './deps';

export type RankedDeps = Pick<WorkerDeps, 'repos' | 'logger'>;

export type DecayConfig = RankedDecayConfig;

/** Decay settings from the environment (RANKED_DECAY_DAYS / _AMOUNT), the shared defaults otherwise. */
export const decayConfigFrom = rankedDecayFromEnv;

/** One decay pass; `0` days or amount turns decay off. */
export async function processRankedDecay(
  deps: RankedDeps,
  cfg: DecayConfig = { days: DEFAULTS.ranked.decay.days, amount: DEFAULTS.ranked.decay.amount },
): Promise<EloDecayStep[]> {
  if (cfg.days <= 0 || cfg.amount <= 0) return [];
  const steps = await deps.repos.ranked.decayInactive(cfg);
  if (steps.length)
    deps.logger.info('elo decay', {
      players: steps.length,
      eloLost: steps.reduce((n, s) => n + s.before - s.after, 0),
    });
  return steps;
}
