// Sealed-bid skill auctions (Zama FHEVM, packages/fhevm SkillAuction.sol), in plain TypeScript: the
// skill reference the contract stores, its status names, and the second-price rule the contract runs
// on ciphertexts, run here on plaintexts (tests, the UI's explanation of a result). It has no
// runtime imports (packages/fhevm's Hardhat tests load it as CommonJS); the keccak256 of
// `skillRefPreimage` is taken by the caller (ethers `id()` on the server and the web).

/** SkillAuction.Status, by index. */
export const AUCTION_STATUSES = ['none', 'open', 'closing', 'won', 'failed'] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

/** Highest treasury fee the contract accepts (basis points of the clearing price). */
export const AUCTION_MAX_FEE_BPS = 1000;
/** Shortest and longest auction the contract accepts, in seconds. */
export const AUCTION_MIN_DURATION_S = 60;
export const AUCTION_MAX_DURATION_S = 30 * 24 * 60 * 60;

/** The contract status name for a numeric status (unknown values read as 'none'). */
export function auctionStatus(n: number | bigint): AuctionStatus {
  return AUCTION_STATUSES[Number(n)] ?? 'none';
}

/**
 * The string whose keccak256 (UTF-8) is an auction's `skillRef`: it ties the on-chain auction to
 * one off-chain skill version without putting the skill's name or text on chain.
 */
export function skillRefPreimage(skillId: string, version: number): string {
  if (!skillId) throw new Error('skillId is required');
  if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer');
  return `skirm-skill:${skillId}:${version}`;
}

/** What an auction ends with. `winner` is a 0-based index into the bids, null when nothing sold. */
export interface AuctionOutcome {
  winner: number | null;
  /** Clearing price (base units), 0 when nothing sold. */
  price: bigint;
}

/**
 * The second-price rule SkillAuction applies under FHE: the highest total wins (ties go to the
 * earlier bidder), and pays the higher of the runner-up's total and the reserve. Nothing sells when
 * there is no bid, the best total is 0, or it is below the reserve.
 */
export function vickreyOutcome(totals: readonly bigint[], reserve: bigint): AuctionOutcome {
  let first = 0n;
  let second = 0n;
  let winner: number | null = null;
  totals.forEach((t, i) => {
    if (t > first) {
      second = first;
      first = t;
      winner = i;
    } else if (t > second) second = t;
  });
  if (winner === null || first < reserve) return { winner: null, price: 0n };
  return { winner, price: second > reserve ? second : reserve };
}

/** The clearing price split: the treasury fee (floor of `price * bps / 10_000`) and the seller's share. */
export function auctionPayout(price: bigint, feeBps: number, hasTreasury = true): { fee: bigint; seller: bigint } {
  const fee = hasTreasury ? (price * BigInt(feeBps)) / 10_000n : 0n;
  return { fee, seller: price - fee };
}
