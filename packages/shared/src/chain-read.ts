// Reading Sepolia through a public, load-balanced RPC.
//
// The 10-wallet Sepolia simulations found two ways a plain read goes wrong:
// - It times out (or the node answers 429/5xx). One unretried timeout stopped a whole auction flow.
// - It is stale. Right after a transaction lands, another node behind the same RPC URL can still
//   answer from an older block: a market just closed still reads Open, an auction's reveal handles
//   still read as zero. The relayer refuses to decrypt a zero handle, so the reveal fails.
// retryRead retries the first kind; waitForChain polls past the second.

/** Attempts in all for one read (the first try and three retries). */
export const READ_TRIES = 4;
/** Wait between read retries. */
export const READ_RETRY_MS = 1_500;
/** Polls before giving up on stale state (about 30 s at CHAIN_POLL_MS, a couple of Sepolia blocks). */
export const CHAIN_POLLS = 20;
export const CHAIN_POLL_MS = 1_500;

const TRANSIENT_CODES = new Set(['TIMEOUT', 'NETWORK_ERROR', 'SERVER_ERROR', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
const TRANSIENT_TEXT = /time(d)? ?out|timeout|socket hang up|fetch failed|network error|missing response|rate limit|too many requests|\b(429|502|503|504)\b|bad gateway|service unavailable|ECONNRESET|ETIMEDOUT/i;

/**
 * Whether `e` is a network hiccup worth retrying (timeout, dropped connection, 429/5xx), not an
 * answer from the chain. A revert is never transient: retrying it only sends the same call again.
 */
export function isTransientRpcError(e: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth: number): boolean => {
    if (v == null || depth > 6 || seen.has(v)) return false;
    if (typeof v === 'string') return TRANSIENT_TEXT.test(v);
    if (typeof v !== 'object') return false;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (o.code === 'CALL_EXCEPTION' || typeof o.revert === 'object') return false;
    if (typeof o.code === 'string' && TRANSIENT_CODES.has(o.code)) return true;
    if (typeof o.status === 'number' && (o.status === 429 || o.status >= 500)) return true;
    for (const k of ['message', 'shortMessage', 'error', 'info', 'cause', 'responseStatus'])
      if (k in o && visit(o[k], depth + 1)) return true;
    return false;
  };
  return visit(e, 0);
}

export interface ReadOptions {
  tries?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs a read, retrying it when the RPC times out or fails transiently. Other errors throw at once. */
export async function retryRead<T>(read: () => Promise<T>, o: ReadOptions = {}): Promise<T> {
  const tries = o.tries ?? READ_TRIES;
  const sleep = o.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (e) {
      if (attempt >= tries || !isTransientRpcError(e)) throw e;
      await sleep((o.delayMs ?? READ_RETRY_MS) * attempt);
    }
  }
}

export interface WaitOptions {
  polls?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** What is awaited, for the error ("the auction to close"). */
  what?: string;
}

/**
 * Reads until `ready(value)` holds (each read retried as in retryRead), for state a transaction just
 * changed that a lagging RPC node may not show yet. Throws once `polls` reads have all been stale.
 */
export async function waitForChain<T>(read: () => Promise<T>, ready: (v: T) => boolean, o: WaitOptions = {}): Promise<T> {
  const polls = o.polls ?? CHAIN_POLLS;
  const sleep = o.sleep ?? defaultSleep;
  for (let i = 1; ; i++) {
    const v = await retryRead(read, { sleep });
    if (ready(v)) return v;
    if (i >= polls) throw new Error(`Timed out waiting for ${o.what ?? 'the chain to update'} (the RPC still shows the old state).`);
    await sleep(o.pollMs ?? CHAIN_POLL_MS);
  }
}

/** Whether an FHE handle is the zero handle (never set, or a stale read of one just set). */
export function isZeroHandleHex(handle: unknown): boolean {
  return /^0x0{64}$/i.test(String(handle));
}

/** Whether every handle is set, so the relayer can decrypt them. An empty list is not ready. */
export function handlesSet(handles: readonly unknown[]): boolean {
  return handles.length > 0 && handles.every((h) => !isZeroHandleHex(h));
}

/** Reads FHE handles until none is zero (see waitForChain). */
export function waitForHandles<H>(read: () => Promise<readonly H[]>, o: WaitOptions = {}): Promise<readonly H[]> {
  return waitForChain(read, handlesSet, { what: 'the encrypted values to be stored on chain', ...o });
}
