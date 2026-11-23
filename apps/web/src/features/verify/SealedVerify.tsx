'use client';
// "Verify a sealed round on Sepolia": for a match played on SkirmMatch's FHE randomness, the
// /verify page reads SkirmMatch straight from a public Sepolia RPC (no wallet) and runs the checks of
// ./sealed.ts in the browser: commitments before the seed, the KMS-verified seed and drops, the
// revealed loadouts, the anchored log hash and winner, a replay through the engine, and what stays
// encrypted. `fixture-sealed-round` (and its `~tamper` variants) shows the same checks on a
// fixture, labelled as such, so the page can be demoed before the contracts are deployed.
// Mounted through ./ZamaVerifySlot (NEXT_PUBLIC_ZAMA_ENABLED only).
import { Button } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import type { PublicMatchLog } from '@/lib/api/matchLogTypes';
import { routes } from '@/lib/routes';
import { useApi } from '@/lib/services';
import { zamaConfig } from '@/lib/zama/config';
import { buildSealedReport, isSealedLog, type SealedCheckState, type SealedReport, type SealedStatus } from './sealed';
import { ethersSealedSource, matchFromBlock, readSealedChain } from './sealedChain';
import { FIXTURE_TAMPERS, fixtureId, fixtureVariant, sealedFixture, type FixtureTamper } from './sealedFixture';
import s from './verify.module.css';

const MARK: Record<SealedCheckState, string> = { pass: '✅', fail: '❌', pending: '⏳', private: '🔒' };
const MARK_LABEL: Record<SealedCheckState, string> = { pass: 'pass', fail: 'fail', pending: 'not on chain yet', private: 'kept private' };

const HEADLINE: Record<SealedStatus, string> = {
  verified: 'Pass · Fair round, verified on Sepolia',
  mismatch: 'Fail · Mismatch',
  incomplete: 'Not finished on chain yet',
};
const GLYPH: Record<SealedStatus, string> = { verified: '✓', mismatch: '✗', incomplete: '–' };
const DATA_STATUS: Record<SealedStatus, string> = { verified: 'verified', mismatch: 'mismatch', incomplete: 'unavailable' };

/** The match log, shared by the debrief link and the panel (one fetch). null: no log for this match. */
export function useMatchLog(matchId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ['v2-match-log', matchId],
    queryFn: () =>
      api.v2MatchLog(matchId).catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 404 || err.status === 409)) return null;
        throw err;
      }),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

type Outcome = { kind: 'report'; report: SealedReport; contract: string | null } | { kind: 'not_found'; contract: string };

async function runLive(matchId: string, log: PublicMatchLog): Promise<Outcome> {
  const address = zamaConfig.contracts.match!;
  const chain = await readSealedChain(ethersSealedSource(address), matchId, { fromBlock: matchFromBlock() });
  if (chain.status === 'none') return { kind: 'not_found', contract: address };
  return { kind: 'report', report: buildSealedReport(log.log, chain), contract: address };
}

/** The Sepolia section for one match: nothing for a match that was not a sealed round. */
export function SealedVerify({ matchId, auto = true }: { matchId: string; auto?: boolean }) {
  const fixture = fixtureVariant(matchId);
  if (fixture) return <FixtureVerify tamper={fixture.tamper} />;
  return <LiveVerify matchId={matchId} auto={auto} />;
}

