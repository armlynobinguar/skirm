// Gasless onboarding on the web side (docs/gasless.md). A player's first few transactions to skirm's
// contracts can have their gas paid by skirm: the wallet signs a NEP-366 delegate action instead of
// a transaction, and the api's relayer (POST /relay) sends it. Attached deposits (the price, the
// top-up) still come from the player's account.
//
// The gasless path is taken only when all of these hold, otherwise the wallet signs and sends the
// transaction itself exactly as before:
//   - the connected wallet can sign delegate actions (NearWallet.canSignDelegate),
//   - the api reports the relay on with free transactions left (GET /relay),
//   - the player approves the delegate in the wallet.
//
// After the wallet signed, the api is the judge. Answers that say nothing was sent (relay off, quota
// used up, a refused delegate, RPC down before relaying, a relay that never reached the chain) fall
// back to the usual transaction. Anything else (a network error, a relayed transaction that failed on
// chain, an unknown 5xx) is thrown: the relayer may have sent it, and a second transaction could
// pay twice.
import { ApiError } from '../api/errors';
import type { RelayResponse, RelayStatus } from '../api/types';
import { config } from '../config';
import { WalletError, isWalletError, type NearTransaction, type NearWallet } from './types';

/**
 * What the api's relayer pays for (apps/api/src/relay.ts allowedMethods): anything else (a delist,
 * a backing stake) goes straight to the usual transaction, so the player is never asked to sign a
 * delegate the relayer will refuse and then asked again.
 */
export function relayable(tx: NearTransaction, c: { deposits: string; market: string; skills: string } = config.near.contracts): boolean {
  const allowed: Record<string, readonly string[]> = { [c.deposits]: ['deposit'], [c.market]: ['buy', 'rent'], [c.skills]: ['nft_approve'] };
  const methods = allowed[tx.receiverId];
  return !!methods && tx.actions.length > 0 && tx.actions.every((a) => a.type === 'FunctionCall' && methods.includes(a.params.methodName));
}

export interface RelayApi {
  relayStatus(): Promise<RelayStatus>;
  relay(signedDelegate: string): Promise<RelayResponse>;
}

export interface SentTransaction {
  txHash: string;
  /** True when skirm's relayer paid the gas. */
  gasless: boolean;
}

/** api answers after which nothing was sent for the player, so the usual transaction is safe. */
function nothingSent(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code === 'relay_tx_failed') return false;
  // 4xx: refused before relaying. 502 relay_failed and 503: the relayer's transaction never went out.
  if (err.status >= 400 && err.status < 500) return true;
  return err.code === 'relay_failed' || err.code === 'rpc_unavailable';
}

async function gaslessAvailable(wallet: NearWallet, api: RelayApi): Promise<boolean> {
  if (!wallet.canSignDelegate || !wallet.signDelegateAction) return false;
  // The wallet first: a wallet that cannot sign delegates never costs an api round trip.
  if (!(await wallet.canSignDelegate().catch(() => false))) return false;
  const status = await api.relayStatus().catch(() => null);
  return !!status?.enabled && status.remaining > 0;
}

/**
 * Sends `tx` gas-free when possible, else signs and sends it with the wallet. The wallet must already
 * be signed in as the linked account (useNearSigner checks that first).
 */
export async function sendTransaction(wallet: NearWallet, api: RelayApi, tx: NearTransaction): Promise<SentTransaction> {
  if (relayable(tx) && (await gaslessAvailable(wallet, api))) {
    let signed: string | null = null;
    try {
      signed = await wallet.signDelegateAction!(tx);
    } catch (err) {
      // Cancelled in the wallet: the player said no, do not ask again with another prompt.
      if (isWalletError(err) && err.code === 'wallet_rejected') throw err;
      signed = null;
    }
    if (signed) {
      try {
        const res = await api.relay(signed);
        return { txHash: res.txHash, gasless: true };
      } catch (err) {
        if (err instanceof ApiError && err.code === 'relay_tx_failed')
          throw new WalletError('wallet_tx_failed', 'The transaction failed on NEAR. Nothing was charged.', err);
        if (!nothingSent(err)) throw err;
      }
    }
  }
  const { txHash } = await wallet.signAndSendTransaction(tx);
  return { txHash, gasless: false };
}
