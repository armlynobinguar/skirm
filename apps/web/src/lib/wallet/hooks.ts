'use client';
// React side of the NEAR wallet: the shared instance, its connected account, and the two flows every
// money screen needs (link an account with a NEP-413 proof; sign a contract call as the linked account).
import { useMemo, useSyncExternalStore } from 'react';
import type { NearProof } from '../api/types';
import { config } from '../config';
import { useServices } from '../services';
import { signLinkProof } from './contracts';
import { WalletError, type NearTransaction, type NearWallet } from './types';

export const useWallet = (): NearWallet => useServices().wallet;

/** The wallet's connected account (null until connected or restored). */
export function useWalletAccount(): string | null {
  const wallet = useWallet();
  return useSyncExternalStore(wallet.subscribe, wallet.accountId, () => null);
}

export interface NearSigner {
  contracts: typeof config.near.contracts;
  /** Opens the wallet picker, then signs the link message: the body for POST /auth/session. */
  connectAndProve(skirmAccountId: string): Promise<{ nearAccountId: string; nearProof: NearProof }>;
  /**
   * Makes sure the wallet is signed in as `linked` (restoring or opening it), then signs and sends
   * `tx`; resolves with the transaction hash for the api.
   */
  send(tx: NearTransaction, linked: string): Promise<string>;
}

export function useNearSigner(): NearSigner {
  const wallet = useWallet();
  return useMemo<NearSigner>(() => {
    async function ensure(linked: string): Promise<void> {
      let id = wallet.accountId() ?? (await wallet.restore().catch(() => null));
      if (!id) id = await wallet.connect();
      if (id !== linked) {
        // Sign the wrong account out, so "Try again" opens the picker for the right one.
        await wallet.disconnect().catch(() => undefined);
        throw new WalletError(
          'wallet_wrong_account',
          `The wallet is signed in as ${id}, but this skirm account is linked to ${linked}. Try again and pick ${linked}.`,
        );
      }
    }
    return {
      contracts: config.near.contracts,
      async connectAndProve(skirmAccountId) {
        const nearAccountId = await wallet.connect();
        const nearProof = await signLinkProof(wallet, skirmAccountId, nearAccountId);
        return { nearAccountId, nearProof };
      },
      async send(tx, linked) {
        await ensure(linked);
        return (await wallet.signAndSendTransaction(tx)).txHash;
      },
    };
  }, [wallet]);
}
