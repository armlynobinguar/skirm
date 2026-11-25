// "Benchmark seeds: 🎲 drawn on-chain, 🔒 sealed until run → ✅ revealed", with each step lit as the
// seed's reveal moves on (badgeSteps). Presentational only (no chain code), so the Exchange cards can
// show it without loading ethers.
import type { OnchainBenchmark } from '@skirm/shared';
import { badgeSteps } from './badge';
import s from './benchmarks.module.css';

const STATE_LABEL = { done: 'done', current: 'in progress', pending: 'not yet' } as const;

export function SeedsBadge({ status, compact = false }: { status: OnchainBenchmark['status']; compact?: boolean }) {
  const steps = badgeSteps(status);
  const step = (key: keyof typeof steps, icon: string, text: string) => (
    <span className={s.step} data-state={steps[key]} data-testid={`zama-bench-step-${key}`} title={`${text}: ${STATE_LABEL[steps[key]]}`}>
      {icon} {compact ? null : text}
    </span>
  );
  return (
    <span className={s.badge} data-testid="zama-bench-badge" data-status={status} aria-label={`Benchmark seeds: drawn on-chain, sealed until run, ${status === 'revealed' ? 'revealed' : 'not revealed yet'}`}>
      <span className={s.label}>Benchmark seeds:</span>
      {step('drawn', '🎲', 'drawn on-chain,')}
      {step('sealed', '🔒', 'sealed until run')}
      <span className={s.arrow} aria-hidden>
        →
      </span>
      {step('revealed', '✅', 'revealed')}
    </span>
  );
}
