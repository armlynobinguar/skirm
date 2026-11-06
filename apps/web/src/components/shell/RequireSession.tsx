'use client';
// Gate for screens that need an account. Signed out: a sign-in prompt that returns here afterwards
// (S01 reads `?next=`). Loading (hydration): a skeleton, so nothing flashes.
// Public screens (the Exchange) gate single actions instead, with <SignInButton>.
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/auth/session';
import { routes } from '@/lib/routes';
import { ButtonLink } from '../ButtonLink';
import { Skeleton } from '../states/Skeleton';

/** The sign-in link that lands on `next` afterwards (default: this screen, query kept). */
export function useSignInHref(next?: string): string {
  const pathname = usePathname() ?? '/';
  // Keep the query (`?opponent=bot`, `?skill=…`) so sign-in lands on the same screen. Signed-out
  // UI only renders in the browser (the server renders the loading state), so window is there.
  const here = next ?? `${pathname}${typeof window === 'undefined' ? '' : window.location.search}`;
  return `${routes.signIn()}?next=${encodeURIComponent(here)}`;
}

/** An action that needs an account ("Sign in to buy"), shown to signed-out visitors of a public screen. */
export function SignInButton({
  children,
  next,
  variant = 'primary',
  'data-testid': testId = 'signin-action',
}: {
  children: ReactNode;
  /** Where sign-in returns to (default: this screen). */
  next?: string;
  variant?: 'primary' | 'secondary';
  'data-testid'?: string;
}) {
  const href = useSignInHref(next);
  return (
    <ButtonLink variant={variant} href={href} data-testid={testId}>
      {children}
    </ButtonLink>
  );
}

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const href = useSignInHref();
  if (status === 'loading') return <Skeleton rows={6} />;
  if (status === 'signedOut') {
    return (
      <section className="app-card app-signin-needed" data-testid="signin-required">
        <h1 className="app-h2">Sign in to continue</h1>
        <p className="sk-muted">This screen needs an account. No wallet needed.</p>
        <ButtonLink variant="primary" href={href}>
          Sign in
        </ButtonLink>
      </section>
    );
  }
  return <>{children}</>;
}
