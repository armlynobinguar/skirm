// Writer backing (apps/api backing.controller.ts; docs/backend-contract.md, Writer backing).
// Amounts are yoctoNEAR strings. A write answers either the result (credits mode, the keyless local
// stack) or `{ wallet }`: the backing-contract call to sign, whose tx hash then goes to /backing/sync.

export type BackingMode = 'near' | 'credits' | 'off';
export type BackingRoundStatus = 'open' | 'closed' | 'cancelled';

export interface BackingConfig {
  mode: BackingMode;
  contractId: string | null;
  creditsPerNear: number;
  maxShareBps: number;
  minCapMultipleBps: number;
  maxCapMultipleBps: number;
  minStakeYocto: string;
  maxRaiseYocto: string;
  openRoundStorageYocto: string;
}

export interface BackingRound {
  id: string;
  writerId: string;
  writerHandle: string;
  writerNearAccountId: string | null;
  /** null: every skill the writer sells. */
  skillId: string | null;
  skillName: string | null;
  shareBps: number;
  capMultipleBps: number;
  maxRaiseYocto: string;
  raisedYocto: string;
  backers: number;
  status: BackingRoundStatus;
  mode: 'near' | 'credits';
  chainRoundId: string | null;
  royaltiesInYocto: string;
  backersEarnedYocto: string;
  capYocto: string;
  createdAt: string;
  closedAt: string | null;
}

export interface BackingPosition {
  backingId: string;
  round: BackingRound;
  stakeYocto: string;
  earnedYocto: string;
  claimedYocto: string;
  claimableYocto: string;
  capYocto: string;
  refunded: boolean;
}

export interface BackingPayout {
  payoutId: string;
  royaltyYocto: string;
  toBackersYocto: string;
  toWriterYocto: string;
  saleId: string | null;
  txHash: string | null;
  createdAt: string;
}

export interface BackingRoundDetail {
  round: BackingRound;
  payouts: BackingPayout[];
  position: BackingPosition | null;
  /** near mode, the writer only: royalties not routed to the round yet. */
  owedYocto: string;
}

export interface MyBacking {
  mode: BackingMode;
  positions: BackingPosition[];
  rounds: (BackingRound & { owedYocto: string })[];
}

/** The backing-contract call a write asks the wallet to sign (near mode). */
export interface BackingWalletCall {
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
  depositYocto: string;
  gas: string;
}

export type BackingWrite<T> = T | { wallet: BackingWalletCall };

export interface OpenRoundBody {
  skillId?: string | null;
  shareBps: number;
  capMultipleBps: number;
  maxRaiseYocto: string;
}
