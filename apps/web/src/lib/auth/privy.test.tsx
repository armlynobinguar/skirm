// Privy without an app id: the SDK is mocked, so these check our wiring (PrivyRoot ⇄ controller ⇄
// session), not Privy itself.
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/components/Providers';
import { createCredentialsStore } from './credentials';
import { createPrivyController, jwtExpiry, PrivyNotConfiguredError } from './privy';
import { useSession } from './session';
import { createFakeApi } from '@/test/fakeApi';
import { FakeRealtime } from '@/test/fakeRealtime';
import { FakeWallet } from '@/test/fakeWallet';

// ----- a stand-in for @privy-io/react-auth -----
const sdk = vi.hoisted(() => {
  const state = { ready: false, authenticated: false, token: 'jwt_1' as string | null };
  const listeners = new Set<() => void>();
  let callbacks: { onComplete?: () => void; onError?: (code: string) => void } = {};
  return {
    state,
    loginCalls: [] as unknown[],
    providerProps: [] as Array<Record<string, unknown>>,
    imported: 0,
    set(next: Partial<typeof state>) {
      Object.assign(state, next);
      for (const fn of [...listeners]) fn();
    },
    listeners,
    setCallbacks(c: typeof callbacks) {
      callbacks = c;
    },
    complete() {
      this.set({ authenticated: true });
      callbacks.onComplete?.();
    },
    fail(code: string) {
      callbacks.onError?.(code);
    },
    logout: vi.fn(async () => undefined),
  };
});

vi.mock('@privy-io/react-auth', async () => {
  sdk.imported += 1;
  const React = await import('react');
  const useTick = () => {
    const [, set] = React.useState(0);
    React.useEffect(() => {
      const fn = () => set((n) => n + 1);
      sdk.listeners.add(fn);
      return () => {
        sdk.listeners.delete(fn);
      };
    }, []);
  };
  const getAccessToken = async () => (sdk.state.authenticated ? sdk.state.token : null);
  return {
    PrivyProvider: ({ children, ...props }: { children: React.ReactNode }) => {
      sdk.providerProps.push(props);
      return <>{children}</>;
    },
    usePrivy: () => {
      useTick();
      return { ready: sdk.state.ready, authenticated: sdk.state.authenticated, getAccessToken };
    },
    useLogin: (cb: { onComplete?: () => void; onError?: (code: string) => void }) => {
      sdk.setCallbacks(cb);
      return { login: React.useCallback((o: unknown) => sdk.loginCalls.push(o), []) };
    },
    useLogout: () => ({ logout: sdk.logout }),
  };
});

const jwt = (exp: number) => `h.${btoa(JSON.stringify({ exp, sub: 'did:privy:x' }))}.s`;

beforeEach(() => {
  sdk.set({ ready: false, authenticated: false, token: 'jwt_1' });
  sdk.loginCalls.length = 0;
  sdk.providerProps.length = 0;
  sdk.logout.mockClear();
});
afterEach(() => vi.useRealTimers());

function Probe() {
  const s = useSession();
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <button
        type="button"
        onClick={() => void s.signIn({ method: 'google' }).catch(() => undefined)}
      >
        google
      </button>
      <button type="button" onClick={() => void s.signOut()}>
        out
      </button>
    </div>
  );
}

function renderPrivy(appId = 'app_test') {
  const credentials = createCredentialsStore({ storage: null });
  const privy = createPrivyController({ appId, clientId: 'client_1' });
  const api = createFakeApi({
    createSession: async () => ({
      account: { id: 'acc_p', handle: 'p_x', nearAccountId: null },
      created: true,
    }),
  });
  render(
    <Providers
      services={{
        api,
        realtime: new FakeRealtime(),
        credentials,
        wallet: new FakeWallet(),
        privy,
        authMode: 'privy',
      }}
    >
      <Probe />
    </Providers>,
  );
  return { credentials, privy, api };
}

