// The relayer behind gasless onboarding (NEP-366, docs/gasless.md): wraps a player's SignedDelegate
// in a transaction signed by the relayer account (RELAYER_ACCOUNT_ID / RELAYER_PRIVATE_KEY), which
// pays the gas. The player's attached deposits still come from the player's own account.
//
// MetaTxRelayer is the interface the api uses; NearMetaTxRelayer implements it with near-api-js 7
// and the shared NearRpc. Tests use a fake (apps/api/test/relay.test.ts). What may be relayed at all
// (receivers, methods, gas, quota) is the api's call (apps/api/src/relay.ts); this file only sends.
//
// The private key lives inside the near-api-js Account only: it is never logged, returned or put
// into an error message.
import {
  Account,
  DelegateAction,
  FailoverRpcProvider,
  JsonRpcProvider,
  KeyType,
  PublicKey,
  Signature,
  actions,
  type KeyPairString,
} from 'near-api-js';
import type { DecodedSignedDelegate } from './delegate';
import { NearRpcError, type NearRpc } from './rpc';

export type RelayErrorCode = 'rpc_unavailable' | 'relay_failed';

export class RelayError extends Error {
  constructor(
    readonly code: RelayErrorCode,
    message: string,
    /** Set when the relayer's transaction reached the chain (it then cost the relayer gas). */
    readonly txHash?: string,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

export interface MetaTxRelayer {
  /** The account that signs the outer transaction and pays its gas. */
  readonly relayerId: string;
  /** Height of the latest final block. RelayError `rpc_unavailable` when RPC does not answer. */
  blockHeight(): Promise<bigint>;
  /**
   * The nonce of `publicKey` on `accountId`, or null when it is not one of the account's keys.
   * RelayError `rpc_unavailable` when RPC does not answer.
   */
  accessKeyNonce(accountId: string, publicKey: string): Promise<bigint | null>;
  /** Sends the delegate from the relayer; resolves with the relayer transaction's hash. */
  relay(d: DecodedSignedDelegate): Promise<{ txHash: string }>;
}

/** The decoded delegate as near-api-js objects (byte-identical once borsh-encoded again). */
export function toNearApiSignedDelegate(d: DecodedSignedDelegate) {
  const delegateAction = new DelegateAction({
    senderId: d.senderId,
    receiverId: d.receiverId,
    actions: d.actions.map((a) => actions.functionCall(a.methodName, a.args, a.gas, a.deposit)),
    nonce: d.nonce,
    maxBlockHeight: d.maxBlockHeight,
    publicKey: PublicKey.fromString(d.publicKey),
  });
  const signature = new Signature({ keyType: KeyType.ED25519, data: d.signature });
  return { delegateAction, signature };
}

/** The part of a near-api-js Account the relayer uses; a stub in tests. */
export type RelayerAccount = Pick<Account, 'signAndSendTransaction'>;

const NONCE_RETRIES = 2;

export class NearMetaTxRelayer implements MetaTxRelayer {
  private readonly account: RelayerAccount;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly relayerId: string,
    relayerKey: string | RelayerAccount,
    private readonly rpc: Pick<NearRpc, 'call' | 'urls'>,
  ) {
    if (typeof relayerKey !== 'string') {
      this.account = relayerKey;
      return;
    }
    const providers = rpc.urls.map((url) => new JsonRpcProvider({ url }));
    const provider = providers.length > 1 ? new FailoverRpcProvider(providers) : providers[0]!;
    this.account = new Account(relayerId, provider, relayerKey as KeyPairString);
  }

  async blockHeight(): Promise<bigint> {
    try {
      const b = await this.rpc.call<{ header: { height: number | string } }>('block', { finality: 'final' });
      return BigInt(b.header.height);
    } catch {
      throw new RelayError('rpc_unavailable', 'NEAR RPC is unavailable, try again');
    }
  }

  async accessKeyNonce(accountId: string, publicKey: string): Promise<bigint | null> {
    try {
      const k = await this.rpc.call<{ nonce: number | string }>('query', {
        request_type: 'view_access_key',
        finality: 'final',
        account_id: accountId,
        public_key: publicKey,
      });
      return BigInt(k.nonce);
    } catch (err) {
      // UNKNOWN_ACCESS_KEY / UNKNOWN_ACCOUNT come back as RPC errors: not a key of the account.
      if (err instanceof NearRpcError && err.code !== 'unavailable') return null;
      throw new RelayError('rpc_unavailable', 'NEAR RPC is unavailable, try again');
    }
  }

  /** One relayer transaction at a time: they share the relayer key's nonce. */
  relay(d: DecodedSignedDelegate): Promise<{ txHash: string }> {
    const run = this.queue.then(() => this.send(d));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(d: DecodedSignedDelegate): Promise<{ txHash: string }> {
    const signed = toNearApiSignedDelegate(d);
    let res: Awaited<ReturnType<Account['signAndSendTransaction']>>;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.account.signAndSendTransaction({
          receiverId: d.senderId,
          actions: [actions.signedDelegate(signed)],
          waitUntil: 'EXECUTED_OPTIMISTIC',
          throwOnFailure: false,
        });
        break;
      } catch (err) {
        const name = err instanceof Error ? err.name : 'error';
        if (name === 'InvalidNonceError' && attempt < NONCE_RETRIES) continue;
        // near-api-js errors can echo the transaction; keep only the error type.
        throw new RelayError('relay_failed', `relaying to ${d.receiverId} failed (${name})`);
      }
    }
    const r = res as unknown as {
      status?: { Failure?: unknown };
      transaction?: { hash?: string };
      transaction_outcome?: { id?: string };
    };
    const txHash = r.transaction?.hash ?? r.transaction_outcome?.id ?? '';
    if (!txHash) throw new RelayError('relay_failed', 'the relayed transaction has no hash');
    if (r.status && typeof r.status === 'object' && 'Failure' in r.status)
      throw new RelayError('relay_failed', `relayed call to ${d.receiverId} failed onchain`, txHash);
    return { txHash };
  }
}
