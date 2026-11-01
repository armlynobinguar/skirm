// Who the browser is signed in as. One store per app, shared by the api client (headers), the
// realtime client (WS auth message) and the session context (UI state).
//
// dev mode:   { kind: 'dev', handle }  → REST header `x-dev-user: <handle>`, WS `{type:'auth', devUser}`
// privy mode: { kind: 'privy', token } → REST `Authorization: Bearer <jwt>`, WS `{type:'auth', token}`
//
// Only the dev handle is persisted (localStorage `skirm.devUser`). A Privy token comes from the
// Privy SDK on each load and is refreshed before it expires (./privy.ts, ./session.tsx).

export type Credentials = { kind: 'dev'; handle: string } | { kind: 'privy'; token: string };

export const DEV_USER_STORAGE_KEY = 'skirm.devUser';

export interface CredentialsStore {
  get(): Credentials | null;
  /** Replaces the credentials (null signs out) and notifies subscribers. */
  set(c: Credentials | null): void;
  subscribe(fn: (c: Credentials | null) => void): () => void;
}

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function safeStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // private mode / blocked storage
  }
}

/** A store that persists the dev handle. `storage: null` keeps everything in memory (tests). */
export function createCredentialsStore(
  opts: { storage?: StorageLike | null; initial?: Credentials | null; restoreDevHandle?: boolean } = {},
): CredentialsStore {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  let current: Credentials | null = opts.initial ?? null;
  if (current === null && storage && opts.restoreDevHandle !== false) {
    try {
      const handle = storage.getItem(DEV_USER_STORAGE_KEY);
      if (handle) current = { kind: 'dev', handle };
    } catch {
      /* ignore */
    }
  }
  const subs = new Set<(c: Credentials | null) => void>();
  return {
    get: () => current,
    set(c) {
      current = c;
      try {
        if (c?.kind === 'dev') storage?.setItem(DEV_USER_STORAGE_KEY, c.handle);
        else storage?.removeItem(DEV_USER_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      for (const fn of [...subs]) fn(c);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** REST headers for a set of credentials. */
export function authHeaders(c: Credentials | null): Record<string, string> {
  if (!c) return {};
  return c.kind === 'dev' ? { 'x-dev-user': c.handle } : { authorization: `Bearer ${c.token}` };
}

/** Dev handles the api accepts (packages/server/src/auth.ts normaliseDevHandle). */
export const DEV_HANDLE_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

/** Trims and lower-cases like the server does; null when the server would refuse it. */
export function normaliseDevHandle(raw: string): string | null {
  const h = raw.trim().toLowerCase();
  return DEV_HANDLE_RE.test(h) ? h : null;
}
