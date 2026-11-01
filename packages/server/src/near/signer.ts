// Function calls signed with the platform `ops` function-call key (near-api-js 7).
import { Account, FailoverRpcProvider, JsonRpcProvider, type KeyPairString } from 'near-api-js';

export interface FunctionCallResult {
  txHash: string;
  /** Parsed SuccessValue, when the method returned JSON. */
  value?: unknown;
}

/** Signs and sends one function call; implemented by near-api-js, stubbed in tests. */
export interface FunctionCaller {
  call(
    contractId: string,
    methodName: string,
    args: Record<string, unknown>,
    gasTgas?: number,
  ): Promise<FunctionCallResult>;
}

export class NearCallError extends Error {
  constructor(
    message: string,
    readonly txHash?: string,
  ) {
    super(message);
    this.name = 'NearCallError';
  }
}

/** The part of a near-api-js `Account` the caller uses; a stub in tests. */
export type OpsAccount = Pick<Account, 'callFunctionRaw'>;

/** Resends after a nonce clash this many times. */
const NONCE_RETRIES = 2;

/**
 * Every call signs with the one ops key, whose nonce must rise by one per transaction. Calls in a
 * process run one at a time, so two of them never take the same nonce. A transaction rejected for
 * its nonce never ran (another process, such as the api, signed with the key first), so it is sent
 * again with a fresh nonce.
 */
export class OpsFunctionCaller implements FunctionCaller {
  private readonly account: OpsAccount;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opsAccountId: string, opsKey: string, rpcUrls: readonly string[]);
  constructor(account: OpsAccount);
  constructor(accountOrId: string | OpsAccount, opsKey?: string, rpcUrls: readonly string[] = []) {
    if (typeof accountOrId !== 'string') {
      this.account = accountOrId;
      return;
    }
    const providers = rpcUrls.map((url) => new JsonRpcProvider({ url }));
    const provider = providers.length > 1 ? new FailoverRpcProvider(providers) : providers[0]!;
    this.account = new Account(accountOrId, provider, opsKey as KeyPairString);
  }

  call(
    contractId: string,
    methodName: string,
    args: Record<string, unknown>,
    gasTgas = 100,
  ): Promise<FunctionCallResult> {
    const run = this.queue.then(() => this.send(contractId, methodName, args, gasTgas));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(
    contractId: string,
    methodName: string,
    args: Record<string, unknown>,
    gasTgas: number,
  ): Promise<FunctionCallResult> {
    let res: Awaited<ReturnType<Account['callFunctionRaw']>>;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.account.callFunctionRaw({
          contractId,
          methodName,
          args,
          gas: BigInt(gasTgas) * 10n ** 12n,
          deposit: 0n,
        });
        break;
      } catch (err) {
        const name = err instanceof Error ? err.name : 'error';
        if (name === 'InvalidNonceError' && attempt < NONCE_RETRIES) continue;
        // near-api-js errors can echo args; keep only the error type and method.
        throw new NearCallError(`${methodName} on ${contractId} failed (${name})`);
      }
    }
    const r = res as unknown as {
      status?: { SuccessValue?: string; Failure?: unknown };
      transaction?: { hash?: string };
      transaction_outcome?: { id?: string };
    };
    const txHash = r.transaction?.hash ?? r.transaction_outcome?.id ?? '';
    if (r.status && typeof r.status === 'object' && 'Failure' in r.status)
      throw new NearCallError(`${methodName} on ${contractId} failed onchain`, txHash);
    let value: unknown;
    const sv = r.status?.SuccessValue;
    if (sv) {
      try {
        value = JSON.parse(Buffer.from(sv, 'base64').toString('utf8'));
      } catch {
        value = undefined;
      }
    }
    return { txHash, ...(value !== undefined ? { value } : {}) };
  }
}
