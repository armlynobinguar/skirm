// Response shapes of the /zama routes (apps/api zama.controller.ts): the EVM address link and the
// sealed-bid skill auctions registered for SkillAuction on Sepolia.

export interface EvmLink {
  /** Lower-case 0x address, or null when none is linked. */
  address: string | null;
}

export type SealedAuctionStatus = 'open' | 'won' | 'granted' | 'failed';

/** One registered auction (public). Bids are never here: they live on chain, encrypted. */
export interface SealedAuctionCard {
  id: string;
  /** The SkillAuction auction id (decimal string). */
  auctionId: string;
  skill: { id: string; version: number; name: string | null };
  seller: { id: string; handle: string | null };
  endsAt: string;
  status: SealedAuctionStatus;
  /** Clearing price in cSKIRM base units, once the chain finalized a sale. */
  price: string | null;
  winnerAddress: string | null;
  buyer: { id: string; handle: string | null } | null;
}

export interface SealedAuctionList {
  /** The SkillAuction address these auctions live on (lower-case). */
  contract: string;
  auctions: SealedAuctionCard[];
}
