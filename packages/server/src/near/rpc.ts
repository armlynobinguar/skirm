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
