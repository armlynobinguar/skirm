// NearWallet over NEAR Connect (@hot-labs/near-connect), the wallet connector docs.near.org
// recommends (HOT, Meteor, MyNearWallet, Intear, Nightly, OKX, NEAR Mobile, ...; each wallet's code
// runs in a sandboxed iframe, so the app ships no per-wallet packages). The library is imported on
// first use only, so dev mode and pages that never sign load none of it.
import type { NearNetwork } from '../config';
import {
  WalletError,
  type NearTransaction,
  type NearWallet,
  type SignedMessage,
  type SignMessageInput,
  type WalletOption,
} from './types';

// The library's own types reference @near-js/* packages it does not install, so the connector is
// typed here with just what this file uses.
interface ConnectorWallet {
  getAccounts(data?: { network?: NearNetwork }): Promise<Array<{ accountId: string }>>;
  signMessage(
    p: SignMessageInput & { network?: NearNetwork; signerId?: string },
  ): Promise<SignedMessage>;
  signAndSendTransaction(
    p: NearTransaction & { network?: NearNetwork; signerId?: string },
  ): Promise<unknown>;
  signAndSendTransactions(p: {
    transactions: NearTransaction[];
    network?: NearNetwork;
    signerId?: string;
  }): Promise<unknown[]>;
}
interface ManifestFeatures {
  signInAndSignMessage?: boolean;
}
interface ConnectorWalletEntry {
  manifest: { id: string; name: string; icon?: string; description?: string; features?: ManifestFeatures };
}
interface Connector {
  readonly whenManifestLoaded: Promise<void>;
  readonly availableWallets: ConnectorWalletEntry[];
  connect(input?: { walletId?: string; signMessageParams?: SignMessageInput }): Promise<ConnectorWallet>;
  disconnect(): Promise<void>;
  wallet(): Promise<ConnectorWallet>;
  getConnectedWallet(): Promise<{
    wallet: ConnectorWallet;
    accounts: Array<{ accountId: string }>;
  }>;
  on(event: 'wallet:signIn', cb: (e: { accounts: Array<{ accountId: string }> }) => void): void;
  on(event: 'wallet:signOut', cb: () => void): void;
  once(
    event: 'wallet:signInAndSignMessage',
    cb: (e: { accounts: Array<{ accountId: string; signedMessage?: SignedMessage }> }) => void,
  ): void;
}

export type ConnectorFactory = (network: NearNetwork) => Promise<Connector>;

const defaultFactory: ConnectorFactory = async (network) => {
  const { NearConnector } = await import('@hot-labs/near-connect');
  return new NearConnector({
    network,
    // Only wallets that can do everything skirm asks of them on this network.
    features: {
      signMessage: true,
      signAndSendTransaction: true,
      ...(network === 'testnet' ? { testnet: true } : {}),
    },
  }) as unknown as Connector;
};

/** The transaction hash of a FinalExecutionOutcome (or of the shapes some wallets return). */
export function txHashOf(outcome: unknown): string {
  const o = outcome as {
    transaction?: { hash?: string };
    transaction_outcome?: { id?: string };
    status?: { Failure?: unknown };
  } | null;
  if (o?.status && typeof o.status === 'object' && 'Failure' in o.status)
    throw new WalletError(
      'wallet_tx_failed',
      'The transaction failed on NEAR. Nothing was charged beyond the network fee.',
    );
  const hash = o?.transaction?.hash ?? o?.transaction_outcome?.id;
  if (!hash)
    throw new WalletError('wallet_failed', 'The wallet did not return a transaction hash.');
  return hash;
}

/** Turns the connector's plain errors into WalletErrors ("User rejected" → wallet_rejected). */
function walletError(err: unknown): WalletError {
  if (err instanceof WalletError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/reject|cancel|denied|closed/i.test(msg))
    return new WalletError('wallet_rejected', 'Cancelled in the wallet.', err);
  if (/no accounts|no wallet/i.test(msg))
    return new WalletError('wallet_no_account', 'No NEAR wallet is connected.', err);
  return new WalletError('wallet_failed', msg || 'The wallet did not answer.', err);
}

