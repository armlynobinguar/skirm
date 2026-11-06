// The player's NEAR wallet, as the app sees it. One instance per tab (Services.wallet). The real one
// is NEAR Connect (./nearConnect.ts, loaded on first use); tests use FakeWallet (src/test/fakeWallet.ts).
//
// Money and ownership always go through this wallet outside dev mode (arch.md, "Money and
// ownership"): the browser signs, then sends the transaction hash to the api, which reads it back
// through RPC. skirm never sees the wallet's keys.
import { ApiError } from '../api/errors';

/** A function call in the wallet-selector action format (NEAR Connect accepts it as is). */
export interface FunctionCallAction {
  type: 'FunctionCall';
  params: {
    methodName: string;
    args: Record<string, unknown>;
    /** Gas units as a decimal string (1 Tgas = 10^12). */
    gas: string;
    /** Attached yoctoNEAR as a decimal string. */
    deposit: string;
  };
}

export interface NearTransaction {
  receiverId: string;
  actions: FunctionCallAction[];
}

/** A plain NEAR transfer (wallet-selector `Transfer` action), e.g. funding an agent account. */
export interface TransferAction {
  type: 'Transfer';
  params: { deposit: string };
}

export interface NearTransferTransaction {
  receiverId: string;
  actions: TransferAction[];
}

/** Anything the wallet signs: contract calls, or a transfer. */
export type AnyNearTransaction = NearTransaction | NearTransferTransaction;

/** NEP-413 `signMessage` input. `nonce` is 32 random bytes. */
export interface SignMessageInput {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}

/** NEP-413 result: `signature` is base64, `publicKey` is `ed25519:<base58>`. */
export interface SignedMessage {
  accountId: string;
  publicKey: string;
  signature: string;
}

/** A wallet the player can pick in skirm's own list (NEAR Connect's manifest). */
export interface WalletOption {
  id: string;
  name: string;
  /** Icon URL from the wallet's manifest (may be empty). */
  icon: string;
  description: string;
  /** Signs in and signs the link message in one approval (NEAR Connect `signInAndSignMessage`). */
  oneStep: boolean;
}

export interface NearWallet {
  readonly network: 'testnet' | 'mainnet';
  /** The connected account, or null. Only known after `restore()` / `connect()`. */
  accountId(): string | null;
  /** Called whenever the connected account changes (connect, disconnect, account switch). */
  subscribe(fn: (accountId: string | null) => void): () => void;
  /** Loads the connector and reads a session kept from an earlier visit; the account or null. */
  restore(): Promise<string | null>;
  /** Wallets that can do what skirm asks on this network, for skirm's own picker. */
  wallets(): Promise<WalletOption[]>;
  /** Signs in with `walletId` (no picker), or opens the picker without one; resolves with the account id. */
  connect(walletId?: string): Promise<string>;
  /**
   * Signs in with `walletId` and signs `message` in the same approval (wallets with `oneStep`).
   * Resolves with the account and its signature.
   */
  connectAndSign(walletId: string, message: SignMessageInput): Promise<{ accountId: string; signed: SignedMessage }>;
  disconnect(): Promise<void>;
  signMessage(input: SignMessageInput): Promise<SignedMessage>;
  /** Signs and sends one transaction; resolves once it is final with its hash. */
  signAndSendTransaction(tx: AnyNearTransaction): Promise<{ txHash: string }>;
  signAndSendTransactions(txs: NearTransaction[]): Promise<Array<{ txHash: string }>>;
  /**
   * Can the connected wallet sign NEP-366 delegate actions (NEAR Connect `signDelegateActions`)?
   * Optional: a wallet without it is never asked, and every transaction goes the usual way.
   */
  canSignDelegate?(): Promise<boolean>;
  /**
   * Signs `tx` as a delegate action without sending it: base64 borsh SignedDelegate for the relay
   * (gasless onboarding, ./gasless.ts). The relayer pays the gas; attached deposits stay the player's.
   */
  signDelegateAction?(tx: NearTransaction): Promise<string>;
}

export type WalletErrorCode =
  | 'wallet_rejected'
  | 'wallet_wrong_account'
  | 'wallet_tx_failed'
  | 'wallet_no_account'
  | 'wallet_unsupported'
  | 'wallet_failed';

/**
 * A wallet-side failure. An ApiError subclass (status 400, never 0) so the shared error copy, M02's
 * "Cancelled. Nothing was sent." and the Details disclosure handle it like any other error.
 */
export class WalletError extends ApiError {
  constructor(
    code: WalletErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(400, code, message);
  }
}

export const isWalletError = (e: unknown): e is WalletError => e instanceof WalletError;
