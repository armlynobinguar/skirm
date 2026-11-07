import { ButtonLink } from '@/components/ButtonLink';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/lib/routes';

export default function NotFound() {
  return (
    <AppShell>
      <section className="app-page" style={{ alignItems: 'flex-start' }} data-testid="not-found">
        <h1 className="app-h1">Not found</h1>
        <p className="sk-muted">This page does not exist or was removed.</p>
        <ButtonLink href={routes.home()} variant="primary">
          Go to Play
        </ButtonLink>
      </section>
    </AppShell>
  );
}
