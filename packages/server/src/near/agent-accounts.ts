// Agent accounts (docs/agent-accounts.md): each agent can get its own NEAR account,
// `<agent id>.<AGENT_ACCOUNTS_PARENT>`, that pays for things by itself (agent rentals through
// `market.rent`). CUSTODIAL by design: `market.rent` is payable and function-call access keys
// cannot attach a deposit, so the agent account needs a full-access key, and the server creates and
// holds it (sealed with the vault's KEK, opened only to sign). The owner funds the account with a
// plain transfer from their wallet and can withdraw the rest to their linked account.
//
// The chain side sits behind AgentAccountsChain: NearAgentAccounts (near-api-js, the parent account
// signs the creation, each agent account signs its own spends) and MemoryAgentAccounts (tests and
// local runs: balances in memory, nothing goes onchain). Keys are only ever passed in, never
// logged, and errors carry no arguments or key material.
import {
  Account,
  FailoverRpcProvider,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
} from 'near-api-js';
import { createHash } from 'node:crypto';
import type { NearRpc } from './rpc';
import { NearRpcError, eventsOf, type TxStatus } from './rpc';

const ONE_NEAR = 10n ** 24n;
/** What the parent sends a new agent account so it can pay for its own storage. */
export const AGENT_ACCOUNT_INITIAL_YOCTO = ONE_NEAR / 100n; // 0.01 NEAR
/** Kept back from withdrawals and spends for gas. */
export const AGENT_ACCOUNT_GAS_RESERVE_YOCTO = ONE_NEAR / 100n; // 0.01 NEAR
/** Storage staking cost on NEAR: 10^19 yocto per byte. */
const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
/** Gas `market.rent` gets, as the web sends it. */
const RENT_GAS = 60n * 10n ** 12n;

/**
 * The agent's account id under `parent`: the agent id lowercased with `_` as `-`
 * (`agt_01JB…` → `agt-01jb….agents.playskirm.testnet`). NEAR account ids are lowercase.
 */
export function agentAccountIdFor(agentId: string, parent: string): string {
  const safe = agentId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) throw new Error('agent id has no usable characters');
  const id = `${safe}.${parent}`;
  if (id.length > 64) throw new Error('agent account id is longer than 64 characters');
  return id;
}

/** A fresh ed25519 key pair for a new agent account. The secret goes straight into the vault. */
export function newAgentKeyPair(): { publicKey: string; secretKey: string } {
  const kp = KeyPair.fromRandom('ed25519');
  return { publicKey: kp.getPublicKey().toString(), secretKey: kp.toString() };
}

/** An agent account's balance as the chain reports it. */
export interface AgentAccountBalance {
  /** Liquid balance (`amount`). */
  totalYocto: bigint;
  /** Locked for storage plus the gas reserve: never spent or withdrawn. */
  reservedYocto: bigint;
}

/** `totalYocto - reservedYocto`, never below 0. */
export const spendableOf = (b: AgentAccountBalance) =>
  b.totalYocto > b.reservedYocto ? b.totalYocto - b.reservedYocto : 0n;

/** The agent account that signs: its id and its full-access secret key (from the vault). */
export interface AgentSigner {
  accountId: string;
  secretKey: string;
}

export interface AgentRentArgs {
  marketContract: string;
  /** `<offer id>:<nonce>`, 1–96 bytes. */
  rentalId: string;
  /** The rented agent's owner's NEAR account. */
  ownerId: string;
  priceYocto: bigint;
}

export interface AgentRentResult {
  txHash: string;
  /** From the market's `rental` event. */
  feeYocto: bigint;
  ownerProceedsYocto: bigint;
}

export type AgentAccountErrorCode = 'exists' | 'not_found' | 'failed' | 'unavailable';

export class AgentAccountError extends Error {
  constructor(
    readonly code: AgentAccountErrorCode,
    message: string,
    /** Set when a transaction reached the chain (it may still have failed). */
    readonly txHash?: string,
  ) {
    super(message);
    this.name = 'AgentAccountError';
  }
}

export interface AgentAccountsChain {
  readonly kind: 'near' | 'memory';
  /** The parent account new agent accounts are created under. */
  readonly parent: string;
  /** Creates `accountId` with `publicKey` as its full-access key, funded by the parent. */
  create(accountId: string, publicKey: string): Promise<{ txHash: string }>;
  /** The account's balance, or null when it does not exist. */
  balance(accountId: string): Promise<AgentAccountBalance | null>;
  /** `market.rent` signed by the agent account, attaching the price. */
  rent(signer: AgentSigner, args: AgentRentArgs): Promise<AgentRentResult>;
  /** A plain NEAR transfer signed by the agent account. */
  transfer(signer: AgentSigner, receiverId: string, amountYocto: bigint): Promise<{ txHash: string }>;
}

