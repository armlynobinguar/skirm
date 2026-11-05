'use client';
// /verify: anyone pastes a match id and checks it against the NEAR registry in their own browser
// (no account needed). `?id=` prefills and runs it, so a check can be shared as a link.
import { Button } from '@skirm/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Skeleton } from '@/components/states/Skeleton';
import { config } from '@/lib/config';
import { routes } from '@/lib/routes';
import { VerifyPanel } from './VerifyPanel';
import s from './verify.module.css';

/** A pasted id, a match URL (`/matches/<id>…`) or a verify link; the id alone, trimmed. */
export function matchIdFrom(input: string): string {
  const t = input.trim();
  const m = /\/matches\/([^/?#\s]+)/.exec(t) ?? /[?&]id=([^&#\s]+)/.exec(t);
  if (!m) return t;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

export function VerifyScreen() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <VerifyForm />
    </Suspense>
  );
}

function VerifyForm() {
  const router = useRouter();
  const current = useSearchParams().get('id')?.trim() || '';
  const [text, setText] = useState(current);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = matchIdFrom(text);
    if (id) router.replace(routes.verify(id));
  };
  return (
    <div className={`sk-panel ${s.page}`} data-testid="verify-screen">
      <h1 className="app-h2">Verify a match</h1>
      <p className={s.intro}>
        Every match keeps a hash-chained log of each tick’s actions and talk. Ranked results are written to the {config.near.contracts.registry} contract on NEAR {config.near.network} with the log’s final hash. This page fetches the log, recomputes the chain in your browser and reads the record straight from a NEAR RPC node, so you don’t have to trust skirm’s servers for it.
      </p>
      <form className={s.form} onSubmit={submit}>
        <label>
          Match id or link
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="mat_…" spellCheck={false} autoComplete="off" data-testid="verify-input" />
        </label>
        <Button type="submit" variant="primary" disabled={!matchIdFrom(text)} data-testid="verify-submit">
          Check
        </Button>
      </form>
      {current ? <VerifyPanel key={current} matchId={current} showPageLink={false} auto /> : null}
    </div>
  );
}
