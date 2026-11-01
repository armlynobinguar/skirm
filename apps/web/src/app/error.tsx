'use client';
// Last-resort boundary for render errors. Data errors are handled in place (QueryView/ErrorCard).
import { Button } from '@skirm/ui';

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <section className="app-page" role="alert" data-testid="render-error">
      <h1 className="app-h1">Something went wrong</h1>
      <p className="sk-muted">Reload the screen to try again.</p>
      <Button variant="primary" onClick={() => retry()}>
        Try again
      </Button>
      {digest ? (
        <details>
          <summary>Details</summary>
          <code>{digest}</code>
        </details>
      ) : null}
    </section>
  );
}
