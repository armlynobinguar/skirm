// Sealed-bid skill auctions on SkillAuction (packages/fhevm, Sepolia), behind NEXT_PUBLIC_ZAMA_ENABLED:
// the contract calls, the encrypt / decrypt steps and the pure helpers the Exchange's "Sealed auction
// 🔒" listings are built from.
//
// Seller: link the wallet's EVM address to the account (signed message), createAuction on chain,
// register it with the api so the Exchange shows it and grants the winner the version.
// Bidder: make SkillAuction a cSKIRM operator once, encrypt the amount in this tab, bid. The bid is
// a ciphertext: the page shows "N sealed bids" (a count) and the bidder can user-decrypt its own.
// After the end anyone closes it, public-decrypts the two outcome handles (winner index, price) and
// sends finalize; then every bidder's escrow comes back with refund (the winner gets bid - price).
import { SkillAuctionAbi } from '@skirm/fhevm/generated';
import { auctionStatus, evmLinkMessage, skillRefPreimage, withFreshKmsProof, type AuctionStatus } from '@skirm/shared';
import { Contract, ZeroAddress, id as keccakUtf8, type ContractRunner } from 'ethers';
import { zamaConfig, type HexAddress } from '@/lib/zama/config';
import { isZeroHandle, publicDecrypt, userDecryptUint, type EncryptedInput, type Hex, type TypedDataSigner } from '@/lib/zama/fhe';
import { ZamaWalletError } from '@/lib/zama/wallet';
import { trackTx } from '@/lib/zama/steps';

/** Durations the seller can pick (seconds; the contract takes 1 minute to 30 days). */
export const AUCTION_DURATIONS = [
  { label: '10 minutes', seconds: 10 * 60 },
  { label: '1 hour', seconds: 60 * 60 },
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '3 days', seconds: 3 * 24 * 60 * 60 },
] as const;

/** How often an auction card re-reads the chain. */
export const AUCTION_POLL_MS = 10_000;

/** The SkillAuction address, or a not_deployed error. */
export function auctionAddress(): HexAddress {
  const address = zamaConfig.contracts.auction;
  if (!address) {
    throw new ZamaWalletError('not_deployed', 'SkillAuction is not deployed yet: deploy packages/fhevm to Sepolia or set NEXT_PUBLIC_ZAMA_AUCTION_ADDRESS.');
  }
  return address;
}

/** The skill version's on-chain reference (the api and the worker compute the same). */
export function auctionSkillRef(skillId: string, version: number): Hex {
  return keccakUtf8(skillRefPreimage(skillId, version)) as Hex;
}

/** SkillAuction.getAuction, as the web reads it (addresses lower-case). */
export interface ChainAuction {
  seller: string;
  skillRef: Hex;
  /** Unix seconds. */
  endTime: number;
  status: AuctionStatus;
  feeBps: number;
  reserveEncrypted: boolean;
  /** Public reserve in base units (0 when encrypted or none). */
  reserve: bigint;
  /** Distinct bidders: the only thing the page can show about the bids. */
  bidders: number;
  /** Zero address until won. */
  winner: string;
  /** Clearing price in base units (0 until won). */
  price: bigint;
}

type Tx = { hash: string; wait: () => Promise<{ logs?: readonly unknown[] } | null> };

/** The SkillAuction calls the Exchange needs (an interface, so tests fake the chain). */
export interface AuctionApi {
  get(auctionId: bigint): Promise<ChainAuction>;
  /** The caller's escrow total handle (zero if it never bid). */
  bidOf(auctionId: bigint, bidder: string): Promise<Hex>;
  refunded(auctionId: bigint, bidder: string): Promise<boolean>;
  revealHandles(auctionId: bigint): Promise<[Hex, Hex]>;
  /** Creates the auction; resolves with its id (from the AuctionCreated event). */
  create(skillRef: Hex, endTime: number, reserve: bigint | EncryptedInput): Promise<bigint>;
  bid(auctionId: bigint, amount: EncryptedInput): Promise<string>;
  close(auctionId: bigint): Promise<string>;
  finalize(auctionId: bigint, abiEncodedClearValues: Hex, decryptionProof: Hex): Promise<string>;
  refund(auctionId: bigint, bidder: string): Promise<string>;
}

/** getAuction's tuple as ChainAuction. */
export function parseAuction(a: {
  seller: string;
  skillRef: string;
  endTime: bigint;
  status: bigint;
  feeBps: bigint;
  reserveEncrypted: boolean;
  reserve: bigint;
  bidders: bigint;
  winner: string;
  price: bigint;
}): ChainAuction {
  return {
    seller: String(a.seller).toLowerCase(),
    skillRef: String(a.skillRef).toLowerCase() as Hex,
    endTime: Number(a.endTime),
    status: auctionStatus(a.status),
    feeBps: Number(a.feeBps),
    reserveEncrypted: !!a.reserveEncrypted,
    reserve: BigInt(a.reserve),
    bidders: Number(a.bidders),
    winner: String(a.winner).toLowerCase(),
    price: BigInt(a.price),
  };
}

