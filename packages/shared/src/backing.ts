// Writer backing (contracts/backing): the same arithmetic as the contract, in bigint yoctoNEAR, for
// the api's mirror, the keyless credits mode and the web previews.
//
// A round's backers together get `share_bps` of every royalty routed to it until they received
// `cap_multiple_bps / 10^4` × the raise; every backer earns the same fraction of their stake, so all
// of them reach the cap together. A backer's entitlement is floor(stake · earned / raised).

const BPS = 10_000n;

export const BACKING = {
  /** Backers get at most half of each royalty (contract MAX_SHARE_BPS). */
  maxShareBps: 5_000,
  /** The cap is 1× to 10× the stakes (contract MIN/MAX_CAP_MULTIPLE_BPS). */
  minCapMultipleBps: 10_000,
  maxCapMultipleBps: 100_000,
  /** Smallest stake: 0.1 NEAR (contract DEFAULT_MIN_STAKE). */
  minStakeYocto: 10n ** 23n,
  /** Largest raise: 1,000,000 NEAR (contract MAX_RAISE_LIMIT). */
  maxRaiseYocto: 10n ** 30n,
  /** Most backers in one round (contract MAX_BACKERS). */
  maxBackers: 500,
} as const;

export type BackingRoundStatus = 'open' | 'closed' | 'cancelled';

/** The most a round's backers can ever earn: floor(raised · cap_multiple_bps / 10^4). */
export function backingCap(raised: bigint, capMultipleBps: number): bigint {
  return (raised * BigInt(capMultipleBps)) / BPS;
}

/**
 * How one royalty routed to a round splits: the backers' part is
 * min(floor(amount · share_bps / 10^4), cap − already earned), the writer gets the rest.
 */
export function splitRoyalty(
  amount: bigint,
  round: { shareBps: number; capMultipleBps: number; raised: bigint; earned: bigint },
): { toBackers: bigint; toWriter: bigint } {
  if (amount <= 0n) return { toBackers: 0n, toWriter: 0n };
  const room = backingCap(round.raised, round.capMultipleBps) - round.earned;
  const share = (amount * BigInt(round.shareBps)) / BPS;
  const toBackers = room > 0n ? (share < room ? share : room) : 0n;
  return { toBackers, toWriter: amount - toBackers };
}

/** What one backer is owed in total so far: floor(stake · earned / raised). */
export function backerEntitled(stake: bigint, earned: bigint, raised: bigint): bigint {
  return raised > 0n ? (stake * earned) / raised : 0n;
}

/** Progress of a backer towards the cap, 0..1 (all backers of a round share it). */
export function capProgress(earned: bigint, raised: bigint, capMultipleBps: number): number {
  const cap = backingCap(raised, capMultipleBps);
  if (cap <= 0n) return 0;
  return Number((earned * 10_000n) / cap) / 10_000;
}