const fakeHash = (...parts: string[]) =>
  `mem:${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 44)}`;

/**
 * In-memory chain for tests and local runs: accounts are rows in a map, transfers move numbers,
 * `rent` takes the default 5% fee. Records the public key each account was created with, so a test
 * can check a signer used the right key; never prints anything.
 */
export class MemoryAgentAccounts implements AgentAccountsChain {
  readonly kind = 'memory' as const;
  readonly accounts = new Map<string, { publicKey: string; balance: bigint }>();
  /** Outgoing payments, in order. */
  readonly sent: { from: string; to: string; amountYocto: bigint; method: 'rent' | 'transfer'; rentalId?: string }[] = [];
  /** Set to make the next call of that kind fail onchain. */
  failNext: 'rent' | 'transfer' | 'create' | null = null;
  private n = 0;

  constructor(readonly parent = 'agents.skirm.testnet') {}

  /** Test helper: the owner's wallet transfer into an agent account. */
  fund(accountId: string, amountYocto: bigint): void {
    const a = this.accounts.get(accountId);
    if (!a) throw new AgentAccountError('not_found', 'no such agent account');
    a.balance += amountYocto;
  }

  private checkSigner(signer: AgentSigner) {
    const a = this.accounts.get(signer.accountId);
    if (!a) throw new AgentAccountError('not_found', 'no such agent account');
    let pub: string;
    try {
      pub = KeyPair.fromString(signer.secretKey as KeyPairString).getPublicKey().toString();
    } catch {
      throw new AgentAccountError('failed', 'the agent key is not valid');
    }
    if (pub !== a.publicKey) throw new AgentAccountError('failed', 'the agent key does not control this account');
    return a;
  }

  private takeFailure(kind: 'rent' | 'transfer' | 'create'): boolean {
    if (this.failNext !== kind) return false;
    this.failNext = null;
    return true;
  }

  async create(accountId: string, publicKey: string): Promise<{ txHash: string }> {
    if (this.takeFailure('create')) throw new AgentAccountError('failed', 'account creation failed');
    if (this.accounts.has(accountId)) throw new AgentAccountError('exists', 'the account already exists');
    this.accounts.set(accountId, { publicKey, balance: AGENT_ACCOUNT_INITIAL_YOCTO });
    return { txHash: fakeHash('create', accountId, String(this.n++)) };
  }

  async balance(accountId: string): Promise<AgentAccountBalance | null> {
    const a = this.accounts.get(accountId);
    if (!a) return null;
    // ~182 bytes of storage for an account with one key, as on NEAR.
    return { totalYocto: a.balance, reservedYocto: 182n * STORAGE_YOCTO_PER_BYTE + AGENT_ACCOUNT_GAS_RESERVE_YOCTO };
  }

  async rent(signer: AgentSigner, args: AgentRentArgs): Promise<AgentRentResult> {
    const a = this.checkSigner(signer);
    const txHash = fakeHash('rent', signer.accountId, args.rentalId, String(this.n++));
    if (this.takeFailure('rent')) throw new AgentAccountError('failed', 'rent failed onchain', txHash);
    if (a.balance < args.priceYocto) throw new AgentAccountError('failed', 'not enough balance', txHash);
    a.balance -= args.priceYocto;
    this.sent.push({ from: signer.accountId, to: args.ownerId, amountYocto: args.priceYocto, method: 'rent', rentalId: args.rentalId });
    const feeYocto = (args.priceYocto * 500n) / 10_000n;
    return { txHash, feeYocto, ownerProceedsYocto: args.priceYocto - feeYocto };
  }

  async transfer(signer: AgentSigner, receiverId: string, amountYocto: bigint): Promise<{ txHash: string }> {
    const a = this.checkSigner(signer);
    const txHash = fakeHash('transfer', signer.accountId, receiverId, String(this.n++));
    if (this.takeFailure('transfer')) throw new AgentAccountError('failed', 'transfer failed onchain', txHash);
    if (a.balance < amountYocto) throw new AgentAccountError('failed', 'not enough balance', txHash);
    a.balance -= amountYocto;
    this.sent.push({ from: signer.accountId, to: receiverId, amountYocto, method: 'transfer' });
    return { txHash };
  }
}

/** The part of a near-api-js `Account` used here; stubbed in tests. */
export type AgentNearAccount = Pick<Account, 'createAccount' | 'callFunctionRaw' | 'transfer'>;

/** Builds a near-api-js account that signs with `secretKey` (an agent's, or the parent's). */
export type AgentAccountFactory = (accountId: string, secretKey: string) => AgentNearAccount;

