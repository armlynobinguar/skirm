// The benchmark seeds badge and panel with the chain faked: the steps per status, the tx links,
// "Verify benchmark" passing and failing, and nothing at all with NEXT_PUBLIC_ZAMA_ENABLED off.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cfg } = vi.hoisted(() => ({ cfg: { enabled: true } }));
vi.mock('@/lib/zama/config', () => ({
  zamaConfig: {
    get enabled() {
      return cfg.enabled;
    },
    chainId: 11155111,
    rpcUrl: 'http://127.0.0.1:1',
    explorerUrl: 'https://sepolia.etherscan.io',
    contracts: { benchmarks: null },
  },
}));

import { BenchmarkSeedsPanel } from './BenchmarkSeedsPanel';
import { SeedsBadge } from './SeedsBadge';
import { ZamaBenchmarkSeedsChip } from './ZamaBenchmarkSlots';
import { fixture } from './testFixtures';

describe('SeedsBadge', () => {
  it('reads "Benchmark seeds: 🎲 drawn on-chain, 🔒 sealed until run → ✅ revealed" with the steps lit', () => {
    render(<SeedsBadge status="committed" />);
    expect(screen.getByTestId('zama-bench-badge').textContent).toBe('Benchmark seeds:🎲 drawn on-chain,🔒 sealed until run→✅ revealed');
    expect(screen.getByTestId('zama-bench-step-drawn').dataset.state).toBe('done');
    expect(screen.getByTestId('zama-bench-step-sealed').dataset.state).toBe('current');
    expect(screen.getByTestId('zama-bench-step-revealed').dataset.state).toBe('pending');
  });
});

describe('BenchmarkSeedsPanel', () => {
  beforeEach(() => {
    cfg.enabled = true;
  });

  it('links the transactions and verifies a revealed benchmark', async () => {
    const { onchain, chain } = fixture();
    const api = { read: vi.fn(async () => chain) };
    render(<BenchmarkSeedsPanel skillId="skl_x" version={2} onchain={onchain} promptSha256={'ab'.repeat(32)} score={0.5} api={api} />);
    expect(screen.getByTestId('zama-bench-tx-commit')).toHaveAttribute('href', 'https://sepolia.etherscan.io/tx/0xc0');
    expect(screen.getByTestId('zama-bench-tx-reveal')).toHaveAttribute('href', 'https://sepolia.etherscan.io/tx/0xf0');
    fireEvent.click(screen.getByTestId('zama-bench-verify'));
    await waitFor(() => expect(screen.getByTestId('zama-bench-result').dataset.ok).toBe('true'));
    expect(screen.getByTestId('zama-bench-check-picks').dataset.ok).toBe('true');
    expect(screen.getByTestId('zama-bench-check-results').dataset.ok).toBe('true');
  });

  it('says so when the posted score does not match', async () => {
    const { onchain, chain } = fixture();
    render(<BenchmarkSeedsPanel skillId="skl_x" version={2} onchain={onchain} promptSha256={null} score={0.9} api={{ read: async () => chain }} />);
    fireEvent.click(screen.getByTestId('zama-bench-verify'));
    await waitFor(() => expect(screen.getByTestId('zama-bench-result').dataset.ok).toBe('false'));
    expect(screen.getByTestId('zama-bench-check-score').dataset.ok).toBe('false');
  });

  it('offers no verify before the reveal, and shows a chain error', async () => {
    const { onchain } = fixture();
    const { rerender } = render(<BenchmarkSeedsPanel skillId="skl_x" version={2} onchain={{ ...onchain, status: 'committed', publishTx: null, finalizeTx: null }} promptSha256={null} score={null} />);
    expect(screen.queryByTestId('zama-bench-verify')).toBeNull();
    expect(screen.queryByTestId('zama-bench-tx-publish')).toBeNull();
    rerender(
      <BenchmarkSeedsPanel
        skillId="skl_x"
        version={2}
        onchain={onchain}
        promptSha256={null}
        score={null}
        api={{
          read: async () => {
            throw new Error('rpc down');
          },
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('zama-bench-verify'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('rpc down'));
  });
});

describe('ZamaBenchmarkSeedsChip', () => {
  it('renders nothing with the flag off or for keyed seeds', () => {
    cfg.enabled = false;
    const off = render(<ZamaBenchmarkSeedsChip status="revealed" />);
    expect(off.container.innerHTML).toBe('');
    cfg.enabled = true;
    const keyed = render(<ZamaBenchmarkSeedsChip status={null} />);
    expect(keyed.container.innerHTML).toBe('');
    render(<ZamaBenchmarkSeedsChip status="revealed" />);
    expect(screen.getByTestId('zama-bench-badge').dataset.status).toBe('revealed');
  });
});
