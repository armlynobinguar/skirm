// Minimal NEAR JSON-RPC client over fetch, with endpoint fallback (FastNEAR first, then dRPC).
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class NearRpcError extends Error {
  constructor(
    readonly code: 'unavailable' | 'rpc_error' | 'not_found',
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NearRpcError';
  }
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    name?: string;
    cause?: { name?: string; info?: unknown };
    message?: string;
    data?: unknown;
    code?: number;
  };
}

export interface NearRpcOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class NearRpc {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    readonly urls: readonly string[],
    opts: NearRpcOptions = {},
  ) {
    if (urls.length === 0) throw new Error('NearRpc needs at least one URL');
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Calls `method` on each endpoint in turn until one answers. Errors name the method only. */
  async call<T>(method: string, params: unknown): Promise<T> {
    const failures: string[] = [];
    let lastRpcError: NearRpcError | undefined;
    for (const url of this.urls) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'skirm', method, params }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          failures.push(`${new URL(url).host}: HTTP ${res.status}`);
          continue;
        }
        const body = (await res.json()) as JsonRpcResponse<T>;
        if (body.error) {
          const name = body.error.cause?.name ?? body.error.name ?? 'RPC_ERROR';
          lastRpcError = new NearRpcError(
            name === 'UNKNOWN_TRANSACTION' || name === 'UNKNOWN_ACCOUNT'
              ? 'not_found'
              : 'rpc_error',
            `${method}: ${name}`,
            body.error,
          );
          // Another endpoint may be ahead (a tx not yet seen); try it before giving up.
          continue;
        }
        return body.result as T;
      } catch (err) {
        failures.push(`${safeHost(url)}: ${err instanceof Error ? err.name : 'error'}`);
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastRpcError) throw lastRpcError;
    throw new NearRpcError(
      'unavailable',
      `${method}: all RPC endpoints failed (${failures.join(', ')})`,
    );
  }

  /** View call; returns the JSON the contract returned (or undefined for no value). */
  async view<T>(
    contractId: string,
    methodName: string,
    args: unknown = {},
  ): Promise<T | undefined> {
    const res = await this.call<{ result?: number[] }>('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    });
    if (!res.result || res.result.length === 0) return undefined;
    const text = Buffer.from(res.result).toString('utf8');
    return text === '' ? undefined : (JSON.parse(text) as T);
  }

  /** Final transaction status with receipts (`EXPERIMENTAL_tx_status`). */
  async txStatus(txHash: string, senderId: string): Promise<TxStatus> {
    return this.call<TxStatus>('EXPERIMENTAL_tx_status', {
      tx_hash: txHash,
      sender_account_id: senderId,
      wait_until: 'FINAL',
    });
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'rpc';
  }
}

export interface TxAction {
  FunctionCall?: { method_name: string; args?: string; gas?: number | string; deposit: string };
  Transfer?: { deposit: string };
  [k: string]: unknown;
}

export interface ExecutionStatus {
  SuccessValue?: string;
  SuccessReceiptId?: string;
  Failure?: unknown;
  Unknown?: unknown;
}

export interface TxStatus {
  status: ExecutionStatus | string;
  transaction: {
    hash: string;
    signer_id: string;
    receiver_id: string;
    actions: (TxAction | string)[];
  };
  transaction_outcome: {
    id: string;
    outcome: { logs: string[]; status: ExecutionStatus | string };
  };
  receipts_outcome: {
    id: string;
    outcome: { logs: string[]; status: ExecutionStatus | string; executor_id?: string };
  }[];
}

