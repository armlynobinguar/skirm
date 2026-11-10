'use client';
// /verify: anyone pastes a match id and checks it against the NEAR registry in their own browser
// (no account needed). `?id=` prefills and runs it, so a check can be shared as a link. "Try a
// recent match" lists the latest ranked matches recorded on NEAR (GET /v2/matches/recorded), so a
// visitor without an id of their own has one to check; with none recorded yet it falls back to
// NEXT_PUBLIC_SAMPLE_MATCH_ID, and says so plainly when there is neither.
import { Button } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Skeleton } from '@/components/states/Skeleton';
import { mapById } from '@/features/arena/world';
import type { V2RecordedMatch } from '@/lib/api/types';
import { config } from '@/lib/config';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
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
  const sample = config.sampleMatchId;
  const api = useApi();
  const recorded = useQuery({ queryKey: ['matches', 'v2-recorded'], queryFn: () => api.v2RecordedMatches(), retry: false, staleTime: 60_000 });
  const recent = (recorded.data ?? []).slice(0, 3);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = matchIdFrom(text);
    if (id) router.replace(routes.verify(id));
  };
  const pick = (id: string) => {
    setText(id);
    router.replace(routes.verify(id));
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
      {recent.length ? (
        <div className={s.sample} data-testid="verify-recent">
          <span>No match id to hand? Try a recent ranked match recorded on NEAR:</span>
          {recent.map((m) => (
            <Button key={m.id} size="sm" variant="secondary" onClick={() => pick(m.id)} disabled={current === m.id} data-testid={`verify-recent-${m.id}`}>
              {recentLabel(m)}
            </Button>
          ))}
        </div>
      ) : sample ? (
        <p className={s.sample}>
          <span>No match id to hand?</span>
          <Button size="sm" variant="secondary" onClick={() => pick(sample)} disabled={current === sample} data-testid="verify-sample">
            Try a sample match
          </Button>
          <span>a ranked match recorded on NEAR</span>
        </p>
      ) : recorded.isSuccess && !current ? (
        <p className={s.sample} data-testid="verify-none">
          No ranked match is recorded on NEAR yet. The first ranked results will be listed here to check.
        </p>
      ) : null}
      {current ? <VerifyPanel key={current} matchId={current} showPageLink={false} auto /> : null}
    </div>
  );
}

/** "ana 3–2 ben · Copper Hollow": who played, the score and the map. */
function recentLabel(m: V2RecordedMatch): string {
  const who = `${m.handles.A ?? '?'} ${m.score ? `${m.score.A}–${m.score.B}` : 'vs'} ${m.handles.B ?? '?'}`;
  return `${who} · ${mapById(m.mapId)?.name ?? m.mapId}`;
}
