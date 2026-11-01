// renderWithProviders: the real <Providers> tree with a fake api, a fake realtime and in-memory
// credentials. Use it for every component test.
//
//   const { api, realtime, user } = renderWithProviders(<CreditsScreen />, {
//     handle: 'ada',                                  // signed in (null/omitted: signed out)
//     api: { credits: async () => ({ ...creditsFixture }) },
//     path: '/account/credits',                       // usePathname() value
//   });
//   expect(await screen.findByTestId('screen-s15')).toBeInTheDocument();
//
// Wallet and Privy paths (non-dev mode): `{ authMode: 'privy', token: 'jwt', wallet: new FakeWallet() }`
// signs in with a Privy token; `privy: new FakePrivy()` controls Privy's state (src/test/fakePrivy.ts).
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { Providers, createQueryClient } from '@/components/Providers';
import type { ApiClient } from '@/lib/api/client';
import { createCredentialsStore, type CredentialsStore } from '@/lib/auth/credentials';
import type { AuthMode } from '@/lib/config';
import { createFakeApi, type FakeApi } from './fakeApi';
import { FakePrivy } from './fakePrivy';
import { FakeWallet } from './fakeWallet';
import { FakeRealtime } from './fakeRealtime';
import { testRouter } from './router';

export interface RenderOptions {
  /** Signed in as this dev handle. */
  handle?: string | null;
  /** Methods to stub, or a ready FakeApi. `createSession` defaults to succeeding. */
  api?: Partial<ApiClient> | FakeApi;
  realtime?: FakeRealtime;
  path?: string;
  search?: string;
  /** Overrides config.authMode (default 'dev'). 'privy' turns every money flow into wallet calls. */
  authMode?: AuthMode;
  /** Signed in with this Privy token (implies authMode 'privy' unless given). */
  token?: string | null;
  wallet?: FakeWallet;
  /** privy mode: defaults to a ready FakePrivy, authenticated when `token` is given. */
  privy?: FakePrivy;
}

export interface RenderWithProvidersResult extends RenderResult {
  api: FakeApi;
  realtime: FakeRealtime;
  credentials: CredentialsStore;
  wallet: FakeWallet;
  privy: FakePrivy | undefined;
  user: UserEvent;
  router: typeof testRouter;
}

const isFake = (a: unknown): a is FakeApi =>
  !!a && typeof (a as { me?: { mock?: unknown } }).me?.mock === 'object';

export function renderWithProviders(ui: ReactElement, opts: RenderOptions = {}): RenderWithProvidersResult {
  const authMode: AuthMode = opts.authMode ?? (opts.token ? 'privy' : 'dev');
  const credentials = createCredentialsStore({
    storage: null,
    initial: opts.token ? { kind: 'privy', token: opts.token } : opts.handle ? { kind: 'dev', handle: opts.handle } : null,
  });
  const wallet = opts.wallet ?? new FakeWallet();
  const privy =
    authMode === 'privy'
      ? (opts.privy ?? new FakePrivy({ ready: true, authenticated: !!opts.token, ...(opts.token ? { token: opts.token } : {}) }))
      : undefined;
  const api = isFake(opts.api)
    ? opts.api
    : createFakeApi({
        createSession: async () => {
          const c = credentials.get();
          const handle = c?.kind === 'dev' ? c.handle : 'privy-user';
          return { account: { id: 'acc_test', handle, nearAccountId: null }, created: false };
        },
        ...opts.api,
      });
  const realtime = opts.realtime ?? new FakeRealtime();
  testRouter.reset(opts.path ?? '/', opts.search ?? '');
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false, gcTime: Infinity },
  });
  const user = userEvent.setup();
  const result = render(
    <Providers services={{ api, realtime, credentials, wallet, authMode, ...(privy ? { privy } : {}) }} queryClient={queryClient}>
      {ui}
    </Providers>,
  );
  return { ...result, api, realtime, credentials, wallet, privy, user, router: testRouter };
}
