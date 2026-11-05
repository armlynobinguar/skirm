'use client';
// "Verify on NEAR": a button that runs ./verify.ts in the browser and shows verified / mismatch /
// not recorded onchain / NEAR unreachable, each check and nearblocks links. Used on the debrief, the
// shared replay and the standalone /verify page.
import { Button } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { config } from '@/lib/config';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { verifyMatch, type VerifyReport, type VerifyStatus } from './verify';
import s from './verify.module.css';

const HEADLINE: Record<VerifyStatus, string> = {
  verified: '✓ Verified on NEAR',
  mismatch: '✗ Mismatch',
  not_recorded: 'Not recorded onchain',
  unavailable: 'NEAR could not be read',
};

const SUMMARY: Record<VerifyStatus, string> = {
  verified: 'The registry record matches the log your browser rechained: same log hash, winner and score.',
  mismatch: 'Something does not agree. The checks below show what.',
  not_recorded: 'The log still checks out in your browser against the server’s hash.',
  unavailable: 'The log still checks out in your browser; only the onchain comparison is missing.',
};

/** The button and, once run, the report. `auto` runs it at once (the /verify page). Each click runs it afresh. */
export function VerifyPanel({ matchId, showPageLink = true, auto = false }: { matchId: string; showPageLink?: boolean; auto?: boolean }) {
  const api = useApi();
  const [round, setRound] = useState(auto ? 1 : 0);
  const run = useQuery({
    queryKey: ['verify', matchId, round],
    queryFn: () => verifyMatch(api, matchId),
    enabled: round > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const pending = round > 0 && run.isFetching;
  return (
    <section className={`sk-panel ${s.panel}`} aria-label="Verify on NEAR" data-testid="verify-panel">
      <span className="sk-kick">
        <b>Verify on NEAR</b> · recomputed in your browser, read straight from {config.near.contracts.registry}
      </span>
      <div className={s.actions}>
        <Button size="sm" variant="primary" onClick={() => setRound((n) => n + 1)} disabled={pending} data-testid="verify-run">
          {pending ? 'Verifying…' : run.data ? 'Verify again' : 'Verify on NEAR'}
        </Button>
        {showPageLink ? (
          <a className={s.link} href={routes.verify(matchId)}>
            Share this check
          </a>
        ) : null}
      </div>
      {run.error ? <p className={s.error} role="alert">{errorText(run.error)}</p> : null}
      {run.data ? <VerifyResult report={run.data} /> : null}
    </section>
  );
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'No match with that id.';
    if (err.code === 'match_live') return 'The match is still being played. Verify it once it ends.';
    if (err.status === 0) return 'Could not reach the skirm api.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Verification failed.';
}

export function VerifyResult({ report }: { report: VerifyReport }) {
  return (
    <div className={s.result} data-status={report.status} data-testid="verify-result">
      <p className={s.headline} data-testid="verify-status">
        {HEADLINE[report.status]}
      </p>
      {report.reason ? <p className={s.reason}>{report.reason}</p> : null}
      <p className={s.summary}>{SUMMARY[report.status]}</p>
      <ul className={s.checks}>
        {report.checks.map((c) => (
          <li key={c.id} data-ok={c.ok || undefined} data-testid={`verify-check-${c.id}`}>
            <span className={s.mark}>{c.ok ? '✓' : '✗'}</span>
            <span>
              <b>{c.label}</b> <small>{c.where === 'browser' ? 'in your browser' : 'onchain'}</small>
              <br />
              <code>{c.detail}</code>
            </span>
          </li>
        ))}
      </ul>
      {report.record ? (
        <p className={s.meta}>
          Recorded at block {report.record.block_height}
          {report.record.recorded_at_ms ? ` · ${new Date(Number(report.record.recorded_at_ms)).toISOString().replace('.000Z', 'Z')}` : ''}
        </p>
      ) : null}
      <p className={s.links}>
        <a href={report.links.contract} target="_blank" rel="noreferrer">
          Registry on nearblocks
        </a>
        {report.links.tx ? (
          <a href={report.links.tx} target="_blank" rel="noreferrer" data-testid="verify-tx">
            Registry transaction
          </a>
        ) : null}
      </p>
    </div>
  );
}
