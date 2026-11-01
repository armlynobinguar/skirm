'use client';
// Every client-side provider, in one place: services (api, realtime, credentials, wallet, privy),
// TanStack Query, session, toasts, and the cache invalidation that follows realtime events.
// privy mode also mounts the Privy SDK (lib/auth/PrivyRoot.tsx) beside the app, through a dynamic
// import after hydration; dev mode never loads it.
// The root layout renders <Providers>; tests render the same tree with fakes (src/test/render.tsx).
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { isApiError } from '@/lib/api/errors';
import { qk } from '@/lib/api/queries';
import type { PrivyClient, PrivyController } from '@/lib/auth/privy';
import { SessionProvider } from '@/lib/auth/session';
import { ServicesContext, createBrowserServices, useServices, type Services } from '@/lib/services';
import { ToastProvider } from './toast/ToastProvider';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        // Client errors (4xx) will not change on retry; network and 5xx get two more tries.
        retry: (count, err) => {
          if (isApiError(err) && err.status >= 400 && err.status < 500) return false;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/** Keeps balances and lists fresh when a v2 match this tab plays or watches ends. */
export function RealtimeInvalidation() {
  const { realtime } = useServices();
  const qc = useQueryClient();
  useEffect(
    () =>
      realtime.onMessage((m) => {
        if (m.type !== 'v2_end') return;
        // qk.me covers the rank, the earn-back and the recent matches (all under 'me').
        void qc.invalidateQueries({ queryKey: qk.me });
        void qc.invalidateQueries({ queryKey: qk.credits });
        void qc.invalidateQueries({ queryKey: qk.leaderboards.all });
        void qc.invalidateQueries({ queryKey: qk.seasons.all });
        void qc.invalidateQueries({ queryKey: qk.matches.all });
      }),
    [realtime, qc],
  );
  return null;
}

const PRIVY_READY_TIMEOUT_MS = 10_000;

const isController = (p: PrivyClient | undefined): p is PrivyController =>
  !!p && typeof (p as Partial<PrivyController>).attach === 'function';

/** Loads and mounts the Privy SDK (privy mode with an app id only). */
function PrivyMount() {
  const { privy } = useServices();
  const [Root, setRoot] = useState<ComponentType<{ controller: PrivyController }> | null>(null);
  const controller = isController(privy) && privy.appId ? privy : null;
  useEffect(() => {
    if (!controller) return;
    let live = true;
    // Privy not ready in time (chunk failed, bad app id, blocked network): stop showing "loading";
    // S01 then shows its buttons and a sign-in attempt explains the failure.
    const giveUp = setTimeout(() => controller.markUnavailable(), PRIVY_READY_TIMEOUT_MS);
    import('@/lib/auth/PrivyRoot')
      .then((m) => {
        if (live) setRoot(() => m.default);
      })
      .catch(() => controller.markUnavailable());
    return () => {
      live = false;
      clearTimeout(giveUp);
    };
  }, [controller]);
  return controller && Root ? <Root controller={controller} /> : null;
}

export interface ProvidersProps {
  children: ReactNode;
  /** Tests: fake api / realtime / credentials. Default: the browser services. */
  services?: Services;
  queryClient?: QueryClient;
}

export function Providers({ children, services, queryClient }: ProvidersProps) {
  const [svc] = useState(() => services ?? createBrowserServices());
  const [qc] = useState(() => queryClient ?? createQueryClient());
  return (
    <ServicesContext.Provider value={svc}>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <ToastProvider>
            <RealtimeInvalidation />
            <PrivyMount />
            {children}
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ServicesContext.Provider>
  );
}
