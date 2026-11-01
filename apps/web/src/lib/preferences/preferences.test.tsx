import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  createPreferencesStore,
  sanitizePreferences,
  usePreferences,
  type PreferencesStore,
} from './index';

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function fakeQuery(matches: boolean) {
  const ls = new Set<() => void>();
  return {
    matches,
    addEventListener: (_: 'change', l: () => void) => void ls.add(l),
    removeEventListener: (_: 'change', l: () => void) => void ls.delete(l),
    fire(m: boolean) {
      this.matches = m;
      for (const l of ls) l();
    },
  };
}

describe('preferences store', () => {
  it('defaults, follows prefers-reduced-motion until the player chooses', () => {
    const q = fakeQuery(true);
    const s = createPreferencesStore({ storage: memStorage(), reducedMotionQuery: q, listenToStorageEvents: false });
    expect(s.get().prefs).toEqual(DEFAULT_PREFERENCES);
    expect(s.get().reducedMotion).toBe(true);
    s.set({ reducedMotion: false });
    expect(s.get()).toMatchObject({ reducedMotion: false, systemReducedMotion: true });
    s.set({ reducedMotion: null });
    expect(s.get().reducedMotion).toBe(true);
  });

  it('persists, sanitizes and survives broken storage', () => {
    const st = memStorage();
    const s = createPreferencesStore({ storage: st, reducedMotionQuery: null, listenToStorageEvents: false });
    s.set({ replaySpeed: 4, sfx: false, showProbabilities: false });
    expect(JSON.parse(st.map.get(PREFERENCES_KEY)!)).toMatchObject({ replaySpeed: 4, sfx: false });
    const again = createPreferencesStore({ storage: st, reducedMotionQuery: null, listenToStorageEvents: false });
    expect(again.get().prefs).toMatchObject({ replaySpeed: 4, sfx: false, showProbabilities: false });
    again.reset();
    expect(st.map.has(PREFERENCES_KEY)).toBe(false);

    expect(sanitizePreferences({ replaySpeed: 3, sfx: 'loud', reducedMotion: 'yes' })).toEqual(DEFAULT_PREFERENCES);
    const junk = memStorage({ [PREFERENCES_KEY]: '{not json' });
    expect(createPreferencesStore({ storage: junk, reducedMotionQuery: null }).get().prefs).toEqual(DEFAULT_PREFERENCES);
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const t = createPreferencesStore({ storage: throwing, reducedMotionQuery: null });
    expect(() => t.set({ replaySpeed: 2 })).not.toThrow();
    expect(t.get().prefs.replaySpeed).toBe(2);
  });

});

function Probe({ store }: { store: PreferencesStore }) {
  const p = usePreferences(store);
  return (
    <div data-testid="probe">
      {p.prefs.replaySpeed}|{String(p.reducedMotion)}
    </div>
  );
}

describe('usePreferences', () => {
  it('re-renders on set and on OS changes', () => {
    const q = fakeQuery(false);
    const store = createPreferencesStore({ storage: memStorage(), reducedMotionQuery: q, listenToStorageEvents: false });
    render(<Probe store={store} />);
    expect(screen.getByTestId('probe').textContent).toBe('1|false');
    act(() => store.set({ replaySpeed: 2 }));
    expect(screen.getByTestId('probe').textContent).toBe('2|false');
    act(() => q.fire(true));
    expect(screen.getByTestId('probe').textContent).toBe('2|true');
  });
});
