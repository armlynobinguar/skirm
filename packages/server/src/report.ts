// Error reporting for every service, with no SDK: one structured JSON line per error, in the shape
// Google Cloud Error Reporting groups automatically from Cloud Run logs (severity ERROR, the
// ReportedErrorEvent type, serviceContext, and a stack trace in `message`). Create an alerting
// policy on new error groups to be told (docs/deploy.md, "Error reporting").
//
// Messages of unexpected errors can quote query parameters, provider output or user text, so the
// report carries the error's name and code and the stack frames, never the message itself.

export const ERROR_EVENT_TYPE = 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent';

/** `Name: code` and the stack frames, without the message (or the error's own first line). */
export function errorStack(err: unknown): string {
  const e = (err ?? {}) as { name?: unknown; code?: unknown; stack?: unknown; cause?: unknown };
  const name = typeof e.name === 'string' && e.name ? e.name : 'Error';
  let code = typeof e.code === 'string' || typeof e.code === 'number' ? String(e.code) : '';
  // Drizzle and others wrap driver errors: the useful code is often on the cause.
  if (!code && e.cause && typeof (e.cause as { code?: unknown }).code === 'string') code = (e.cause as { code: string }).code;
  const frames = typeof e.stack === 'string' ? e.stack.split('\n').filter((l) => /^\s+at\s/.test(l)) : [];
  // Error Reporting needs at least one frame to group on; a thrown non-Error has none.
  return [`${name}: ${code || 'no code'}`, ...(frames.length ? frames : ['    at <unknown>'])].join('\n');
}

export interface ReportContext {
  /** Where it happened, e.g. "client message" or "unhandledRejection". */
  where?: string;
  /** The request it broke (method and path only: never the query string or body). */
  httpRequest?: { method?: string; url?: string };
}

/** Writes one Error Reporting event for `err` to stderr. Never throws. */
export function reportError(service: string, err: unknown, ctx: ReportContext = {}): void {
  try {
    const event = {
      severity: 'ERROR',
      '@type': ERROR_EVENT_TYPE,
      message: errorStack(err),
      serviceContext: { service, version: process.env.K_REVISION ?? 'local' },
      context: {
        ...(ctx.where ? { reportLocation: { functionName: ctx.where } } : {}),
        ...(ctx.httpRequest ? { httpRequest: { method: ctx.httpRequest.method, url: ctx.httpRequest.url?.split('?')[0] } } : {}),
      },
    };
    console.error(JSON.stringify(event));
  } catch {
    /* reporting must never take the service down */
  }
}

/**
 * Reports unhandled rejections and uncaught exceptions. An uncaught exception leaves the process in an
 * unknown state, so it exits (Cloud Run starts a new instance); a rejection is reported and kept alive.
 */
export function installCrashReporting(service: string): void {
  process.on('unhandledRejection', (err) => reportError(service, err, { where: 'unhandledRejection' }));
  process.on('uncaughtException', (err) => {
    reportError(service, err, { where: 'uncaughtException' });
    process.exit(1);
  });
}
