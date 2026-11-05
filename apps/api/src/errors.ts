// Global error shape `{ error: { code, message, details? } }` (docs/backend-contract.md).
// Messages never carry skill text: repository, vault and NEAR errors are built without it, and
// unexpected errors (which may embed SQL parameters) are reported as a bare `internal`.
import { reportError } from '@skirm/server';
import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { RepoError } from '@skirm/db';
import { AuthError, DepositError, VaultError } from '@skirm/server';
import type { Response } from 'express';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    /** Extra fields placed directly on the error object (402: need, have). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);

const REPO_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  agent_busy: 409,
  agent_bound: 409,
  conflict: 409,
  invalid_transition: 409,
  hold_mismatch: 409,
  trial_limit: 429,
  bench_limit: 429,
  puzzle_limit: 429,
  rate_limited: 429,
};

const DEPOSIT_STATUS: Partial<Record<DepositError['code'], number>> = {
  rpc_unavailable: 503,
  not_found: 404,
  dev_disabled: 403,
};

interface ErrorBody {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof ApiError)
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      ...(err.extra ? { extra: err.extra } : {}),
    };
  if (err instanceof AuthError) return { status: 401, code: err.code, message: err.message };
  if (err instanceof RepoError)
    return {
      status: REPO_STATUS[err.code] ?? 422,
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    };
  if (err instanceof DepositError)
    return { status: DEPOSIT_STATUS[err.code] ?? 422, code: err.code, message: err.message };
  if (err instanceof VaultError)
    return { status: 500, code: 'vault_error', message: 'skill vault error' };
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code =
      status === 404
        ? 'not_found'
        : status === 400 || status === 413 || status === 415
          ? 'bad_request'
          : status === 401
            ? 'unauthenticated'
            : status === 403
              ? 'forbidden'
              : `http_${status}`;
    // Built-in exceptions (route not found, body parser). A JSON parse error's message quotes the
    // body around the error, which may be skill text, so body errors get fixed messages.
    const msg =
      status === 404
        ? 'route not found'
        : status === 400
          ? 'malformed request body'
          : status === 413
            ? 'request body too large'
            : status === 415
              ? 'unsupported content type'
              : status < 500
                ? err.message
                : 'error';
    return { status, code, message: msg };
  }
  // body-parser's http-errors (413 too large, 415 charset, 400 bad encoding) are not
  // HttpExceptions; without this they surfaced as 500.
  const he = err as { expose?: unknown; status?: unknown; type?: unknown };
  if (
    he &&
    he.expose === true &&
    typeof he.status === 'number' &&
    he.status >= 400 &&
    he.status < 500
  )
    return {
      status: he.status,
      code: 'bad_request',
      message:
        he.status === 413
          ? 'request body too large'
          : he.status === 415
            ? 'unsupported content type'
            : 'malformed request body',
    };
  return { status: 500, code: 'internal', message: 'internal error' };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<{ method?: string; path?: string }>();
    const body = toErrorBody(exception);
    // Name, code and stack frames only (reportError): messages of unexpected errors can embed query
    // parameters. One Error Reporting event per 5xx.
    if (body.status >= 500) reportError('api', exception, { where: `${req.method ?? ''} ${req.path ?? ''}`.trim(), httpRequest: { method: req.method, url: req.path } });
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(body.status || HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: body.code,
        message: body.message,
        ...(body.extra ?? {}),
        ...(body.details ? { details: body.details } : {}),
      },
    });
  }
}
