// Writer backing transactions (contracts/backing): reads a tx a player signed against the backing
// contract through RPC, checks the receiver, signer and success, and returns the contract's own
// NEP-297 `skirm_backing` events (round_opened, backed, round_closed, round_cancelled,
// royalty_distributed, claimed, refunded). The api mirrors them into its tables.
import type { NearRpc } from './rpc';
import { eventsOf, isSuccess, NearRpcError, type TxStatus } from './rpc';

export const BACKING_EVENT_STANDARD = 'skirm_backing';

export type BackingEventKind =
  | 'round_opened'
  | 'backed'
  | 'round_closed'
  | 'round_cancelled'
  | 'royalty_distributed'
  | 'claimed'
  | 'refunded';

export interface BackingEvent {
  event: BackingEventKind;
  data: Record<string, unknown>;
}

export interface BackingTx {
  /** The tx hash (idempotency key for payouts). */
  hash: string;
  signer: string;
  events: BackingEvent[];
}

export type BackingTxErrorCode =
  | 'invalid_hash'
  | 'signer_required'
  | 'not_found'
  | 'failed'
  | 'wrong_receiver'
  | 'wrong_sender'
  | 'no_events'
  | 'rpc_unavailable';

export class BackingTxError extends Error {
  constructor(
    readonly code: BackingTxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackingTxError';
  }
}

export interface BackingTxReader {
  readonly contractId: string;
  /** `signerId`: the caller's linked NEAR account, which must have signed the tx. */
  read(txHash: string, signerId: string | null | undefined): Promise<BackingTx>;
}

const TX_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const KINDS = new Set<string>([
  'round_opened',
  'backed',
  'round_closed',
  'round_cancelled',
  'royalty_distributed',
  'claimed',
  'refunded',
]);

/** Reads the transaction with `EXPERIMENTAL_tx_status`. */
export class RpcBackingTxReader implements BackingTxReader {
  constructor(
    private readonly rpc: NearRpc,
    readonly contractId: string,
  ) {}

  async read(txHash: string, signerId: string | null | undefined): Promise<BackingTx> {
    if (!TX_RE.test(txHash)) throw new BackingTxError('invalid_hash', 'not a NEAR transaction hash');
    if (!signerId) throw new BackingTxError('signer_required', 'link a NEAR account first');
    let tx: TxStatus;
    try {
      tx = await this.rpc.txStatus(txHash, signerId);
    } catch (err) {
      if (err instanceof NearRpcError && err.code === 'unavailable')
        throw new BackingTxError('rpc_unavailable', 'NEAR RPC is unavailable, try again');
      throw new BackingTxError('not_found', 'transaction not found');
    }
    if (tx.transaction.receiver_id !== this.contractId)
      throw new BackingTxError('wrong_receiver', 'transaction is not a call on the backing contract');
    if (tx.transaction.signer_id !== signerId)
      throw new BackingTxError('wrong_sender', 'transaction was signed by another account');
    if (!isSuccess(tx.status)) throw new BackingTxError('failed', 'the transaction failed');
    // Only the backing contract's own events count (another contract could log a lookalike).
    const events: BackingEvent[] = [];
    for (const e of eventsOf(tx, BACKING_EVENT_STANDARD)) {
      if ((e.executor ?? this.contractId) !== this.contractId || !KINDS.has(e.event)) continue;
      const data = Array.isArray(e.data) ? e.data[0] : e.data;
      if (data && typeof data === 'object') events.push({ event: e.event as BackingEventKind, data: data as Record<string, unknown> });
    }
    if (!events.length) throw new BackingTxError('no_events', 'no backing event in the transaction');
    return { hash: tx.transaction.hash || txHash, signer: signerId, events };
  }
}
