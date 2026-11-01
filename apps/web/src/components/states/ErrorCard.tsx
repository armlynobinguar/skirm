'use client';
// Inline error with Retry (UI/UX Spec States: "Inline card with Retry; cached rows stay visible").
// The error code sits in a Details disclosure for support.
import { Button } from '@skirm/ui';
import { errorCopy } from '@/lib/api/errors';

export function ErrorCard({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const c = errorCopy(error);
  return (
    <section className="app-card app-error" role="alert" data-testid="error-card">
      <h2 className="app-h3">{title ?? c.title}</h2>
      <p>{c.message}</p>
      <div className="app-row">
        {onRetry ? (
          <Button size="sm" icon="replay" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {c.code ? (
          <details>
            <summary>Details</summary>
            <code>{c.code}</code>
          </details>
        ) : null}
      </div>
    </section>
  );
}