interface TxOutcome {
  status?: { SuccessValue?: string; Failure?: unknown } | string;
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
}

const hashOf = (r: TxOutcome) => r.transaction?.hash ?? r.transaction_outcome?.id ?? '';
const failed = (r: TxOutcome) => typeof r.status === 'object' && r.status !== null && 'Failure' in r.status;

/**
 * near-api-js 7. The parent account (AGENT_ACCOUNTS_PARENT / _KEY) signs account creation; each
 * agent account signs its own `rent` and transfers with its own key. Balances come from RPC
 * `view_account`. Errors keep only the operation and the error type, never arguments or keys.
 */
export class NearAgentAccounts implements AgentAccountsChain {
  readonly kind = 'near' as const;
  private readonly accountOf: AgentAccountFactory;

  constructor(
    readonly parent: string,
    private readonly parentKey: string,
    private readonly rpc: NearRpc,
    factory?: AgentAccountFactory,
  ) {
    this.accountOf =
      factory ??
      ((accountId, secretKey) => {
        const providers = rpc.urls.map((url) => new JsonRpcProvider({ url }));
        const provider = providers.length > 1 ? new FailoverRpcProvider(providers) : providers[0]!;
        return new Account(accountId, provider, secretKey as KeyPairString);
      });
  }

  private async send(op: string, run: () => Promise<unknown>): Promise<TxOutcome> {
    let res: TxOutcome;
    try {
      res = (await run()) as TxOutcome;
    } catch (err) {
      const name = err instanceof Error ? err.name : 'error';
      throw new AgentAccountError(name === 'AccountAlreadyExistsError' ? 'exists' : 'unavailable', `${op} failed (${name})`);
    }
    if (failed(res)) throw new AgentAccountError('failed', `${op} failed onchain`, hashOf(res));
    return res;
  }

  async create(accountId: string, publicKey: string): Promise<{ txHash: string }> {
    if (!accountId.endsWith(`.${this.parent}`)) throw new AgentAccountError('failed', 'not a sub-account of the parent');
    const parent = this.accountOf(this.parent, this.parentKey);
    const res = await this.send('create_account', () =>
      parent.createAccount({ newAccountId: accountId, publicKey, nearToTransfer: AGENT_ACCOUNT_INITIAL_YOCTO }),
    );
    return { txHash: hashOf(res) };
  }

  async balance(accountId: string): Promise<AgentAccountBalance | null> {
    let view: { amount?: string; storage_usage?: number };
    try {
      view = await this.rpc.call('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
    } catch (err) {
      if (err instanceof NearRpcError && err.code === 'not_found') return null;
      throw new AgentAccountError('unavailable', 'NEAR RPC is unavailable, try again');
    }
    const total = BigInt(view.amount ?? '0');
    const storage = BigInt(view.storage_usage ?? 0) * STORAGE_YOCTO_PER_BYTE;
    return { totalYocto: total, reservedYocto: storage + AGENT_ACCOUNT_GAS_RESERVE_YOCTO };
  }

  async rent(signer: AgentSigner, args: AgentRentArgs): Promise<AgentRentResult> {
    const account = this.accountOf(signer.accountId, signer.secretKey);
    const res = await this.send('rent', () =>
      account.callFunctionRaw({
        contractId: args.marketContract,
        methodName: 'rent',
        args: { rental_id: args.rentalId, owner_id: args.ownerId, price: args.priceYocto.toString() },
        gas: RENT_GAS,
        deposit: args.priceYocto,
      }),
    );
    const txHash = hashOf(res);
    const event = eventsOf(res as unknown as TxStatus, 'skirm_market').find(
      (e) => e.event === 'rental' && e.executor === args.marketContract,
    );
    const data = (Array.isArray(event?.data) ? event!.data[0] : event?.data) as Record<string, unknown> | undefined;
    const fee = typeof data?.fee === 'string' ? data.fee : null;
    const proceeds = typeof data?.owner_proceeds === 'string' ? data.owner_proceeds : null;
    if (!fee || !proceeds || !/^[0-9]{1,40}$/.test(fee) || !/^[0-9]{1,40}$/.test(proceeds))
      throw new AgentAccountError('failed', 'no rental event in the transaction', txHash);
    return { txHash, feeYocto: BigInt(fee), ownerProceedsYocto: BigInt(proceeds) };
  }

  async transfer(signer: AgentSigner, receiverId: string, amountYocto: bigint): Promise<{ txHash: string }> {
    const account = this.accountOf(signer.accountId, signer.secretKey);
    const res = await this.send('transfer', () => account.transfer({ receiverId, amount: amountYocto }));
    return { txHash: hashOf(res) };
  }
}
