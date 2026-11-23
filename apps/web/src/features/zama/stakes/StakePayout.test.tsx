// The debrief stake card with the chain, wallet and relayer faked: nothing for an unstaked match,
// the public "stake counted" flags, the "Settled on Sepolia" link once the server settles, and the
// player's own payout decrypted on demand.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MATCH, m } = vi.hoisted(() => ({
  MATCH: '0x00000000000000000000000000000000000000aa',
  m: { connect: vi.fn(), revealPayout: vi.fn() },
}));

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: 'http://127.0.0.1:1', explorerUrl: 'https://sepolia.etherscan.io', contracts: { credits: null, match: MATCH } },
}));
vi.mock('@/lib/zama/wallet', async (orig) => ({ ...(await orig<typeof import('@/lib/zama/wallet')>()), connectEvmWallet: m.connect }));
vi.mock('@/lib/zama/relayer', () => ({ getFhevmInstance: vi.fn(async () => ({})) }));
vi.mock('./stakes', async (orig) => ({ ...(await orig<typeof import('./stakes')>()), revealPayout: m.revealPayout }));

import { StakePayout } from './StakePayout';
import type { ChainEscrow, ChainSettlement, StakesApi } from './stakes';

const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;
const TX = H(0xc0ffee);
const LOG = H(0x1065);

function fakeApi(e: Partial<ChainEscrow>, st: Partial<ChainSettlement> = {}) {
  const state = {
    escrow: { minStake: 10_000_000n, feeBps: 250, staked: [H(1), H(2)], paid: [H(3), H(4)], stakeOk: [true, false], ...e } as ChainEscrow,
    settlement: { logHash: null, winner: null, settledAt: 0, txHash: null, ...st } as ChainSettlement,
  };
  const api: StakesApi = { escrow: vi.fn(async () => state.escrow), settlement: vi.fn(async () => state.settlement) };
  return { state, api };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.connect.mockResolvedValue({ address: '0x1111111111111111111111111111111111111111', chainId: 11155111, eip1193: { request: vi.fn() }, provider: {}, signer: {} });
});

describe('StakePayout', () => {
  it('renders nothing for an unstaked, unsettled match', async () => {
    const { api } = fakeApi({ minStake: 0n });
    const { container } = render(<StakePayout matchId="mat_x" team="A" api={api} />);
    await waitFor(() => expect(api.escrow).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('shows the public stake flags, then the settlement link, and reveals only the player’s payout', async () => {
    const { api } = fakeApi({}, { logHash: LOG, winner: 'A', settledAt: 1, txHash: TX });
    m.revealPayout.mockResolvedValue({ staked: 100_000_000n, paid: 195_000_000n, net: 95_000_000n });
    render(<StakePayout matchId="mat_x" team="A" api={api} />);

    expect(await screen.findByTestId('zama-stake-ok-A')).toHaveTextContent('You🔒 stake counted');
    expect(screen.getByTestId('zama-stake-ok-B')).toHaveTextContent('Rival🔒 stake did not count');
    expect(screen.getByTestId('zama-settled-link')).toHaveAttribute('href', `https://sepolia.etherscan.io/tx/${TX}`);
    expect(screen.getByTestId('zama-stakes')).not.toHaveTextContent('195');

    await userEvent.click(screen.getByTestId('zama-payout-reveal'));
    expect(await screen.findByTestId('zama-payout')).toHaveTextContent('Payout: +95 cSKIRM');
    expect(screen.getByTestId('zama-payout')).toHaveTextContent('staked 100, paid back 195');
    expect(m.revealPayout).toHaveBeenCalledWith({}, {}, MATCH, expect.objectContaining({ minStake: 10_000_000n }), 0);
  });

  it('waits for the settlement and offers no reveal to a spectator', async () => {
    const { api } = fakeApi({});
    render(<StakePayout matchId="mat_x" team={null} api={api} />);
    expect(await screen.findByTestId('zama-settle-pending')).toBeInTheDocument();
    expect(screen.getByTestId('zama-stake-ok-A')).toHaveTextContent('Team A');
    expect(screen.queryByTestId('zama-payout-reveal')).not.toBeInTheDocument();
  });
});
