'use client';
// Viewer preferences (UI/UX Spec S16 Settings and the S16 artboard; "Reduced motion"): sound effects,
// default replay speed, reduced motion, action probabilities and tag names. Per browser, kept in
// localStorage (`skirm.prefs.v1`, every access in try/catch), shared by every hook in the tab and
// synced across tabs. Reduced motion follows `prefers-reduced-motion` until the player picks a value.
//
//   const { prefs, reducedMotion, set } = usePreferences();   // prefs.replaySpeed, prefs.sfx, …
//   set({ replaySpeed: 2 });            // persisted
//   set({ reducedMotion: null });       // back to following the OS
import { useSyncExternalStore } from 'react';

export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface Preferences {
  /** Interface sound effects (the v2 Arena clicks, wipes and match stings). On by default. */
  sfx: boolean;
  /** Replay speed picked on the S16 Settings card (1x by default); only that card reads it. */
  replaySpeed: ReplaySpeed;
  /** true/false: the player's choice; null: follow `prefers-reduced-motion`. */
  reducedMotion: boolean | null;
  /** The S16 Settings "Show action probabilities" toggle; only that card reads it. */
  showProbabilities: boolean;
  /** The S16 Settings "Show tag names" toggle; only that card reads it. */
  showTagNames: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  sfx: true,
  replaySpeed: 1,
  reducedMotion: null,
  showProbabilities: true,
  showTagNames: false,
});

export const PREFERENCES_KEY = 'skirm.prefs.v1';

export interface PreferencesSnapshot {
  /** What is stored (reducedMotion may be null). */
  prefs: Preferences;
  /** Resolved: the player's choice, else the OS setting. */
  reducedMotion: boolean;
  /** The OS `prefers-reduced-motion: reduce` setting. */
  systemReducedMotion: boolean;
}

type PrefStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type MediaQuery = Pick<MediaQueryList, 'matches'> & {
  addEventListener?: (t: 'change', l: () => void) => void;
  removeEventListener?: (t: 'change', l: () => void) => void;
};

export interface PreferencesStoreOptions {
  storage?: PrefStorage | null;
  /** `window.matchMedia('(prefers-reduced-motion: reduce)')` or a stand-in. */
  reducedMotionQuery?: MediaQuery | null;
  /** Cross-tab sync (default: window `storage` events when there is a window). */
  listenToStorageEvents?: boolean;
}

export interface PreferencesStore {
  get(): PreferencesSnapshot;
  set(patch: Partial<Preferences>): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

/** Keeps only known keys with valid values; anything else falls back to the default. */
export function sanitizePreferences(raw: unknown): Preferences {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PREFERENCES;
  return {
    sfx: typeof r.sfx === 'boolean' ? r.sfx : d.sfx,
    replaySpeed: (REPLAY_SPEEDS as readonly unknown[]).includes(r.replaySpeed)
      ? (r.replaySpeed as ReplaySpeed)
      : d.replaySpeed,
    reducedMotion: typeof r.reducedMotion === 'boolean' ? r.reducedMotion : null,
    showProbabilities: typeof r.showProbabilities === 'boolean' ? r.showProbabilities : d.showProbabilities,
    showTagNames: typeof r.showTagNames === 'boolean' ? r.showTagNames : d.showTagNames,
  };
}

function browserStorage(): PrefStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function browserReducedMotion(): MediaQuery | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  } catch {
    return null;
  }
}

export function createPreferencesStore(opts: PreferencesStoreOptions = {}): PreferencesStore {
  const storage = opts.storage === undefined ? browserStorage() : opts.storage;
  const mq = opts.reducedMotionQuery === undefined ? browserReducedMotion() : opts.reducedMotionQuery;
  const listeners = new Set<() => void>();

  const read = (): Preferences => {
    try {
      const raw = storage?.getItem(PREFERENCES_KEY);
      return raw ? sanitizePreferences(JSON.parse(raw)) : { ...DEFAULT_PREFERENCES };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  };

  let prefs = read();
  let snapshot: PreferencesSnapshot;
  const rebuild = () => {
    const system = !!mq?.matches;
    snapshot = { prefs, systemReducedMotion: system, reducedMotion: prefs.reducedMotion ?? system };
  };
  rebuild();
  const emit = () => {
    rebuild();
    for (const l of [...listeners]) l();
  };

  const onMedia = () => emit();
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== PREFERENCES_KEY) return;
    prefs = read();
    emit();
  };
  const listenStorage = opts.listenToStorageEvents ?? typeof window !== 'undefined';

  return {
    get: () => snapshot,
    set(patch) {
      prefs = sanitizePreferences({ ...prefs, ...patch });
      try {
        storage?.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
      } catch {
        // Private mode or full storage: keep the choice for this page only.
      }
      emit();
    },
    reset() {
      prefs = { ...DEFAULT_PREFERENCES };
      try {
        storage?.removeItem(PREFERENCES_KEY);
      } catch {
        // ignore
      }
      emit();
    },
    subscribe(listener) {
      if (listeners.size === 0) {
        mq?.addEventListener?.('change', onMedia);
        if (listenStorage) window.addEventListener('storage', onStorage);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          mq?.removeEventListener?.('change', onMedia);
          if (listenStorage) window.removeEventListener('storage', onStorage);
        }
      };
    },
  };
}

let shared: PreferencesStore | null = null;
/** The tab-wide store (created on first use in the browser). */
export function preferencesStore(): PreferencesStore {
  return (shared ??= createPreferencesStore());
}

const SERVER_SNAPSHOT: PreferencesSnapshot = {
  prefs: { ...DEFAULT_PREFERENCES },
  reducedMotion: false,
  systemReducedMotion: false,
};

export interface UsePreferences extends PreferencesSnapshot {
  set(patch: Partial<Preferences>): void;
  reset(): void;
}

/** Viewer preferences. Server render and hydration see the defaults. */
export function usePreferences(store: PreferencesStore = preferencesStore()): UsePreferences {
  const snap = useSyncExternalStore(store.subscribe, store.get, () => SERVER_SNAPSHOT);
  return {
    ...snap,
    set: store.set,
    reset: store.reset,
  };
}
