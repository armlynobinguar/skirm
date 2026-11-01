// Every api failure becomes an ApiError. The server's shape is
//   { error: { code, message, details?, ...extra } }
// where `extra` is flattened next to code (402 insufficient_credits carries `need` and `have`,
// 429 rate_limited carries `retryAfterS`). Network failures get status 0 and code `network`.

/** Error codes the api sends (contract + docs/HANDOFF.md extras). Not exhaustive: `code` is a string. */
export type ApiErrorCode =
  | 'network'
  | 'bad_response'
  | 'invalid_request'
  | 'bad_request'
  | 'unauthenticated'
  | 'no_session'
  | 'auth_failed'
  | 'forbidden'
  | 'not_found'
  | 'insufficient_credits'
  | 'free_budget_exhausted'
  | 'agent_busy'
  | 'invalid_crew'
  | 'near_account_taken'
  | 'near_account_required'
  | 'near_proof_required'
  | 'near_proof_invalid'
  | 'duplicate_receipt'
  | 'duplicate_tx'
  | 'not_listed'
  | 'not_minted'
  | 'own_listing'
  | 'underpaid'
  | 'purchase_unverified'
  | 'mint_failed'
  | 'listing_active'
  | 'rate_limited'
  | 'trial_limit'
  | 'cosmetic_not_owned'
  | 'queue_unavailable'
  | 'rpc_unavailable'
  | 'ownership_unavailable'
  | 'internal'
  | (string & {});

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    /** HTTP status; 0 when the request never got a response. */
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    /** Extra fields on the error object, e.g. `{ need, have }` on 402. */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  /** 402 insufficient_credits / free_budget_exhausted: what the match needs and what the player has. */
  get shortfall(): { need: number; have: number } | null {
    const { need, have } = this.extra;
    return typeof need === 'number' && typeof have === 'number' ? { need, have } : null;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** Builds an ApiError from a non-2xx response body (already parsed, or null if not JSON). */
export function errorFromBody(status: number, body: unknown): ApiError {
  const err =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error: unknown }).error
      : undefined;
  if (err && typeof err === 'object') {
    const { code, message, details, ...extra } = err as Record<string, unknown>;
    return new ApiError(
      status,
      typeof code === 'string' ? code : `http_${status}`,
      typeof message === 'string' ? message : `request failed (${status})`,
      details && typeof details === 'object' ? (details as Record<string, unknown>) : undefined,
      extra,
    );
  }
  return new ApiError(status, `http_${status}`, `request failed (${status})`);
}

/**
 * Player-facing copy for an error (UI/UX Spec: say what happened and what to do next, no blame;
 * the code goes in a Details disclosure). Screens may override per code.
 */
export function errorCopy(e: unknown): { title: string; message: string; code?: string } {
  if (!isApiError(e))
    return { title: 'Something went wrong', message: 'Try again in a moment.' };
  switch (e.code) {
    case 'network':
      return {
        title: 'Offline',
        message: 'The game server could not be reached. Check your connection and try again.',
        code: e.code,
      };
    case 'no_session':
    case 'unauthenticated':
    case 'auth_failed':
      return { title: 'Signed out', message: 'Sign in again to continue.', code: e.code };
    case 'insufficient_credits': {
      const s = e.shortfall;
      return {
        title: 'Not enough credits',
        message: s ? `Need ${s.need}, have ${s.have}. Top up or remove an agent.` : e.message,
        code: e.code,
      };
    }
    case 'free_budget_exhausted':
      return {
        title: 'Free play is paused',
        message: 'Free play is paused for everyone until 00:00 UTC. This match needs paid credits.',
        code: e.code,
      };
    case 'rate_limited':
      return { title: 'Slow down', message: 'Too many requests. Wait a moment and try again.', code: e.code };
    case 'trial_limit':
      return { title: 'Trial limit reached', message: 'Three trials per skill version. Buy it to keep playing it.', code: e.code };
    case 'cosmetic_not_owned':
      return { title: 'Look not owned', message: 'Buy the premium colour first, or pick a free one.', code: e.code };
    case 'queue_unavailable':
      return { title: 'Matches are paused', message: 'Try again shortly.', code: e.code };
    case 'listing_active':
      return {
        title: 'Listing still open',
        message: 'Cancel your market listings, then unlink your NEAR account.',
        code: e.code,
      };
    case 'not_found':
      return { title: 'Not found', message: 'This page does not exist or was removed.', code: e.code };
    default:
      return { title: 'Something went wrong', message: e.message, code: e.code };
  }
}
