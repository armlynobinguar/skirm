// Fake NEAR wallet for component tests: every method is a vi.fn, transactions are recorded and get
// hashes `tx_1`, `tx_2`, ...
//
//   const wallet = new FakeWallet({ account: 'ada.testnet' });   // connect() picks ada.testnet
//   renderWithProviders(<CreditsScreen />, { authMode: 'privy', token: 'jwt', wallet });
//   expect(wallet.sent[0]).toEqual(depositTx(config.near.contracts, '1000…'));
//   wallet.reject('signAndSendTransaction');                      // next call: user cancelled
//   new FakeWallet({ delegates: true })                           // can sign NEP-366 delegates (gasless)
import { vi } from 'vitest';
import {
  WalletError,
  type NearTransaction,
  type NearWallet,
  type SignedMessage,
  type SignMessageInput,
  type WalletOption,
} from '@/lib/wallet/types';

/** Two wallets: one signs in and signs in one approval, the other needs two. */
export const FAKE_WALLETS: WalletOption[] = [
  { id: 'hot-wallet', name: 'HOT Wallet', icon: '', description: '', oneStep: true },
  { id: 'mynearwallet', name: 'MyNearWallet', icon: '', description: '', oneStep: false },
];

export class FakeWallet implements NearWallet {
  readonly network = 'testnet' as const;
  /** The account connect() signs in as. */
  account: string;
  /** Connected right now (null: signed out). */
  current: string | null;
  readonly sent: NearTransaction[] = [];
  readonly signed: SignMessageInput[] = [];
  /** Transactions signed as delegate actions (gasless onboarding); each gets `signed_delegate_<n>`. */
  readonly delegated: NearTransaction[] = [];
  /** Can sign delegate actions (off by default, like most wallets today). */
  delegates: boolean;
  private n = 0;
  private readonly subs = new Set<(id: string | null) => void>();
  private readonly rejections = new Set<string>();

  constructor(opts: { account?: string; connected?: boolean; delegates?: boolean } = {}) {
    this.account = opts.account ?? 'ada.testnet';
    this.current = opts.connected ? this.account : null;
    this.delegates = opts.delegates ?? false;
  }

  /** The next call of `method` fails as if the user cancelled in the wallet. */
  reject(method: 'connect' | 'connectAndSign' | 'signMessage' | 'signAndSendTransaction' | 'signDelegateAction'): void {
    this.rejections.add(method);
  }

  private take(method: string) {
    if (this.rejections.delete(method))
      throw new WalletError('wallet_rejected', 'Cancelled in the wallet.');
  }

  private set(id: string | null) {
    this.current = id;
    for (const fn of [...this.subs]) fn(id);
  }

  accountId = () => this.current;

  subscribe = (fn: (id: string | null) => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  restore = vi.fn(async () => this.current);

  /** The wallets the picker lists (set to [] to test the fallback). */
  options: WalletOption[] = FAKE_WALLETS;

  wallets = vi.fn(async () => this.options);

  connectAndSign = vi.fn(async (_walletId: string, input: SignMessageInput) => {
    this.take('connectAndSign');
    this.set(this.account);
    this.signed.push(input);
    return {
      accountId: this.account,
      signed: {
        accountId: this.account,
        publicKey: 'ed25519:11111111111111111111111111111111',
        signature: btoa('\0'.repeat(64)),
      },
    };
  });

  connect = vi.fn(async (_walletId?: string) => {
    this.take('connect');
    this.set(this.account);
    return this.account;
  });

  disconnect = vi.fn(async () => {
    this.set(null);
  });

  signMessage = vi.fn(async (input: SignMessageInput): Promise<SignedMessage> => {
    this.take('signMessage');
    if (!this.current) throw new WalletError('wallet_no_account', 'No NEAR wallet is connected.');
    this.signed.push(input);
    // 64 zero bytes, base64: the shape the api expects.
    return {
      accountId: this.current,
      publicKey: 'ed25519:11111111111111111111111111111111',
      signature: btoa('\0'.repeat(64)),
    };
  });

  signAndSendTransaction = vi.fn(async (tx: NearTransaction) => {
    this.take('signAndSendTransaction');
    if (!this.current) throw new WalletError('wallet_no_account', 'No NEAR wallet is connected.');
    this.sent.push(tx);
    return { txHash: `tx_${++this.n}` };
  });

  canSignDelegate = vi.fn(async () => this.delegates);

  signDelegateAction = vi.fn(async (tx: NearTransaction) => {
    this.take('signDelegateAction');
    if (!this.current) throw new WalletError('wallet_no_account', 'No NEAR wallet is connected.');
    this.delegated.push(tx);
    return btoa(`signed_delegate_${this.delegated.length}`);
  });

  signAndSendTransactions = vi.fn(async (txs: NearTransaction[]) => {
    const out: Array<{ txHash: string }> = [];
    for (const tx of txs) out.push(await this.signAndSendTransaction(tx));
    return out;
  });
}