export function createNearConnectWallet(opts: {
  network: NearNetwork;
  factory?: ConnectorFactory;
}): NearWallet {
  const factory = opts.factory ?? defaultFactory;
  let current: string | null = null;
  let connector: Promise<Connector> | null = null;
  const subs = new Set<(id: string | null) => void>();

  const setAccount = (id: string | null) => {
    if (id === current) return;
    current = id;
    for (const fn of [...subs]) fn(id);
  };

  const load = (): Promise<Connector> => {
    if (typeof window === 'undefined')
      return Promise.reject(new WalletError('wallet_unsupported', 'No wallet on the server.'));
    connector ??= factory(opts.network).then((c) => {
      c.on('wallet:signIn', (e) => setAccount(e.accounts[0]?.accountId ?? null));
      c.on('wallet:signOut', () => setAccount(null));
      return c;
    });
    connector.catch(() => {
      connector = null;
    });
    return connector;
  };

  const connectedWallet = async (): Promise<ConnectorWallet> => {
    const c = await load();
    try {
      return await c.wallet();
    } catch (err) {
      throw walletError(err);
    }
  };

  const signer = () => (current ? { signerId: current } : {});

  return {
    network: opts.network,
    accountId: () => current,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    async restore() {
      const c = await load();
      try {
        const { accounts } = await c.getConnectedWallet();
        setAccount(accounts[0]?.accountId ?? null);
      } catch {
        setAccount(null);
      }
      return current;
    },
    async wallets(): Promise<WalletOption[]> {
      const c = await load();
      await c.whenManifestLoaded.catch(() => undefined);
      return c.availableWallets.map(({ manifest: m }) => ({
        id: m.id,
        name: m.name,
        icon: m.icon ?? '',
        description: m.description ?? '',
        oneStep: Boolean(m.features?.signInAndSignMessage),
      }));
    },
    async connectAndSign(walletId, message) {
      const c = await load();
      // The connector reports the signed message through an event fired during connect().
      let signed: SignedMessage | undefined;
      let account: string | undefined;
      c.once('wallet:signInAndSignMessage', (e) => {
        account = e.accounts[0]?.accountId;
        signed = e.accounts[0]?.signedMessage;
      });
      try {
        await c.connect({ walletId, signMessageParams: message });
      } catch (err) {
        throw walletError(err);
      }
      if (!account)
        throw new WalletError('wallet_no_account', 'The wallet has no account on this network.');
      setAccount(account);
      if (!signed) throw new WalletError('wallet_failed', 'The wallet signed in but did not sign the message.');
      return { accountId: account, signed };
    },
    async connect(walletId) {
      const c = await load();
      try {
        const w = await c.connect(walletId ? { walletId } : undefined);
        const accounts = await w.getAccounts({ network: opts.network });
        const id = accounts[0]?.accountId;
        if (!id)
          throw new WalletError('wallet_no_account', 'The wallet has no account on this network.');
        setAccount(id);
        return id;
      } catch (err) {
        throw walletError(err);
      }
    },
    async disconnect() {
      const c = await load();
      try {
        await c.disconnect();
      } catch {
        /* already signed out */
      }
      setAccount(null);
    },
    async signMessage(input) {
      const w = await connectedWallet();
      try {
        return await w.signMessage({ ...input, network: opts.network, ...signer() });
      } catch (err) {
        throw walletError(err);
      }
    },
    async signAndSendTransaction(tx) {
      const w = await connectedWallet();
      let outcome: unknown;
      try {
        outcome = await w.signAndSendTransaction({ ...tx, network: opts.network, ...signer() });
      } catch (err) {
        throw walletError(err);
      }
      return { txHash: txHashOf(outcome) };
    },
    async signAndSendTransactions(txs) {
      const w = await connectedWallet();
      let outcomes: unknown[];
      try {
        outcomes = await w.signAndSendTransactions({
          transactions: txs,
          network: opts.network,
          ...signer(),
        });
      } catch (err) {
        throw walletError(err);
      }
      return outcomes.map((o) => ({ txHash: txHashOf(o) }));
    },
  };
}
