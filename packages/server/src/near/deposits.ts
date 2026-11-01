// Deposit verification for top-ups (contract `deposits.deposit()`): reads the tx through RPC,
// checks the receiver, signer and amount from the contract's NEP-297 `deposit` event. Dev mode
// accepts `dev:<yocto>[:<nonce>]` hashes. Each receipt is credited once by the ledger (unique index).
import type { NearRpc } from './rpc';
import { eventsOf, isSuccess, NearRpcError, type TxStatus } from './rpc';

export const YOCTO_PER_NEAR = 10n ** 24n;

export interface DepositVerification {
  /** Idempotency key for the ledger (the tx hash, or the full dev hash). */
  receipt: string;
  amountYocto: bigint;
  /** floor(amount · CREDITS_PER_NEAR / 10^24). */
  credits: number;
  /** NEAR account that signed the deposit. */
  sender: string;
  /** Receipt number the deposits contract assigned. */
  depositReceipt?: string;
  dev: boolean;
}

export type DepositErrorCode =
  | 'invalid_hash'
  | 'dev_disabled'
  | 'sender_required'
  | 'not_found'
  | 'failed'
  | 'wrong_receiver'
  | 'wrong_sender'
  | 'no_deposit'
  | 'too_small'
  | 'rpc_unavailable';

export class DepositError extends Error {
  constructor(
    readonly code: DepositErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DepositError';
  }
}

export interface DepositVerifier {
  verify(txHash: string, opts?: { senderId?: string | null }): Promise<DepositVerification>;
}

export function creditsForYocto(yocto: bigint, creditsPerNear: number): number {
  const c = (yocto * BigInt(creditsPerNear)) / YOCTO_PER_NEAR;
  if (c > BigInt(Number.MAX_SAFE_INTEGER))
    throw new DepositError('invalid_hash', 'deposit too large');
  return Number(c);
}

const DEV_RE = /^dev:([0-9]{1,40})(?::[A-Za-z0-9_-]{1,64})?$/;
const TX_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** `dev:<yocto>` or `dev:<yocto>:<nonce>`; trusted as is. */
export class DevDepositVerifier implements DepositVerifier {
  constructor(private readonly creditsPerNear: number) {}
  async verify(
    txHash: string,
    opts: { senderId?: string | null } = {},
  ): Promise<DepositVerification> {
    const m = DEV_RE.exec(txHash);
    if (!m) throw new DepositError('invalid_hash', 'dev deposits look like dev:<yocto>[:<nonce>]');
    const amountYocto = BigInt(m[1]!);
    const credits = creditsForYocto(amountYocto, this.creditsPerNear);
    if (credits < 1) throw new DepositError('too_small', 'deposit is worth less than one credit');
    return { receipt: txHash, amountYocto, credits, sender: opts.senderId ?? 'dev', dev: true };
  }
}

/** Reads the transaction with `EXPERIMENTAL_tx_status` (FastNEAR, then the fallback endpoint). */
export class RpcDepositVerifier implements DepositVerifier {
  constructor(
    private readonly rpc: NearRpc,
    private readonly depositsContract: string,
    private readonly creditsPerNear: number,
  ) {}

  async verify(
    txHash: string,
    opts: { senderId?: string | null } = {},
  ): Promise<DepositVerification> {
    if (!TX_RE.test(txHash)) throw new DepositError('invalid_hash', 'not a NEAR transaction hash');
    if (!opts.senderId)
      throw new DepositError('sender_required', 'link a NEAR account before topping up');
    let tx: TxStatus;
    try {
      tx = await this.rpc.txStatus(txHash, opts.senderId);
    } catch (err) {
      if (err instanceof NearRpcError && err.code === 'not_found')
        throw new DepositError('not_found', 'transaction not found');
      if (err instanceof NearRpcError && err.code === 'unavailable')
        throw new DepositError('rpc_unavailable', 'NEAR RPC is unavailable, try again');
      throw new DepositError('not_found', 'transaction could not be read');
    }
    if (tx.transaction.receiver_id !== this.depositsContract)
      throw new DepositError(
        'wrong_receiver',
        'transaction is not a deposit to the deposits contract',
      );
    if (tx.transaction.signer_id !== opts.senderId)
      throw new DepositError('wrong_sender', 'transaction was signed by another account');
    if (!isSuccess(tx.status)) throw new DepositError('failed', 'deposit transaction failed');

    const call = tx.transaction.actions
      .map((a) => (typeof a === 'object' ? a.FunctionCall : undefined))
      .find((f) => f?.method_name === 'deposit');
    if (!call) throw new DepositError('no_deposit', 'transaction does not call deposit()');

    const event = eventsOf(tx, 'skirm_deposits').find(
      (e) =>
        e.event === 'deposit' && (e.executor ?? this.depositsContract) === this.depositsContract,
    );
    const data = Array.isArray(event?.data)
      ? (event!.data[0] as Record<string, unknown> | undefined)
      : (event?.data as Record<string, unknown> | undefined);
    if (!data || typeof data.amount !== 'string')
      throw new DepositError('no_deposit', 'no deposit event in the transaction');
    if (data.player !== opts.senderId)
      throw new DepositError('wrong_sender', 'deposit credited another account');
    const amountYocto = BigInt(data.amount);
    if (BigInt(call.deposit) !== amountYocto)
      throw new DepositError('no_deposit', 'attached deposit does not match the event');
    const credits = creditsForYocto(amountYocto, this.creditsPerNear);
    if (credits < 1) throw new DepositError('too_small', 'deposit is worth less than one credit');
    const out: DepositVerification = {
      receipt: tx.transaction.hash || txHash,
      amountYocto,
      credits,
      sender: opts.senderId,
      dev: false,
    };
    if (data.receipt !== undefined) out.depositReceipt = String(data.receipt);
    return out;
  }
}

/** Routes `dev:` hashes to the dev verifier (when allowed) and everything else to RPC. */
export class CompositeDepositVerifier implements DepositVerifier {
  constructor(
    private readonly rpc: DepositVerifier,
    private readonly dev: DepositVerifier | undefined,
  ) {}
  verify(txHash: string, opts?: { senderId?: string | null }): Promise<DepositVerification> {
    if (txHash.startsWith('dev:')) {
      if (!this.dev)
        return Promise.reject(new DepositError('dev_disabled', 'dev deposits are disabled'));
      return this.dev.verify(txHash, opts);
    }
    return this.rpc.verify(txHash, opts);
  }
}
