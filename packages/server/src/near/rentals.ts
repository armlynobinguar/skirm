// Rental payment verification (contract `market.rent(rental_id, owner_id, price)`): reads the tx
// through RPC, checks the receiver, signer and success, and returns the market's NEP-297 `rental`
// event. The caller matches it to its own offer (rental id, owner, price). Dev mode accepts
// `dev:<yocto>[:<nonce>]` hashes, split at the default platform fee.
import type { NearRpc } from './rpc';
import { eventsOf, isSuccess, NearRpcError, type TxStatus } from './rpc';

/** The market's default platform fee (contracts/market DEFAULT_FEE_BPS), used for dev rentals. */
export const RENTAL_DEV_FEE_BPS = 500n;

/**
 * A rental paid in credits (NEAR_RENTALS_ONCHAIN off): the yocto price at `creditsPerNear`, rounded
 * up to whole credits (at least 1); the platform fee (rounded down) is burned, the owner gets the rest.
 */
export function rentalCredits(
  priceYocto: bigint,
  creditsPerNear: number,
): { priceCredits: number; feeCredits: number; ownerCredits: number } {
  const ONE_NEAR = 10n ** 24n;
  const scaled = priceYocto * BigInt(creditsPerNear);
  const priceCredits = Number(scaled / ONE_NEAR + (scaled % ONE_NEAR > 0n ? 1n : 0n)) || 1;
  const feeCredits = Number((BigInt(priceCredits) * RENTAL_DEV_FEE_BPS) / 10_000n);
  return { priceCredits, feeCredits, ownerCredits: priceCredits - feeCredits };
}

export interface RentalPayment {
  /** Idempotency key (the tx hash, or the full dev hash). */
  receipt: string;
  rentalId: string;
  /** NEAR account paid (the agent's owner). */
  owner: string;
  /** NEAR account that paid. */
  renter: string;
  priceYocto: bigint;
  feeYocto: bigint;
  ownerProceedsYocto: bigint;
  dev: boolean;
}

export type RentalErrorCode =
  | 'invalid_hash'
  | 'dev_disabled'
  | 'renter_required'
  | 'not_found'
  | 'failed'
  | 'wrong_receiver'
  | 'wrong_sender'
  | 'no_rental'
  | 'rpc_unavailable';

export class RentalError extends Error {
  constructor(
    readonly code: RentalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RentalError';
  }
}

export interface RentalVerifier {
  /** `renterId`: the payer's linked NEAR account (dev mode: any). */
  verify(txHash: string, opts: { renterId?: string | null }): Promise<RentalPayment>;
}

const DEV_RE = /^dev:([0-9]{1,40})(?::[A-Za-z0-9_-]{1,64})?$/;
const TX_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** Trusted as is: `dev:<yocto>` pays that price, 5% fee, the rest to the owner. */
export class DevRentalVerifier implements RentalVerifier {
  async verify(txHash: string, opts: { renterId?: string | null }): Promise<RentalPayment> {
    const m = DEV_RE.exec(txHash);
    if (!m) throw new RentalError('invalid_hash', 'dev rentals look like dev:<yocto>[:<nonce>]');
    const priceYocto = BigInt(m[1]!);
    if (priceYocto <= 0n) throw new RentalError('no_rental', 'a rental must pay something');
    const feeYocto = (priceYocto * RENTAL_DEV_FEE_BPS) / 10_000n;
    return {
      receipt: txHash,
      rentalId: '',
      owner: '',
      renter: opts.renterId ?? 'dev',
      priceYocto,
      feeYocto,
      ownerProceedsYocto: priceYocto - feeYocto,
      dev: true,
    };
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** Reads the transaction with `EXPERIMENTAL_tx_status`. */
export class RpcRentalVerifier implements RentalVerifier {
  constructor(
    private readonly rpc: NearRpc,
    private readonly marketContract: string,
  ) {}

  async verify(txHash: string, opts: { renterId?: string | null }): Promise<RentalPayment> {
    if (!TX_RE.test(txHash)) throw new RentalError('invalid_hash', 'not a NEAR transaction hash');
    if (!opts.renterId) throw new RentalError('renter_required', 'link a NEAR account to rent');
    let tx: TxStatus;
    try {
      tx = await this.rpc.txStatus(txHash, opts.renterId);
    } catch (err) {
      if (err instanceof NearRpcError && err.code === 'not_found')
        throw new RentalError('not_found', 'transaction not found');
      if (err instanceof NearRpcError && err.code === 'unavailable')
        throw new RentalError('rpc_unavailable', 'NEAR RPC is unavailable, try again');
      throw new RentalError('not_found', 'transaction could not be read');
    }
    if (tx.transaction.receiver_id !== this.marketContract)
      throw new RentalError('wrong_receiver', 'transaction is not a rental on the market contract');
    if (tx.transaction.signer_id !== opts.renterId)
      throw new RentalError('wrong_sender', 'transaction was signed by another account');
    if (!isSuccess(tx.status)) throw new RentalError('failed', 'rental transaction failed');

    // Only the market's own event counts: another contract in the tx could log a lookalike, so a
    // receipt without an executor is not trusted either.
    const event = eventsOf(tx, 'skirm_market').find((e) => e.event === 'rental' && e.executor === this.marketContract);
    const data = Array.isArray(event?.data)
      ? (event!.data[0] as Record<string, unknown> | undefined)
      : (event?.data as Record<string, unknown> | undefined);
    const rentalId = str(data?.rental_id);
    const owner = str(data?.owner);
    const renter = str(data?.renter);
    const price = str(data?.price);
    const fee = str(data?.fee);
    const proceeds = str(data?.owner_proceeds);
    if (!rentalId || !owner || !renter || !price || !fee || !proceeds || ![price, fee, proceeds].every((v) => /^[0-9]{1,40}$/.test(v)))
      throw new RentalError('no_rental', 'no rental event in the transaction');
    if (renter !== opts.renterId) throw new RentalError('wrong_sender', 'rental paid by another account');
    const priceYocto = BigInt(price);
    const feeYocto = BigInt(fee);
    const ownerProceedsYocto = BigInt(proceeds);
    if (feeYocto + ownerProceedsYocto !== priceYocto)
      throw new RentalError('no_rental', 'rental event amounts do not add up');
    return { receipt: tx.transaction.hash || txHash, rentalId, owner, renter, priceYocto, feeYocto, ownerProceedsYocto, dev: false };
  }
}

/** Routes `dev:` hashes to the dev verifier (when allowed) and everything else to RPC. */
export class CompositeRentalVerifier implements RentalVerifier {
  constructor(
    private readonly rpc: RentalVerifier,
    private readonly dev: RentalVerifier | undefined,
  ) {}
  verify(txHash: string, opts: { renterId?: string | null }): Promise<RentalPayment> {
    if (txHash.startsWith('dev:')) {
      if (!this.dev) return Promise.reject(new RentalError('dev_disabled', 'dev rentals are disabled'));
      return this.dev.verify(txHash, opts);
    }
    return this.rpc.verify(txHash, opts);
  }
}