function LiveVerify({ matchId, auto }: { matchId: string; auto: boolean }) {
  const log = useMatchLog(matchId);
  const sealed = isSealedLog(log.data?.log);
  const deployed = !!zamaConfig.contracts.match;
  const [round, setRound] = useState(auto ? 1 : 0);
  const run = useQuery({
    queryKey: ['verify-sealed', matchId, round],
    queryFn: () => runLive(matchId, log.data!),
    enabled: sealed && deployed && round > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  if (!sealed) return null;
  const pending = round > 0 && run.isFetching;
  return (
    <section className={`sk-panel ${s.panel}`} aria-label="Verify the sealed round on Sepolia" data-testid="sealed-verify">
      <Kicker />
      {!deployed ? (
        <p className={s.reason} data-testid="sealed-undeployed">
          This was a sealed round, but SkirmMatch is not deployed in this build, so there is nothing on Sepolia to read. <a href={routes.verify(fixtureId(null))}>See the checks on a fixture</a>.
        </p>
      ) : (
        <div className={s.actions}>
          <Button size="sm" variant="primary" onClick={() => setRound((n) => n + 1)} disabled={pending} data-testid="sealed-run">
            {pending ? 'Reading Sepolia…' : run.data ? 'Verify again' : 'Verify on Sepolia'}
          </Button>
        </div>
      )}
      {run.error ? (
        <p className={s.error} role="alert">
          Could not read SkirmMatch on Sepolia: {run.error instanceof Error ? run.error.message : 'unknown error'}.
        </p>
      ) : null}
      {run.data?.kind === 'not_found' ? (
        <p className={s.reason} data-testid="sealed-not-found">
          SkirmMatch at <code>{run.data.contract}</code> has no record of this match.
        </p>
      ) : null}
      {run.data?.kind === 'report' ? <SealedResult report={run.data.report} contract={run.data.contract} /> : null}
    </section>
  );
}

function FixtureVerify({ tamper }: { tamper: FixtureTamper | null }) {
  const f = sealedFixture(tamper);
  const report = buildSealedReport(f.log.log, f.chain, { rosters: f.rosters });
  return (
    <section className={`sk-panel ${s.panel}`} aria-label="Verify a sealed round (fixture)" data-testid="sealed-verify" data-fixture>
      <Kicker />
      <p className={s.fixture} data-testid="sealed-fixture-label">
        <b>Fixture, not a live match.</b> A round played through the real engine with the SkirmMatch record it would leave on Sepolia, so the checks can be seen before the contracts are deployed. Transaction hashes are placeholders and link nowhere. {tamper ? `Tampered: ${tamper}.` : 'Honest round.'}
      </p>
      <p className={s.sample}>
        <span>Try a tampered copy:</span>
        <a href={routes.verify(fixtureId(null))} aria-current={tamper === null || undefined}>
          honest
        </a>
        {FIXTURE_TAMPERS.map((t) => (
          <a key={t} href={routes.verify(fixtureId(t))} aria-current={tamper === t || undefined} data-testid={`sealed-fixture-${t}`}>
            {t}
          </a>
        ))}
      </p>
      <SealedResult report={report} contract={null} />
    </section>
  );
}

function Kicker() {
  return (
    <span className="sk-kick">
      <b>Verify the sealed round on Sepolia</b> · read from SkirmMatch over public RPC, checked in your browser, no wallet needed
    </span>
  );
}

const txUrl = (hash: string) => `${zamaConfig.explorerUrl}/tx/${hash}`;

export function SealedResult({ report, contract }: { report: SealedReport; contract: string | null }) {
  return (
    <div className={s.result} data-status={DATA_STATUS[report.status]} data-testid="sealed-result">
      <div className={s.verdict}>
        <span className={s.glyph} aria-hidden="true">
          {GLYPH[report.status]}
        </span>
        <div>
          <p className={s.headline} data-testid="sealed-status">
            {HEADLINE[report.status]}
          </p>
          <p className={s.summary}>
            {report.status === 'verified'
              ? 'The seed, drops and crews the match played are the ones SkirmMatch sealed and revealed, and the log your browser rechained and replayed is the one anchored on chain.'
              : report.status === 'mismatch'
                ? 'Something does not agree. The checks below show what.'
                : 'Nothing disagrees, but some steps are not on chain yet.'}
          </p>
        </div>
      </div>
      <ol className={s.sealedChecks} aria-label="Every check">
        {report.checks.map((c) => (
          <li key={c.id} data-state={c.state} data-testid={`sealed-check-${c.id}`}>
            <span className={s.sealedMark} role="img" aria-label={MARK_LABEL[c.state]}>
              {MARK[c.state]}
            </span>
            <div>
              <b>{c.label}</b>
              <p className={s.sealedDetail}>{c.detail}</p>
              <details>
                <summary>Why this matters</summary>
                <p className={s.sealedWhy}>{c.why}</p>
              </details>
              {c.lines.length ? (
                <ul className={s.sealedLines}>
                  {c.lines.map((l, i) => (
                    <li key={i}>
                      <code>{l}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
              {c.txs.length ? (
                <p className={s.links}>
                  {c.txs.map((t, i) =>
                    contract ? (
                      <a key={`${t.hash}-${i}`} href={txUrl(t.hash)} target="_blank" rel="noreferrer">
                        {t.label} ↗
                      </a>
                    ) : (
                      <span key={`${t.hash}-${i}`} title={t.hash}>
                        {t.label} (fixture tx)
                      </span>
                    ),
                  )}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {contract ? (
        <p className={s.links}>
          <a href={`${zamaConfig.explorerUrl}/address/${contract}`} target="_blank" rel="noreferrer" data-testid="sealed-contract">
            SkirmMatch on Sepolia Etherscan ↗
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** The debrief's "Verify this round" button (to /verify?id=), shown only for a sealed round. */
export function VerifyRoundLink({ matchId }: { matchId: string }) {
  const router = useRouter();
  const log = useMatchLog(matchId);
  if (!isSealedLog(log.data?.log)) return null;
  return (
    <section className={`sk-panel ${s.panel}`} aria-label="Verify this sealed round" data-testid="verify-round-link">
      <span className="sk-kick">
        <b>Sealed round on Sepolia</b> · seed, drops, crews and log hash, checked by anyone in their own browser
      </span>
      <div className={s.actions}>
        <Button size="sm" variant="primary" onClick={() => router.push(routes.verify(matchId))} data-testid="verify-round">
          Verify this round
        </Button>
      </div>
    </section>
  );
}
