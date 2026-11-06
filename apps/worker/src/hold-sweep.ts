// Stale hold sweep. Bench, daily and puzzle jobs place a credit hold per attempt and release it in
// their own `catch`. A job whose process dies (or that BullMQ marks stalled) never reaches that
// `catch`, so its hold would stay `held` and the player's credits would never come back. This pass
// runs on the repeatable `tournaments` tick and aborts (full refund) any such hold that is older
// than any job could still be running.
import { errorCode, type WorkerDeps } from './deps';

export type HoldSweepDeps = Pick<WorkerDeps, 'repos' | 'logger' | 'clock'>;

/** Hold id prefixes placed by worker jobs (bench-processor, daily-processor, puzzle-processor). */
export const WORKER_HOLD_PREFIXES = ['bench-', 'daily-', 'puzzle-'] as const;

/** A worker hold older than this is treated as orphaned. Far longer than one match takes. */
export const WORKER_HOLD_STALE_MS = 60 * 60_000;

export async function sweepWorkerHolds(deps: HoldSweepDeps, staleMs = WORKER_HOLD_STALE_MS): Promise<string[]> {
  const { repos, logger, clock } = deps;
  const released: string[] = [];
  const before = new Date(clock.now() - staleMs);
  for (const runId of await repos.ledger.staleHolds(WORKER_HOLD_PREFIXES, before)) {
    try {
      const r = await repos.ledger.abort(runId);
      if (r.ok) released.push(runId);
      else logger.warn('stale hold abort refused', { runId, code: r.error });
    } catch (err) {
      logger.warn('stale hold abort failed', { runId, code: errorCode(err) });
    }
  }
  if (released.length) logger.info('stale worker holds released', { count: released.length });
  return released;
}
