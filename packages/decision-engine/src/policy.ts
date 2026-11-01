// Time limit, per-call timeout and the single retry (Spec §11: "One retry on a provider error,
// only if it fits inside the time limit; then wait (reason error)").

import { nowMs } from './usage';

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`provider call timed out after ${Math.round(ms)} ms`);
    this.name = 'TimeoutError';
  }
}

/** Non-2xx HTTP answer from a provider. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/** Network errors, 408, 409, 429 and 5xx are worth one retry; other 4xx are not. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return true;
}

export function errorLabel(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return `HTTP ${status}`;
  if (err instanceof Error) return err.name || 'Error';
  return 'Error';
}

export interface PolicyOptions {
  /** Whole budget for one decision, retry included (Spec §4 per-action time limit). */
  timeLimitMs: number;
  /** Cap for a single attempt; defaults to whatever is left of the time limit. */
  callTimeoutMs?: number;
  /** Default true. */
  retry?: boolean;
  /** A retry runs only if at least max(first attempt's duration, this) is left. Default 50 ms. */
  minRetryMs?: number;
}

export type PolicyOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; reason: 'timeout' | 'error'; error: unknown; attempts: number };

export async function runWithPolicy<T>(
  fn: (signal: AbortSignal, attempt: number) => Promise<T>,
  opts: PolicyOptions,
): Promise<PolicyOutcome<T>> {
  const deadline = nowMs() + opts.timeLimitMs;
  const minRetry = opts.minRetryMs ?? 50;
  let attempt = 0;
  for (;;) {
    attempt++;
    const remaining = deadline - nowMs();
    if (remaining <= 0) {
      return {
        ok: false,
        reason: 'timeout',
        error: new TimeoutError(opts.timeLimitMs),
        attempts: attempt - 1,
      };
    }
    const budget = Math.min(remaining, opts.callTimeoutMs ?? remaining);
    const started = nowMs();
    try {
      const value = await withTimeout(fn, attempt, budget);
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      const elapsed = nowMs() - started;
      const left = deadline - nowMs();
      const reason = error instanceof TimeoutError ? 'timeout' : 'error';
      const fits = left > 0 && left >= Math.max(elapsed, minRetry);
      if (attempt === 1 && opts.retry !== false && isRetryable(error) && fits) continue;
      return { ok: false, reason, error, attempts: attempt };
    }
  }
}

async function withTimeout<T>(
  fn: (signal: AbortSignal, attempt: number) => Promise<T>,
  attempt: number,
  ms: number,
): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(ms));
      ctrl.abort();
    }, ms);
  });
  try {
    // Race as well as abort: a provider client that ignores the signal still cannot hold the tick.
    return await Promise.race([fn(ctrl.signal, attempt), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
