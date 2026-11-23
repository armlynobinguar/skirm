// Sealed skill auctions (ZAMA_ENABLED): polls SkillAuction on Sepolia for the auctions that are due
// and grants each `Won` buyer the skill version through the Exchange's sale path
// (@skirm/server grantWonAuctions → MarketRepo.recordSale). Reading the auction record rather than
// scanning `Won` logs keeps it within public RPC limits; the record holds the same winner and price
// the event carries. Every grant is keyed by the auction, so overlapping passes and several workers
// never sell twice.
import { grantWonAuctions, type AuctionPassResult, type AuctionReader } from '@skirm/server';
import { errorCode, type WorkerDeps } from './deps';

/** How often the worker polls (ZAMA_AUCTION_POLL_MS, default 30 s, at least 5 s). */
export function auctionPollMs(env: Record<string, string | undefined>): number {
  const n = Number(env.ZAMA_AUCTION_POLL_MS ?? 30_000);
  return Number.isFinite(n) && n >= 5_000 ? n : 30_000;
}

export async function processAuctionTick(
  deps: Pick<WorkerDeps, 'repos' | 'logger' | 'clock'>,
  reader: AuctionReader,
): Promise<AuctionPassResult | null> {
  try {
    const out = await grantWonAuctions({ repos: deps.repos, reader, logger: deps.logger, now: () => deps.clock.now() });
    if (out.granted.length || out.failed.length)
      deps.logger.info('auction pass', { granted: out.granted.length, failed: out.failed.length, waiting: out.waiting.length });
    return out;
  } catch (err) {
    deps.logger.warn('auction pass failed', { code: errorCode(err) });
    return null;
  }
}

/** Starts the poller; the returned function stops it and waits for a pass in flight. */
export function startAuctionPoller(
  deps: Pick<WorkerDeps, 'repos' | 'logger' | 'clock'>,
  reader: AuctionReader,
  intervalMs: number,
): () => Promise<void> {
  let running: Promise<unknown> = Promise.resolve();
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    running = processAuctionTick(deps, reader).finally(() => {
      busy = false;
    });
  }, intervalMs);
  return async () => {
    clearInterval(timer);
    await running;
  };
}
