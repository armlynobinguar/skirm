'use client';
// The linked NEAR account's balance for the top bar's wallet box: a read-only JSON-RPC
// `view_account` against config.near.rpcUrl (FastNEAR by default). No wallet needed, so it works
// in dev mode too for any linked id that exists on the network.
import { useQuery } from '@tanstack/react-query';
import { config } from '@/lib/config';
import { YOCTO_PER_NEAR } from '@/lib/constants';

/** Query key (not in qk: chain state, not api data). Invalidate it after a top-up settles. */
export const nearBalanceKey = (accountId: string | null | undefined) =>
  ['near', 'balance', config.near.network, accountId ?? null] as const;

interface RpcResponse {
  result?: { amount?: string; error?: string };
  error?: { name?: string; message?: string; cause?: { name?: string } };
}

/**
 * The account's liquid balance in yoctoNEAR, or null when the account does not exist on the
 * network (e.g. a dev-mode id). Throws on network and other RPC errors.
 */
export async function fetchNearBalance(
  accountId: string,
  rpcUrl: string = config.near.rpcUrl,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'skirm',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    }),
  });
  if (!res.ok) throw new Error(`NEAR RPC ${res.status}`);
  const body = (await res.json()) as RpcResponse;
  if (body.error) {
    if (body.error.cause?.name === 'UNKNOWN_ACCOUNT') return null;
    throw new Error(body.error.message ?? body.error.name ?? 'NEAR RPC error');
  }
  // Older nodes put a view error inside `result`.
  if (body.result?.error) {
    if (/does not exist/i.test(body.result.error)) return null;
    throw new Error(body.result.error);
  }
  if (typeof body.result?.amount !== 'string') throw new Error('NEAR RPC: no amount');
  return body.result.amount;
}

/** yoctoNEAR → "3.20" (two decimals, rounded down, like the wallet shows it). */
export function nearShort(yocto: string | bigint): string {
  const v = typeof yocto === 'bigint' ? yocto : BigInt(yocto);
  const cents = v / (YOCTO_PER_NEAR / 100n);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** The balance of `accountId` (yocto string, null if the account is not on the network). */
export function useNearBalance(accountId: string | null | undefined) {
  return useQuery({
    queryKey: nearBalanceKey(accountId),
    queryFn: () => fetchNearBalance(accountId!),
    enabled: !!accountId,
    staleTime: 60_000,
    retry: 1,
  });
}
