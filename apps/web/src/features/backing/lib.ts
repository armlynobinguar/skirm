// Writer backing helpers: labels for terms and amounts, and the write flow every backing action
// shares (credits mode answers at once; near mode answers a contract call for the wallet, whose
// tx hash then goes to POST /backing/sync).
import { capProgress } from '@skirm/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { BackingMode, BackingRound, BackingWalletCall, BackingWrite } from '@/lib/api/backingTypes';
import { qk, useMe } from '@/lib/api/queries';
import { formatNear } from '@/lib/constants';
import { useApi } from '@/lib/services';
import { useNearSigner } from '@/lib/wallet/hooks';
import type { NearTransaction } from '@/lib/wallet/types';
import { WalletError } from '@/lib/wallet/types';

/** `2000` → `20%`. */
export const sharePct = (bps: number) => `${+(bps / 100).toFixed(2)}%`;
/** `20000` → `2×`. */
export const capX = (bps: number) => `${+(bps / 10_000).toFixed(2)}×`;

/** NEAR, or credits on the keyless stack (where backing moves paid credits). */
export function money(yocto: string | bigint, mode: BackingMode | 'near' | 'credits', creditsPerNear = 1000): string {
  const v = typeof yocto === 'bigint' ? yocto : BigInt(yocto);
  if (mode === 'credits') {
    const perCredit = 10n ** 24n / BigInt(creditsPerNear);
    return `${(v / perCredit).toLocaleString('en-US')} credits`;
  }
  return `${formatNear(v)} NEAR`;
}

/** One-line terms: "20% of royalties until backers get 2×". */
export const termsLine = (r: Pick<BackingRound, 'shareBps' | 'capMultipleBps'>) =>
  `${sharePct(r.shareBps)} of royalties until backers get ${capX(r.capMultipleBps)}`;

/** 0..1 of the way to the cap (every backer of a round shares it). */
export const roundProgress = (r: Pick<BackingRound, 'backersEarnedYocto' | 'raisedYocto' | 'capMultipleBps'>) =>
  capProgress(BigInt(r.backersEarnedYocto), BigInt(r.raisedYocto), r.capMultipleBps);

export const isWallet = <T,>(r: BackingWrite<T>): r is { wallet: BackingWalletCall } =>
  typeof r === 'object' && r !== null && 'wallet' in r;

export function walletTx(c: BackingWalletCall): NearTransaction {
  return {
    receiverId: c.contractId,
    actions: [{ type: 'FunctionCall', params: { methodName: c.methodName, args: c.args, gas: c.gas, deposit: c.depositYocto } }],
  };
}

/**
 * Runs a backing write: on a `{ wallet }` answer, signs the call as the linked NEAR account and
 * mirrors it with /backing/sync. Refreshes every backing query afterwards.
 */
export function useBackingWrite() {
  const api = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const signer = useNearSigner();
  return async function run<T>(call: () => Promise<BackingWrite<T>>): Promise<T | null> {
    const res = await call();
    try {
      if (!isWallet(res)) return res;
      const linked = me.data?.account.nearAccountId;
      if (!linked) throw new WalletError('wallet_no_account', 'Link a NEAR account first.');
      const txHash = await signer.send(walletTx(res.wallet), linked);
      await api.syncBacking(txHash);
      return null;
    } finally {
      void qc.invalidateQueries({ queryKey: qk.backing.all });
      void qc.invalidateQueries({ queryKey: qk.me });
    }
  };
}