describe('dev mode', () => {
  it('dev mode never imports the Privy SDK', async () => {
    const credentials = createCredentialsStore({ storage: null });
    render(
      <Providers
        services={{
          api: createFakeApi(),
          realtime: new FakeRealtime(),
          credentials,
          wallet: new FakeWallet(),
          authMode: 'dev',
        }}
      >
        <Probe />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    await new Promise((r) => setTimeout(r, 20));
    expect(sdk.providerProps).toHaveLength(0);
    // Runs first in this file: the (mocked) SDK module has never been evaluated.
    expect(sdk.imported).toBe(0);
  });
});

describe('Privy controller', () => {
  it('without an app id: ready and signed out, and login explains', async () => {
    const c = createPrivyController({ appId: '' });
    expect(c.getState()).toEqual({ ready: true, authenticated: false });
    await expect(c.login('google')).rejects.toBeInstanceOf(PrivyNotConfiguredError);
  });

  it('markUnavailable stops the waiting but login still needs the real SDK', async () => {
    vi.useFakeTimers();
    const c = createPrivyController({ appId: 'app_x' });
    expect(c.getState().ready).toBe(false);
    c.markUnavailable();
    expect(c.getState()).toEqual({ ready: true, authenticated: false });
    const login = c.login('google');
    const result = expect(login).rejects.toMatchObject({ code: 'privy_unavailable' });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });

  it('reads a JWT expiry', () => {
    expect(jwtExpiry(jwt(1_900_000_000))).toBe(1_900_000_000);
    expect(jwtExpiry('nope')).toBeNull();
  });
});

describe('Privy sign-in (mocked SDK)', () => {
  it('mounts PrivyProvider with the app id, client id and Google + email', async () => {
    renderPrivy();
    await waitFor(() => expect(sdk.providerProps.length).toBeGreaterThan(0));
    expect(sdk.imported).toBe(1); // privy mode loads the SDK (dynamic import)
    expect(sdk.providerProps.at(-1)).toMatchObject({
      appId: 'app_test',
      clientId: 'client_1',
      config: expect.objectContaining({ loginMethods: ['google', 'email'] }),
    });
    // Privy not ready yet: neither signed in nor out.
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    act(() => sdk.set({ ready: true }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
  });

  it('logs in → access token → POST /auth/session {token} → signed in', async () => {
    const { credentials, api } = renderPrivy();
    act(() => sdk.set({ ready: true }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    act(() => screen.getByRole('button', { name: 'google' }).click());
    await waitFor(() => expect(sdk.loginCalls).toEqual([{ loginMethods: ['google'] }]));
    act(() => sdk.complete());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedIn'));
    expect(credentials.get()).toEqual({ kind: 'privy', token: 'jwt_1' });
    expect(api.createSession).toHaveBeenCalledWith({ token: 'jwt_1' });
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });

  it('stays signed out when the player closes the Privy modal', async () => {
    const { credentials, api } = renderPrivy();
    act(() => sdk.set({ ready: true }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    act(() => screen.getByRole('button', { name: 'google' }).click());
    await waitFor(() => expect(sdk.loginCalls).toHaveLength(1));
    act(() => sdk.fail('exited_auth_flow'));
    await new Promise((r) => setTimeout(r, 10));
    expect(credentials.get()).toBeNull();
    expect(api.createSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('status')).toHaveTextContent('signedOut');
  });

  it('picks up a session Privy restored on load, without a click', async () => {
    sdk.set({ ready: true, authenticated: true, token: 'jwt_restored' });
    const { credentials, api } = renderPrivy();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedIn'));
    expect(credentials.get()).toEqual({ kind: 'privy', token: 'jwt_restored' });
    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith({ token: 'jwt_restored' }));
  });

  it('refreshes the token a minute before it expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const now = Math.floor(Date.now() / 1000);
    sdk.set({ ready: true, authenticated: true, token: jwt(now + 120) });
    const { credentials } = renderPrivy();
    await waitFor(() =>
      expect(credentials.get()).toEqual({ kind: 'privy', token: jwt(now + 120) }),
    );
    sdk.state.token = jwt(now + 3720);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() =>
      expect(credentials.get()).toEqual({ kind: 'privy', token: jwt(now + 3720) }),
    );
  });

  it('signs out of Privy too', async () => {
    sdk.set({ ready: true, authenticated: true });
    const { credentials } = renderPrivy();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedIn'));
    act(() => screen.getByRole('button', { name: 'out' }).click());
    await waitFor(() => expect(sdk.logout).toHaveBeenCalled());
    expect(credentials.get()).toBeNull();
  });
});
