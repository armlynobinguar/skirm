'use client';
// The skill page's benchmark seeds record (NEXT_PUBLIC_ZAMA_ENABLED): the badge, the commit /
// publish / reveal transactions, and "Verify benchmark", which reads BenchmarkSeeds from the chain
// and checks that the revealed seed deals the six (map, difficulty) picks that were played and that
// their log hashes hash to the results the server posted before the seed opened.
import { useState } from 'react';
import {
  benchmarkContract,
  benchmarkSeedsApi,
  explorerLink,
  readOnlyRunner,
  verifyBenchmarkOnChain,
  type BenchmarkOnchainView,
  type BenchmarkSeedsApi,
  type VerifyResult,
} from './benchmarks';
import { SeedsBadge } from './SeedsBadge';
import s from './benchmarks.module.css';

export interface BenchmarkSeedsPanelProps {
  skillId: string;
  version: number;
  onchain: BenchmarkOnchainView;
  /** The version's pinned prompt hash (checked against the one committed on chain). */
  promptSha256: string | null;
  /** The benchmark score the Exchange shows (checked against the posted one). */
  score: number | null;
  /** Injected in tests; defaults to BenchmarkSeeds over the public RPC. */
  api?: BenchmarkSeedsApi;
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Could not read the chain. Try again.');

export function BenchmarkSeedsPanel({ skillId, version, onchain, promptSha256, score, api }: BenchmarkSeedsPanelProps) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contract = benchmarkContract(onchain);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      setResult(await verifyBenchmarkOnChain(api ?? benchmarkSeedsApi(readOnlyRunner(), contract), { skillId, version, onchain, promptSha256, score }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const txs: [string, string | null][] = [
    ['commit', onchain.commitTx],
    ['publish', onchain.publishTx],
    ['reveal', onchain.finalizeTx],
  ];
  return (
    <div className={s.panel} data-testid="zama-bench-panel">
      <SeedsBadge status={onchain.status} />
      <p className={s.muted}>
        {onchain.status === 'revealed'
          ? 'Drawn with FHE randomness after the prompt was committed, sealed while the benchmark played, then revealed with a KMS proof.'
          : onchain.status === 'published'
            ? 'Results posted on chain; the seed is open and its proof is being submitted.'
            : 'Drawn with FHE randomness after the prompt was committed. Only the platform’s operator can read it until the run is over.'}
      </p>
      <p className={s.row}>
        {txs.map(([label, tx]) =>
          tx ? (
            <a key={label} className={s.link} href={explorerLink(tx, contract)} target="_blank" rel="noreferrer" data-testid={`zama-bench-tx-${label}`}>
              {label} tx
            </a>
          ) : null,
        )}
        {onchain.status === 'revealed' ? (
          <button type="button" className={s.link} onClick={() => void verify()} disabled={busy} data-testid="zama-bench-verify">
            {busy ? 'Verifying…' : 'Verify benchmark'}
          </button>
        ) : null}
      </p>
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <div data-testid="zama-bench-result" data-ok={result.ok}>
          <p className={s.row}>{result.ok ? '✅ Verified: the benchmark played exactly the seeds drawn on chain.' : '❌ Does not verify.'}</p>
          <ul className={s.checks}>
            {result.checks.map((c) => (
              <li key={c.name} data-testid={`zama-bench-check-${c.name}`} data-ok={c.ok}>
                {c.ok ? '✓' : '✗'} {c.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
