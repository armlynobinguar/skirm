// Registry consumer: a ranked v2 match (`v2_match` job) → Registry.recordMatch as a MatchRecordV2
// with per-player Elo, then the registry status and tx hash on the row. BullMQ retries a throw
// (DEFAULT_JOB_OPTIONS.registry); the last failed attempt marks the row `failed`. A row already
// `recorded` is not sent again. The season a ranked result counted towards (v2_matches.season_id)
// goes on the record by its number, the id the seasons contract knows it by.
import type { MatchDecidedBy, RegistryJobData, RegistryResult } from '@skirm/server';
import { errorCode, type WorkerDeps } from './deps';

export interface RegistryAttempt {
  /** Attempts already made before this one (BullMQ job.attemptsMade). */
  attemptsMade: number;
  /** Total attempts allowed (job.opts.attempts). */
  attempts: number;
}

export interface RegistryOutcome {
  kind: RegistryJobData['kind'];
  id: string;
  status: RegistryResult['status'] | 'skipped';
  txHash?: string;
  reason?: string;
}

export async function processRegistry(
  deps: WorkerDeps,
  data: RegistryJobData,
  attempt: RegistryAttempt = { attemptsMade: 0, attempts: 1 },
): Promise<RegistryOutcome> {
  const { kind, id } = data;
  const skip = (reason: string): RegistryOutcome => {
    deps.logger.info('registry skipped', { kind, id, reason });
    return { kind, id, status: 'skipped', reason };
  };
  const setStatus = (status: RegistryResult['status'], txHash?: string | null) =>
    deps.repos.v2Matches.setRegistry(id, status, txHash);

  try {
    const match = await deps.repos.v2Matches.get(id);
    if (!match) return skip('not_found');
    if (match.status !== 'ended' || !match.winner) return skip('not_ended');
    if (match.registryStatus === 'none') return skip('not_registered');
    if (match.registryStatus === 'recorded') return skip('already_recorded');
    if (!match.crews || !match.logHash) return skip('no_log');
    if (!match.decidedBy) return skip('no_result');
    const [a, b, season] = await Promise.all([
      deps.repos.accounts.get(match.teamAAccountId),
      deps.repos.accounts.get(match.teamBAccountId),
      match.seasonId ? deps.repos.seasons.get(match.seasonId) : undefined,
    ]);
    const result = await deps.registry.recordMatch({
      matchId: match.id,
      ...(season ? { seasonId: season.number } : {}),
      mapId: match.mapId,
      ranked: match.ranked,
      sideA: {
        player: a?.nearAccountId ?? match.teamAAccountId,
        crew: match.crews.A,
        delivered: match.scoreA ?? 0,
      },
      sideB: {
        player: b?.nearAccountId ?? match.teamBAccountId,
        crew: match.crews.B,
        delivered: match.scoreB ?? 0,
      },
      result: match.winner as 'A' | 'B' | 'draw',
      decidedBy: match.decidedBy as MatchDecidedBy,
      ticks: match.ticks ?? 0,
      logSha256: match.logHash,
      // v2 Elo is per player: one change per side, as the contract takes it.
      eloDeltas: match.eloDeltas ?? [],
    });
    await setStatus(result.status, result.txHash ?? null);
    deps.logger.info('registry recorded', { kind, id, status: result.status });
    return { kind, id, status: result.status, ...(result.txHash ? { txHash: result.txHash } : {}) };
  } catch (err) {
    const last = attempt.attemptsMade + 1 >= attempt.attempts;
    deps.logger.warn('registry write failed', {
      kind,
      id,
      code: errorCode(err),
      attempt: attempt.attemptsMade + 1,
      last,
    });
    if (last) await setStatus('failed').catch(() => undefined);
    throw err;
  }
}
