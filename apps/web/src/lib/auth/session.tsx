'use client';
// Session state for the UI. The CredentialsStore is the source of truth; this context adds
// sign-in / sign-out and a status that is stable through hydration:
//
//   'loading'   server render and the first client render (localStorage is not read yet)
//   'signedOut' no credentials
//   'signedIn'  credentials present (account may still be loading; use useMe() for data)
//
// Signing in (dev mode) stores the handle, calls POST /auth/session (creates the account with the
// starter defaults on first sign-in) and clears the query cache. A stored handle is re-validated
// once per page load with the same call, so a wiped local database just recreates the account.
//
// privy mode: signIn opens Privy (./privy.ts) and stores `{ kind: 'privy', token }`. On load the
// status stays 'loading' until Privy is ready; a session Privy restored gets its token without a
// click. The token is refreshed (getAccessToken) a minute before it expires, when the tab becomes
// visible again with a stale token, and after Privy reports a sign-out the credentials are cleared.
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { isApiError } from '../api/errors';
import type { Account } from '../api/types';
import type { AuthMode } from '../config';
import { useAuthMode, useServices } from '../services';
import { normaliseDevHandle, type Credentials } from './credentials';
import { clearPrivateDrafts } from './drafts';
import { jwtExpiry, type PrivyClient, type PrivyState } from './privy';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface Session {
  status: SessionStatus;
  mode: AuthMode;
  /** Dev handle (dev mode) once signed in; null otherwise. */
  handle: string | null;
  /** dev mode: sign in as `handle`. privy mode: `method` picks the Privy flow. Throws ApiError. */
  signIn(input: { handle?: string; method?: 'google' | 'email' }): Promise<Account>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

const SERVER_SNAPSHOT: Credentials | null | undefined = undefined;
const NOT_PRIVY: PrivyState = { ready: true, authenticated: false };
const PRIVY_SERVER: PrivyState = { ready: false, authenticated: false };
const noSubscribe = () => () => {};

/** Refresh this long before the token's `exp`. */
const REFRESH_LEAD_MS = 60_000;

function usePrivyState(privy: PrivyClient | undefined): PrivyState {
  return useSyncExternalStore(
    privy ? privy.subscribe : noSubscribe,
    privy ? privy.getState : () => NOT_PRIVY,
    () => (privy ? PRIVY_SERVER : NOT_PRIVY),
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { api, credentials, privy } = useServices();
  const mode = useAuthMode();
  const queryClient = useQueryClient();
  const privyState = usePrivyState(mode === 'privy' ? privy : undefined);
  const signingIn = useRef(false);

  // undefined = not read yet (SSR / hydration), so markup matches the server's.
  const creds = useSyncExternalStore<Credentials | null | undefined>(
    credentials.subscribe,
    credentials.get,
    () => SERVER_SNAPSHOT,
  );

  // Re-validate a stored session once per load.
  const validated = useRef(false);
  useEffect(() => {
    if (validated.current || !creds) return;
    validated.current = true;
    api.createSession(creds.kind === 'privy' ? { token: creds.token } : {}).catch((err: unknown) => {
      if (isApiError(err) && (err.status === 401 || err.status === 403)) {
        clearPrivateDrafts();
        credentials.set(null);
        queryClient.clear();
        // The server refused Privy's token: end the Privy session too, or it would be picked up again.
        if (creds.kind === 'privy') void privy?.logout().catch(() => undefined);
      }
    });
  }, [api, credentials, creds, queryClient, privy]);

  // privy: pick up a session Privy restored, and drop ours when Privy signs out.
  useEffect(() => {
    if (mode !== 'privy' || !privy || !privyState.ready || signingIn.current) return;
    const current = credentials.get();
    if (privyState.authenticated && !current) {
      let live = true;
      privy
        .getAccessToken()
        .then((token) => {
          if (live && token && !credentials.get()) credentials.set({ kind: 'privy', token });
        })
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }
    if (!privyState.authenticated && current?.kind === 'privy') {
      clearPrivateDrafts();
      credentials.set(null);
      queryClient.clear();
    }
    return undefined;
  }, [mode, privy, privyState, credentials, queryClient]);

  // privy: refresh the access token before it expires.
  useEffect(() => {
    if (mode !== 'privy' || !privy || creds?.kind !== 'privy') return;
    const token = creds.token;
    const refresh = () => {
      privy
        .getAccessToken()
        .then((next) => {
          const cur = credentials.get();
          if (next && cur?.kind === 'privy' && cur.token === token && next !== token) credentials.set({ kind: 'privy', token: next });
        })
        .catch(() => undefined);
    };
    const exp = jwtExpiry(token);
    const dueIn = exp === null ? 10 * 60_000 : Math.max(exp * 1000 - Date.now() - REFRESH_LEAD_MS, 5_000);
    const timer = setTimeout(refresh, Math.min(dueIn, 2 ** 31 - 1));
    // Timers are throttled in background tabs: check again when the tab comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && exp !== null && exp * 1000 - Date.now() < REFRESH_LEAD_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mode, privy, creds, credentials]);

  const signIn = useCallback<Session['signIn']>(
    async ({ handle, method }) => {
      const prev = credentials.get();
      let next: Credentials;
      if (mode === 'privy') {
        if (!privy) throw new Error('Privy sign-in is not set up in this build.');
        signingIn.current = true;
        try {
          next = { kind: 'privy', token: await privy.login(method ?? 'google') };
        } finally {
          signingIn.current = false;
        }
      } else {
        const h = normaliseDevHandle(handle ?? '');
        if (!h) throw new Error('Handles are 2 to 32 characters: a-z, 0-9, _ . -');
        next = { kind: 'dev', handle: h };
      }
      validated.current = true; // this call is the validation
      // Another account's unsaved prompt drafts must not carry over.
      if (prev && (prev.kind !== next.kind || (prev.kind === 'dev' && next.kind === 'dev' && prev.handle !== next.handle)))
        clearPrivateDrafts();
      credentials.set(next);
      try {
        const res = await api.createSession(next.kind === 'privy' ? { token: next.token } : {});
        queryClient.clear();
        return res.account;
      } catch (err) {
        credentials.set(prev);
        if (next.kind === 'privy') await privy?.logout().catch(() => undefined);
        throw err;
      }
    },
    [api, credentials, queryClient, mode, privy],
  );

  const signOut = useCallback(async () => {
    clearPrivateDrafts();
    credentials.set(null);
    queryClient.clear();
    // Our session is already gone; a failed Privy logout must not leave the button doing nothing.
    if (mode === 'privy' && privy) await privy.logout().catch(() => undefined);
  }, [credentials, queryClient, mode, privy]);

  // privy: still 'loading' until Privy knows whether it has a session (and its token is fetched).
  const privyPending = mode === 'privy' && !creds && (!privyState.ready || privyState.authenticated);

  const value = useMemo<Session>(
    () => ({
      status: creds === undefined || privyPending ? 'loading' : creds ? 'signedIn' : 'signedOut',
      mode,
      handle: creds?.kind === 'dev' ? creds.handle : null,
      signIn,
      signOut,
    }),
    [creds, privyPending, mode, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession: wrap the tree in <Providers>');
  return s;
}