/** SkillAuction through ethers: reads on `runner`, writes signed by it (a JsonRpcSigner). */
export function auctionApi(runner: ContractRunner, address: string = auctionAddress()): AuctionApi {
  const c = new Contract(address, SkillAuctionAbi, runner);
  const send = async (fn: string, ...args: unknown[]) => {
    const { tx } = await trackTx(() => c.getFunction(fn)(...args) as Promise<Tx>);
    return tx.hash;
  };
  return {
    get: async (id) => parseAuction(await c.getFunction('getAuction')(id)),
    bidOf: async (id, bidder) => (await c.getFunction('bidOf')(id, bidder)) as Hex,
    refunded: async (id, bidder) => (await c.getFunction('refunded')(id, bidder)) as boolean,
    revealHandles: async (id) => {
      const h = (await c.getFunction('revealHandles')(id)) as string[];
      return [h[0] as Hex, h[1] as Hex];
    },
    async create(skillRef, endTime, reserve) {
      const { receipt } = await trackTx(
        () =>
          (typeof reserve === 'bigint'
            ? c.getFunction('createAuction')(skillRef, endTime, reserve)
            : c.getFunction('createAuctionSealedReserve')(skillRef, endTime, reserve.handle, reserve.inputProof)) as Promise<Tx>,
      );
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = c.interface.parseLog(log as { topics: string[]; data: string });
          if (parsed?.name === 'AuctionCreated') return BigInt(parsed.args[0] as bigint);
        } catch {
          // Another contract's log (the token's): skip it.
        }
      }
      throw new Error('The auction was created but its id was not found in the receipt.');
    },
    bid: (id, amount) => send('bid', id, amount.handle, amount.inputProof),
    close: (id) => send('close', id),
    finalize: (id, values, proof) => send('finalize', id, values, proof),
    refund: (id, bidder) => send('refund', id, bidder),
  };
}

/** What a viewer sees of an auction right now. */
export type AuctionPhase =
  /** Bids are open. */
  | 'bidding'
  /** Past its end, nobody closed it yet. */
  | 'ended'
  /** Closed; the outcome waits for its KMS-checked finalize. */
  | 'closing'
  | 'won'
  | 'failed';

export function auctionPhase(a: Pick<ChainAuction, 'status' | 'endTime'>, nowSec: number): AuctionPhase {
  if (a.status === 'won' || a.status === 'failed' || a.status === 'closing') return a.status;
  return nowSec < a.endTime ? 'bidding' : 'ended';
}

/** "2d 4h", "3h 05m", "4m 09s", "ended". */
export function countdown(endTime: number, nowSec: number): string {
  const left = endTime - nowSec;
  if (left <= 0) return 'ended';
  const d = Math.floor(left / 86_400);
  const h = Math.floor((left % 86_400) / 3_600);
  const m = Math.floor((left % 3_600) / 60);
  const s = left % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** "1 sealed bid", "3 sealed bids", "No bids yet". */
export function sealedBidsLabel(n: number): string {
  if (n === 0) return 'No bids yet';
  return `${n} sealed bid${n === 1 ? '' : 's'}`;
}

/** The viewer's role once the auction is over. */
export type AuctionRole = 'winner' | 'loser' | 'seller' | 'viewer';

export function roleOf(a: Pick<ChainAuction, 'seller' | 'winner' | 'status'>, address: string | null, hasBid: boolean): AuctionRole {
  const me = address?.toLowerCase() ?? null;
  if (me && me === a.seller) return 'seller';
  if (me && a.status === 'won' && me === a.winner) return 'winner';
  if (hasBid) return 'loser';
  return 'viewer';
}

/** Whether a winner was named (the zero address means nobody). */
export const hasWinner = (a: Pick<ChainAuction, 'winner'>) => a.winner !== ZeroAddress.toLowerCase();

/**
 * Closes an ended auction if nobody did yet, then finalizes it with the KMS-signed outcome. Whoever
 * gets there first does it; a second caller's transaction reverts harmlessly, so this re-reads first.
 */
export async function closeAndFinalize(api: AuctionApi, instance: Parameters<typeof publicDecrypt>[0], auctionId: bigint): Promise<ChainAuction> {
  let a = await api.get(auctionId);
  if (a.status === 'open') {
    await api.close(auctionId);
    a = await api.get(auctionId);
  }
  if (a.status === 'closing') {
    const handles = await api.revealHandles(auctionId);
    // A rejected KMS proof (KMSInvalidSigner) is fetched again and resent.
    await withFreshKmsProof(
      () => publicDecrypt(instance, handles),
      (res) => api.finalize(auctionId, res.abiEncodedClearValues, res.decryptionProof),
    );
    a = await api.get(auctionId);
  }
  return a;
}

/** User-decrypts the caller's own sealed bid (null if it never bid). Only the bidder holds access. */
export async function revealMyBid(
  instance: Parameters<typeof userDecryptUint>[0],
  signer: TypedDataSigner,
  api: AuctionApi,
  contract: string,
  auctionId: bigint,
): Promise<bigint | null> {
  const handle = await api.bidOf(auctionId, await signer.getAddress());
  if (isZeroHandle(handle)) return null;
  return userDecryptUint(instance, signer, { handle, contractAddress: contract });
}

/** What the EVM link asks the wallet to sign (personal_sign). */
export function linkMessage(accountId: string, address: string): string {
  return evmLinkMessage(accountId, address);
}
