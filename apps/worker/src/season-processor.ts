// Season consumer: the repeatable `seasons` tick (every SEASON_TICK_EVERY_MS). It opens the current
// season when there is none, locks every open season whose end (plus SEASON_LOCK_GRACE_MS) has
// passed and writes its prize payouts, hands the final top 10 to the seasons contract, and makes
// sure the next season is open. Every step is idempotent, so a tick that dies part way is finished
// by the next one.
//
// Onchain: NoopSeasons answers `local` (the prizes stay local). On NEAR the current season is opened
// on the contract as soon as it is current, so the market's fee share (`fund`) reaches it during the
// season; the contract only opens it once the previous season is paid, so until then the tick does
// not try. At lock: open_season if the contract never saw it, then lock_season and post_standings;
// a standing names a NEAR account only when the player linked one (accounts.near_account_id),
// otherwise its share goes to the contract's carry. A season is marked `pending` onchain before it
// is locked, so one whose tick died between the lock and the chain write is sent by a later tick,
// as is one whose chain write failed (`failed`).
import type { SeasonRow } from '@skirm/db';
import { SEASON } from '@skirm/shared';
import type { SeasonStandingInput } from '@skirm/server';
import { errorCode, type WorkerDeps } from './deps';

export type SeasonDeps = Pick<WorkerDeps, 'repos' | 'logger' | 'clock' | 'seasons'>;

export interface SeasonTickOutcome {
  /** Number of the season open after the tick. */
  current: number;
  /** Seasons this tick locked. */
  locked: number[];
  /** Seasons whose standings reached the contract adapter this tick, with what it answered. */
  onchain: { number: number; status: string }[];
}

/** How many failed chain writes a tick looks back over (newest seasons first). */
const RETRY_LOOKBACK = 20;

export async function processSeasonTick(deps: SeasonDeps): Promise<SeasonTickOutcome> {
  const { repos, logger } = deps;
  const now = deps.clock.now();
  await openOnchain(deps, await repos.seasons.ensureCurrent(now));

  const locked: number[] = [];
  const onchain: SeasonTickOutcome['onchain'] = [];
  for (const due of await repos.seasons.dueToLock(now)) {
    // Marked before the lock: a tick that dies after it leaves the chain write to the next tick.
    await repos.seasons.setOnchain(due.id, 'pending');
    const l = await repos.seasons.lock(due.id, now);
    locked.push(l.season.number);
    logger.info('season locked', {
      seasonId: l.season.id,
      number: l.season.number,
      payouts: l.payouts.length,
      poolYocto: l.pool.toString(),
      carryYocto: l.carry.toString(),
    });
    onchain.push({ number: l.season.number, status: await settleOnchain(deps, l.season) });
  }

  // Chain writes that failed, or never ran, on an earlier tick.
  const retry = (await repos.seasons.list(RETRY_LOOKBACK)).filter(
    (s) =>
      s.status === 'locked' &&
      (s.onchainStatus === 'failed' || s.onchainStatus === 'pending') &&
      !locked.includes(s.number),
  );
  for (const s of retry.reverse())
    onchain.push({ number: s.number, status: await settleOnchain(deps, s) });

  const current = await repos.seasons.ensureCurrent(now);
  return { current: current.number, locked, onchain };
}

/**
 * On NEAR, opens the current season on the contract when it is not there yet and the contract can
 * take it (the first season, or the previous one paid). Never throws: the next tick tries again.
 */
async function openOnchain(deps: SeasonDeps, season: SeasonRow): Promise<void> {
  const { seasons: chain, logger } = deps;
  if (chain.kind !== 'near') return;
  try {
    if ((await chain.getSeason(season.number)) !== null) return;
    // A previous season the contract never saw is opened at its lock (ids must increase onchain).
    if (season.number > 1 && (await chain.getSeason(season.number - 1))?.status !== 'paid') return;
    await chain.openSeason(openInput(season));
    logger.info('season opened onchain', { seasonId: season.id, number: season.number });
  } catch (err) {
    logger.warn('season onchain open failed', {
      seasonId: season.id,
      number: season.number,
      code: errorCode(err),
    });
  }
}

const openInput = (season: SeasonRow) => ({
  id: season.number,
  name: `Season ${season.number}`,
  startsAtMs: season.startsAt.getTime(),
  endsAtMs: season.endsAt.getTime(),
});

/** Sends a locked season's top 10 to the seasons adapter; records what it said. Never throws. */
async function settleOnchain(deps: SeasonDeps, season: SeasonRow): Promise<string> {
  const { repos, seasons: chain, logger } = deps;
  try {
    const { rows } = await repos.seasons.standings(season.id, { limit: SEASON.splitBps.length });
    const standings: SeasonStandingInput[] = [];
    for (const r of rows) {
      const account = await repos.accounts.get(r.accountId);
      standings.push({
        player: r.accountId,
        near: account?.nearAccountId ?? null,
        points: r.points,
      });
    }
    if (chain.kind === 'near' && (await chain.getSeason(season.number)) === null)
      await chain.openSeason(openInput(season));
    await chain.lockSeason(season.number);
    const res = await chain.postStandings(season.number, standings);
    await repos.seasons.setOnchain(season.id, res.status, res.txHash ?? null);
    logger.info('season standings posted', {
      seasonId: season.id,
      number: season.number,
      status: res.status,
      standings: standings.length,
    });
    return res.status;
  } catch (err) {
    logger.warn('season onchain write failed', {
      seasonId: season.id,
      number: season.number,
      code: errorCode(err),
    });
    await repos.seasons.setOnchain(season.id, 'failed').catch(() => undefined);
    return 'failed';
  }
}
