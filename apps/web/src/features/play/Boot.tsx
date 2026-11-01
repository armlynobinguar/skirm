'use client';
// The Boot screen (the prototype's #s-boot) at the top of S01: the SKIRM mark over the arena, a
// loader that fills while the map pack is built and the session is checked, then "Tap to start".
// Start goes to the Command deck when signed in, else down to the sign-in form below; Enter anywhere
// taps it once the loader is full (useStartKey). Reduced motion skips the fill.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStartKey } from '@/components/shell/GlobalKeys';
import { MAPS } from '@/features/arena/world';
import { useSession } from '@/lib/auth/session';
import { usePreferences } from '@/lib/preferences';
import { routes } from '@/lib/routes';
import { sfxEngine } from '@/lib/sfx';

const STEPS = ['Loading map pack', `Mirroring ${MAPS.length} arenas`, 'Checking session', 'Syncing NEAR testnet', 'Ready'];
/** How long the loader takes to fill at least, so it reads as a loader. */
export const BOOT_MIN_MS = 1200;

export function Boot({ signInId }: { signInId: string }) {
  const router = useRouter();
  const { status } = useSession();
  const { reducedMotion, prefs } = usePreferences();
  const [elapsed, setElapsed] = useState(0);
  const sessionKnown = status !== 'loading';

  useEffect(() => {
    if (reducedMotion) return;
    const t0 = performance.now();
    const iv = setInterval(() => setElapsed(performance.now() - t0), 90);
    return () => clearInterval(iv);
  }, [reducedMotion]);

  const timed = reducedMotion ? 1 : Math.min(1, elapsed / BOOT_MIN_MS);
  // Hold at the session step until the session is known.
  const pct = Math.round((sessionKnown ? timed : Math.min(timed, 0.6)) * 100);
  const done = pct >= 100;
  const step = STEPS[Math.min(STEPS.length - 1, Math.floor((pct / 100) * (STEPS.length - 1)))]!;

  const start = () => {
    if (prefs.sfx) sfxEngine().play('good');
    if (status === 'signedIn') router.push(routes.home());
    else document.getElementById(signInId)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  };
  useStartKey(done, start, { space: false });

  return (
    <section className="s01-boot" aria-label="Start" data-testid="s01-boot">
      <div className="s01-boot-mark">
        <div className="s01-boot-sub">Two crews · one goal · every word counts</div>
        <div className="s01-boot-logo" aria-hidden="true">
          SKI<span>R</span>M
        </div>
        {done ? (
          <button type="button" className="s01-tap" onClick={start} data-testid="s01-tap">
            {status === 'signedIn' ? 'Tap to start' : 'Tap to sign in'}
          </button>
        ) : (
          <div className="s01-load" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Loading">
            <span className="s01-load-bar">
              <i style={{ width: `${pct}%` }} />
            </span>
            <span className="s01-load-row">
              <span>{step}</span>
              <span className="sk-mono">{pct}%</span>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
