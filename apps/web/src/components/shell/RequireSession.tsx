'use client';
// Gate for screens that need an account. Signed out: a sign-in prompt that returns here afterwards
// (S01 reads `?next=`). Loading (hydration): a skeleton, so nothing flashes.
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { ButtonLink } from '../ButtonLink';
import { Skeleton } from '../states/Skeleton';

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname() ?? '/';
  if (status === 'loading') return <Skeleton rows={6} />;
  if (status === 'signedOut') {
    // Keep the query (`?opponent=bot`, `?skill=…`) so sign-in lands on the same screen. This branch
    // only renders in the browser (the server renders the loading state), so window is there.
    const here = `${pathname}${typeof window === 'undefined' ? '' : window.location.search}`;
    return (
      <section className="app-card app-signin-needed" data-testid="signin-required">
        <h1 className="app-h2">Sign in to continue</h1>
        <p className="sk-muted">This screen needs an account. No wallet needed.</p>
        <ButtonLink variant="primary" href={`${routes.signIn()}?next=${encodeURIComponent(here)}`}>
          Sign in
        </ButtonLink>
      </section>
    );
  }
  return <>{children}</>;
}
