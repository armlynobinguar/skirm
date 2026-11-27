'use client';
// What a confidential action is waiting for, on every screen: Encrypting → Signing → Confirming →
// Decrypting, with a "Try again" when the Zama relayer keeps failing. Driven by lib/zama/steps.
import { Button } from '@skirm/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ZAMA_STEPS, zamaProgress, type ZamaStep } from '@/lib/zama/steps';
import s from './progress.module.css';

const LABEL: Record<ZamaStep, string> = { encrypt: 'Encrypting', sign: 'Signing', confirm: 'Confirming', decrypt: 'Decrypting' };
const HINT: Record<ZamaStep, string> = {
  encrypt: 'In this tab, before anything leaves it.',
  sign: 'Confirm in your wallet.',
  confirm: 'Waiting for Sepolia, usually 12 to 30 seconds.',
  decrypt: 'The Zama network is checking the request.',
};

export function ZamaProgress() {
  const p = useSyncExternalStore(zamaProgress.subscribe, zamaProgress.get, zamaProgress.serverState);
  // Overlapping actions: show the latest to start.
  const step = p.active[p.active.length - 1] ?? null;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!step) return;
    const t = setInterval(() => setSeconds((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, [step]);

  if (!step && !p.done.length) return null;
  return (
    <aside className={`sk-panel ${s.panel}`} data-testid="zama-progress" aria-label="Confidential action">
      <ol className={s.steps}>
        {ZAMA_STEPS.map((k) => {
          const on = p.active.includes(k);
          const done = !on && p.done.includes(k);
          return (
            <li key={k} className={on ? s.on : done ? s.done : s.todo} aria-current={k === step ? 'step' : undefined} data-state={on ? 'active' : done ? 'done' : 'todo'}>
              <span aria-hidden="true">{done ? '✓' : on ? '●' : '○'}</span> {LABEL[k]}
            </li>
          );
        })}
      </ol>
      {p.failed ? (
        <div className={s.failed} role="alert">
          <p className={s.hint}>The Zama relayer is not answering. Nothing was sent twice.</p>
          <div className={s.actions}>
            <Button size="sm" onClick={p.failed.retry}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={p.failed.giveUp}>
              Give up
            </Button>
          </div>
        </div>
      ) : step ? (
        <p className={s.hint}>
          <span aria-live="polite">{p.retry ? `The Zama relayer did not answer, trying again (${p.retry})…` : HINT[step]}</span>
          {seconds >= 5 ? <span className={s.time}> {seconds}s</span> : null}
        </p>
      ) : (
        <p className={s.hint}>Done.</p>
      )}
    </aside>
  );
}
