// Privy sign-in (NEXT_PUBLIC_AUTH_MODE=privy). The Privy React SDK lives only in ./PrivyRoot.tsx,
// which <Providers> loads with a dynamic import in privy mode, so dev builds never fetch it.
//
// This file is the SDK-free half: a controller the session talks to (login, access token, logout,
// ready/authenticated state) and PrivyRoot plugs Privy's hooks into once mounted.
//
//   S01 "Continue with Google" → session.signIn({method:'google'}) → privy.login('google')
//     → Privy modal → onComplete → getAccessToken() → credentials { kind:'privy', token }
//     → POST /auth/session { token } (+ Authorization: Bearer on every call, WS {type:'auth', token})
//   Reload: Privy restores its own session → state {ready, authenticated} → the session fetches a
//     token without a click. Tokens last about an hour; session.tsx refreshes them before expiry.
import { ApiError } from '../api/errors';

export type PrivyLoginMethod = 'google' | 'email';

export interface PrivyState {
  /** Privy has loaded and knows whether a session exists. */
  ready: boolean;
  authenticated: boolean;
}

/** What the session uses. Tests pass a fake (src/test/fakePrivy.ts). */
export interface PrivyClient {
  getState(): PrivyState;
  subscribe(fn: () => void): () => void;
  /** Opens Privy's login for `method`; resolves with the access token (JWT) once signed in. */
  login(method: PrivyLoginMethod): Promise<string>;
  /** A fresh access token (Privy refreshes it when close to expiry), or null when signed out. */
  getAccessToken(): Promise<string | null>;
  logout(): Promise<void>;
}

/** The Privy hooks PrivyRoot hands over. */
export interface PrivyBridge {
  /** Opens the modal (useLogin().login). Completion arrives through loginComplete / loginFailed. */
  openLogin(method: PrivyLoginMethod): void;
  getAccessToken(): Promise<string | null>;
  logout(): Promise<void>;
}

export interface PrivyController extends PrivyClient {
  readonly appId: string;
  readonly clientId: string;
  attach(bridge: PrivyBridge): () => void;
  update(state: PrivyState): void;
  loginComplete(): void;
  loginFailed(code: string): void;
  /**
   * Privy did not load or never became ready (bad app id, blocked network): report "ready, signed
   * out" so screens stop waiting. Login still waits for the real SDK and times out with an error.
   */
  markUnavailable(): void;
}

export class PrivyNotConfiguredError extends Error {
  constructor() {
    super('Privy sign-in is not set up in this build (NEXT_PUBLIC_PRIVY_APP_ID is empty).');
    this.name = 'PrivyNotConfiguredError';
  }
}

const READY_TIMEOUT_MS = 15_000;

export function createPrivyController(opts: { appId: string; clientId?: string }): PrivyController {
  // No app id: nothing will mount, so report "ready, signed out" right away (S01 then explains).
  let state: PrivyState = { ready: !opts.appId, authenticated: false };
  let bridge: PrivyBridge | null = null;
  /** The SDK itself said ready (state.ready can also come from markUnavailable). */
  let sdkReady = false;
  let pending: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  const subs = new Set<() => void>();
  const notify = () => {
    for (const fn of [...subs]) fn();
  };

  const whenReady = () =>
    new Promise<PrivyBridge>((resolve, reject) => {
      const check = () => {
        if (bridge && sdkReady) {
          cleanup();
          resolve(bridge);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new ApiError(
            503,
            'privy_unavailable',
            'Privy did not load. Check the connection and try again.',
          ),
        );
      }, READY_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        subs.delete(check);
      };
      subs.add(check);
      check();
    });

  const token = async (b: PrivyBridge) => {
    const t = await b.getAccessToken();
    if (!t)
      throw new ApiError(401, 'privy_no_token', 'Privy signed in but returned no access token.');
    return t;
  };

  return {
    appId: opts.appId,
    clientId: opts.clientId ?? '',
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    async login(method) {
      if (!opts.appId) throw new PrivyNotConfiguredError();
      const b = await whenReady();
      if (state.authenticated) return token(b);
      pending?.reject(new ApiError(400, 'privy_superseded', 'Another sign-in started.'));
      const done = new Promise<void>((resolve, reject) => {
        pending = { resolve, reject };
      });
      b.openLogin(method);
      await done;
      return token(b);
    },
    async getAccessToken() {
      return bridge ? bridge.getAccessToken() : null;
    },
    async logout() {
      if (bridge) await bridge.logout();
    },
    attach(b) {
      bridge = b;
      notify();
      return () => {
        if (bridge === b) bridge = null;
      };
    },
    update(next) {
      sdkReady = next.ready;
      if (next.ready === state.ready && next.authenticated === state.authenticated) return;
      state = next;
      notify();
    },
    markUnavailable() {
      if (state.ready) return;
      state = { ready: true, authenticated: false };
      notify();
    },
    loginComplete() {
      pending?.resolve();
      pending = null;
    },
    loginFailed(code) {
      pending?.reject(
        code === 'exited_auth_flow'
          ? new ApiError(400, 'privy_cancelled', 'Sign-in was closed before it finished.')
          : new ApiError(401, `privy_${code}`, `Privy sign-in failed (${code}).`),
      );
      pending = null;
    },
  };
}

/** Seconds since epoch at which a JWT expires, or null if it cannot be read. */
export function jwtExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}
