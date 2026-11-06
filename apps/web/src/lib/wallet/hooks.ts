'use client';
// React side of the NEAR wallet: the shared instance, its connected account, and the two flows every
// money screen needs (link an account with a NEP-413 proof; sign a contract call as the linked account).
// A contract call goes gas-free through skirm's relayer when the api and the wallet both allow it
// (./gasless.ts); the player then sees a short "Gas paid by skirm" note.
import { useMemo, useSyncExternalStore } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import type { NearProof } from '../api/types';
import { config } from '../config';
import { useServices } from '../services';
import { sendTransaction, type SentTransaction } from './gasless';
import { linkRecipient, linkSignInMessage, newNonce, proofOf, signLinkProof } from './contracts';
import { WalletError, type AnyNearTransaction, type NearTransaction, type NearWallet, type WalletOption } from './types';

export const useWallet = (): NearWallet => useServices().wallet;

/** The wallet's connected account (null until connected or restored). */
export function useWalletAccount(): string | null {
  const wallet = useWallet();
  return useSyncExternalStore(wallet.subscribe, wallet.accountId, () => null);
}

export interface NearSigner {
  contracts: typeof config.near.contracts;
  /**
   * Signs in with the picked wallet (or opens the picker without one) and signs the link message:
   * the body for POST /auth/session. One wallet approval when the wallet supports it, else two.
   */
  connectAndProve(skirmAccountId: string, wallet?: WalletOption): Promise<{ nearAccountId: string; nearProof: NearProof }>;
  /**
   * Makes sure the wallet is signed in as `linked` (restoring or opening it), then signs and sends
   * `tx`; resolves with the transaction hash for the api.
   */
  send(tx: AnyNearTransaction, linked: string): Promise<string>;
  /** As send() for contract calls, and says whether skirm's relayer paid the gas. */
  sendTx(tx: NearTransaction, linked: string): Promise<SentTransaction>;
}

export const GAS_PAID_NOTE = 'Gas paid by skirm';

export function useNearSigner(): NearSigner {
  const wallet = useWallet();
  const { api } = useServices();
  const toast = useToast();
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
    async function sendTx(tx: NearTransaction, linked: string): Promise<SentTransaction> {
      await ensure(linked);
      const sent = await sendTransaction(wallet, api, tx);
      if (sent.gasless)
        toast.show({ tone: 'good', title: GAS_PAID_NOTE, message: 'This transaction cost you no network fee.' });
      return sent;
    }
    return {
      contracts: config.near.contracts,
      async connectAndProve(skirmAccountId, picked) {
        if (picked?.oneStep) {
          const recipient = linkRecipient();
          const nonce = newNonce();
          const { accountId, signed } = await wallet.connectAndSign(picked.id, {
            message: linkSignInMessage(skirmAccountId),
            recipient,
            nonce,
          });
          return { nearAccountId: accountId, nearProof: proofOf(signed, nonce, recipient) };
        }
        const nearAccountId = await wallet.connect(picked?.id);
        const nearProof = await signLinkProof(wallet, skirmAccountId, nearAccountId);
        return { nearAccountId, nearProof };
      },
      sendTx,
      async send(tx, linked) {
        // A plain transfer (e.g. funding an agent account) is never relayed; contract calls may be.
        if (tx.actions.some((a) => 'type' in a && a.type === 'Transfer')) {
          await ensure(linked);
          return (await wallet.signAndSendTransaction(tx)).txHash;
        }
        return (await sendTx(tx as NearTransaction, linked)).txHash;
      },
    };
  }, [wallet, api, toast]);
}
