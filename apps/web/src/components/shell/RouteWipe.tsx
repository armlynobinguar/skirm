'use client';
// The slanted wipe that carries you between screens (the prototype's #wipe). Next.js has already
// swapped the page when the path changes, so the wipe starts fully covering the screen (set before
// paint) and sweeps off, revealing the new screen with its name on the band. It plays when the
// screen changes (screenOf(path).key), not on query-string or same-screen changes, and never on the
// first render. Reduced motion skips it.
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { usePreferences } from '@/lib/preferences';
import { screenOf, type ScreenLabel } from '@/lib/routes';
import { useSfx } from '@/lib/sfx';

/** How long the reveal runs; matches .app-wipe in globals.css. */
export const WIPE_MS = 480;

export function RouteWipe() {
  const pathname = usePathname() ?? '/';
  const screen = screenOf(pathname);
  const key = screen?.key ?? pathname;
  const last = useRef<string | null>(null);
  const [shown, setShown] = useState<{ n: number; label: ScreenLabel | null } | null>(null);
  const { reducedMotion } = usePreferences();
  const sfx = useSfx();

  useLayoutEffect(() => {
    const prev = last.current;
    last.current = key;
    if (prev === null || prev === key || reducedMotion) return;
    sfx.play('wipe');
    setShown((s) => ({ n: (s?.n ?? 0) + 1, label: screen }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on screen changes only
  }, [key]);

  useLayoutEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), WIPE_MS);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  return (
    <div key={shown.n} className="app-wipe" aria-hidden="true" data-testid="route-wipe">
      <i />
      <i />
      <i />
      {shown.label ? (
        <div className="app-wipe-label">
          <b>{shown.label.title}</b>
          <small>{shown.label.sub}</small>
        </div>
      ) : null}
    </div>
  );
}
