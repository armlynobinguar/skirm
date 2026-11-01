'use client';
// The app's long-lived clients, shared through one React context:
//   api         typed REST client (src/lib/api/client.ts)
//   realtime    the single WebSocket (src/lib/realtime/client.ts)
//   credentials who we are signed in as (src/lib/auth/credentials.ts)
//   wallet      the player's NEAR wallet (src/lib/wallet; NEAR Connect, loaded on first use)
//   privy       Privy sign-in controller, privy mode only (src/lib/auth/privy.ts)
//   authMode    config.authMode unless a test overrides it
// <Providers> (src/app/providers.tsx) creates the real ones; tests pass fakes through
// renderWithProviders (src/test/render.tsx). Components only ever call the hooks below.
import { createContext, useContext } from 'react';
import { createApiClient, type ApiClient } from './api/client';
import { createCredentialsStore, type CredentialsStore } from './auth/credentials';
import { createPrivyController, type PrivyClient } from './auth/privy';
import { config, type AuthMode } from './config';
import { RealtimeClient, type Realtime } from './realtime/client';
import { createNearConnectWallet } from './wallet/nearConnect';
import type { NearWallet } from './wallet/types';

export interface Services {
  api: ApiClient;
  realtime: Realtime;
  credentials: CredentialsStore;
  wallet: NearWallet;
  /** Present in privy mode only. */
  privy?: PrivyClient;
  /** Defaults to config.authMode. */
  authMode?: AuthMode;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices: wrap the tree in <Providers> (or renderWithProviders in tests)');
  return s;
}

/** The typed REST client. Use it inside react-query queryFn / mutationFn. */
export const useApi = (): ApiClient => useServices().api;

/** The shared WebSocket client. Prefer useRunStream / useMatchStream / useRealtimeMessage. */
export const useRealtime = (): Realtime => useServices().realtime;

/** Real services for the browser (and a socket-less, storage-less shell during SSR). */
export function createBrowserServices(): Services {
  const privy = config.authMode === 'privy';
  // Only dev mode restores a stored handle; a Privy session comes back from Privy itself.
  const credentials = createCredentialsStore(privy ? { restoreDevHandle: false } : {});
  return {
    credentials,
    api: createApiClient({ baseUrl: config.apiUrl, credentials }),
    realtime: new RealtimeClient({ url: config.wsUrl, credentials }),
    wallet: createNearConnectWallet({ network: config.near.network }),
    ...(privy ? { privy: createPrivyController({ appId: config.privyAppId, clientId: config.privyClientId }) } : {}),
    authMode: config.authMode,
  };
}

/** The auth mode in effect (tests can override config through Services.authMode). */
export const useAuthMode = (): AuthMode => useServices().authMode ?? config.authMode;