/** NEP-297 events in a transaction's receipt logs (`EVENT_JSON:{…}`). */
export function eventsOf(
  tx: TxStatus,
  standard?: string,
): { standard: string; event: string; data?: unknown; executor?: string }[] {
  const out: { standard: string; event: string; data?: unknown; executor?: string }[] = [];
  for (const r of tx.receipts_outcome ?? []) {
    for (const log of r.outcome.logs ?? []) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      try {
        const ev = JSON.parse(log.slice('EVENT_JSON:'.length)) as {
          standard: string;
          event: string;
          data?: unknown;
        };
        if (!standard || ev.standard === standard) {
          const e: { standard: string; event: string; data?: unknown; executor?: string } = {
            ...ev,
          };
          if (r.outcome.executor_id !== undefined) e.executor = r.outcome.executor_id;
          out.push(e);
        }
      } catch {
        /* not an event */
      }
    }
  }
  return out;
}

export function isSuccess(status: ExecutionStatus | string | undefined): boolean {
  return (
    typeof status === 'object' &&
    status !== null &&
    ('SuccessValue' in status || 'SuccessReceiptId' in status)
  );
}

/**
 * A NEP-366 meta-transaction as `EXPERIMENTAL_tx_status` shows it: one `Delegate` action whose
 * `delegate_action` names the player (sender), the contract (receiver) and the player's actions.
 */
interface DelegateActionView {
  sender_id: string;
  receiver_id: string;
  actions: (TxAction | string)[];
}

/** Who made a transaction's call, to which contract, with which actions. */
export interface EffectiveCall {
  signerId: string;
  receiverId: string;
  actions: (TxAction | string)[];
  /** True when one of the trusted relayers sent it for the player (gasless onboarding). */
  relayed: boolean;
}

/**
 * The call a transaction makes. A plain transaction is its own call. A meta-transaction that one of
 * `relayers` (skirm's own relayer account, docs/gasless.md) sent is the call inside its delegate:
 * the player signed that, the relayer only paid the gas. Relayers outside the list are not
 * unwrapped, so their transactions keep failing the signer check exactly as before.
 */
export function effectiveCall(tx: TxStatus, relayers: readonly string[] = []): EffectiveCall {
  const t = tx.transaction;
  const plain: EffectiveCall = { signerId: t.signer_id, receiverId: t.receiver_id, actions: t.actions, relayed: false };
  if (!relayers.includes(t.signer_id) || t.actions.length !== 1) return plain;
  const a = t.actions[0];
  const d = typeof a === 'object' ? (a.Delegate as { delegate_action?: DelegateActionView } | undefined)?.delegate_action : undefined;
  // The relayer's transaction goes to the delegate's sender (NEP-366).
  if (!d || typeof d.sender_id !== 'string' || d.sender_id !== t.receiver_id || !Array.isArray(d.actions)) return plain;
  return { signerId: d.sender_id, receiverId: d.receiver_id, actions: d.actions, relayed: true };
}

/**
 * Did the call succeed? A plain transaction's status says so. A meta-transaction's own status only
 * says the delegate was accepted, so for a relayed call this looks at the receipts the contract
 * executed: at least one, and none failed.
 */
export function callSucceeded(tx: TxStatus, call: EffectiveCall): boolean {
  if (!call.relayed) return isSuccess(tx.status);
  const mine = (tx.receipts_outcome ?? []).filter((r) => r.outcome.executor_id === call.receiverId);
  return isSuccess(tx.status) && mine.length > 0 && mine.every((r) => isSuccess(r.outcome.status));
}

/**
 * `txStatus` that also finds a transaction a relayer signed: RPC looks a transaction up by its
 * signer, which for a relayed one is the relayer, not the player.
 */
export async function txStatusOf(
  rpc: Pick<NearRpc, 'txStatus'>,
  txHash: string,
  senderId: string,
  relayers: readonly string[] = [],
): Promise<TxStatus> {
  try {
    return await rpc.txStatus(txHash, senderId);
  } catch (err) {
    if (!(err instanceof NearRpcError) || err.code !== 'not_found' || relayers.length === 0) throw err;
    let last: unknown = err;
    for (const r of relayers) {
      if (r === senderId) continue;
      try {
        return await rpc.txStatus(txHash, r);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }
}
