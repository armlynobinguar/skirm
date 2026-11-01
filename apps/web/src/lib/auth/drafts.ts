// Unsaved skill-editor drafts hold secret prompt text in localStorage under
// `skirm.skillEditor.unsaved.*`. They must not outlive the session that wrote them, so sign-out (and
// a switch to another account) removes them.

export const SKILL_DRAFT_PREFIX = 'skirm.skillEditor.unsaved.';

type KeyedStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

function defaultStorage(): KeyedStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Removes every `skirm.skillEditor.unsaved.*` key. Never throws; returns how many were removed. */
export function clearPrivateDrafts(storage: KeyedStorage | null = defaultStorage()): number {
  if (!storage) return 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(SKILL_DRAFT_PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
    return keys.length;
  } catch {
    return 0;
  }
}
