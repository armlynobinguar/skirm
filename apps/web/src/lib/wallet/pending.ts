// Payments the wallet signed that the api has not recorded yet. A signed NEAR transaction has moved
// money, so losing its hash (a failed POST, a closed drawer, a reload) would leave the user paid but
// not served, and the next click would sign and pay again. Each flow keeps its pending payment here,
// in localStorage under its own key, re-sends the same hash until the api answers, and drops it only
// once the api has recorded it or refused it for good. Storage can be off (private windows): the
// caller's in-memory copy still covers retries on the page.
import { ApiError } from '@/lib/api/errors';

export interface PendingStore<T> {
  load(): T | null;
  save(v: T | null): void;
}

export function pendingStore<T extends object>(key: string, valid: (v: Record<string, unknown>) => boolean): PendingStore<T> {
  const full = `skirm:pending:${key}`;
  return {
    load() {
      try {
        const v = JSON.parse(localStorage.getItem(full) ?? 'null') as Record<string, unknown> | null;
        return v && typeof v === 'object' && valid(v) ? (v as T) : null;
      } catch {
        return null;
      }
    },
    save(v) {
      try {
        if (v) localStorage.setItem(full, JSON.stringify(v));
        else localStorage.removeItem(full);
      } catch {
        // Storage off: the in-memory copy still covers retries on this page.
      }
    },
  };
}

/**
 * Api answers that will not change if the same hash is sent again: it was recorded already (409),
 * or refused for good (400, 402, 403, 422). Anything else (a timeout, 5xx, 404 while the receipt is
 * not indexed yet, a network error) keeps the payment pending, to be re-sent as is.
 */
export function isFinalRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError) || ![400, 402, 403, 409, 422].includes(err.status)) return false;
  // "Transaction not found" from a NEAR check is the receipt not indexed yet: worth re-sending.
  return err.details?.reason !== 'not_found';
}
