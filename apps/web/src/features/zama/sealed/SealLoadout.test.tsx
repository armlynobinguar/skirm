// The sealed-loadout panel inside the real lock-in screen, with the wallet, relayer and chain mocked.
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtime } from '@/test/fakeRealtime';
import { agentFixture, meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';

const { MATCH, USER, cfg, m } = vi.hoisted(() => ({
  MATCH: '0x00000000000000000000000000000000000000aa',
  USER: '0x1111111111111111111111111111111111111111',
  cfg: { enabled: true },
  m: { connect: vi.fn(), getFhevmInstance: vi.fn(async () => ({})), sealLoadout: vi.fn() },
}));

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: {
    get enabled() {
      return cfg.enabled;
    },
    chainId: 11155111,
    rpcUrl: '',
    explorerUrl: '',
    contracts: { credits: null, match: MATCH },
  },
}));
vi.mock('@/lib/zama/wallet', async (orig) => ({ ...(await orig<typeof import('@/lib/zama/wallet')>()), connectEvmWallet: m.connect }));
vi.mock('@/lib/zama/relayer', () => ({ getFhevmInstance: m.getFhevmInstance }));
vi.mock('./sealed', async (orig) => ({ ...(await orig<typeof import('./sealed')>()), sealLoadout: m.sealLoadout }));

import { V2MatchScreen } from '@/features/v2/V2MatchScreen';
import { v2StoreFor } from '@/features/v2/v2Store';
import type { ChainMatch, SealOptions } from './sealed';

// Ids sort b < c: Moss is roster index 1, Wick index 2.
const WICK = agentFixture({ id: 'agt_c_wick', name: 'Wick', role: 'Builder', tier: 'standard', skills: [{ id: 'skl_a', version: 1, name: 'Dam First' }] });
const MOSS = agentFixture({ id: 'agt_b_moss', name: 'Moss', role: 'Runner', tier: 'open', skills: [] });

function setup(practice = false) {
  const rt = new FakeRealtime();
  v2StoreFor(rt).queued = [
    { agentId: WICK.id, name: 'Wick', tier: 'standard' },
    { agentId: MOSS.id, name: 'Moss', tier: 'open' },
  ];
  renderWithProviders(<V2MatchScreen matchId="mat_seal" />, {
    realtime: rt,
    handle: 'ada',
    path: '/matches/mat_seal',
    search: '',
    api: { me: async () => meFixture({ agents: [WICK, MOSS] }), skills: async () => [] },
  });
  act(() => {
    rt.emit({ type: 'v2_found', matchId: 'mat_seal', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, ...(practice ? { practice: true } : {}) });
    rt.emit({ type: 'v2_lockin', matchId: 'mat_seal', lockMs: 30_000, rival: { agents: 2 } });
  });
  return rt;
}

const chain = (locked: [boolean, boolean], status: ChainMatch['status'] = 'open'): ChainMatch => ({
  status,
  players: [USER, locked[1] ? '0x2222222222222222222222222222222222222222' : `0x${'0'.repeat(40)}`],
  locked,
  lockDeadline: 0,
  minStake: 10_000_000n,
});

beforeEach(() => {
  vi.clearAllMocks();
  cfg.enabled = true;
  m.connect.mockResolvedValue({ address: USER, chainId: 11155111, eip1193: { request: vi.fn() }, provider: {}, signer: {} });
});

describe('sealed lock-in', () => {
  it('is not offered with the flag off, nor in practice', async () => {
    cfg.enabled = false;
    setup();
    expect(await screen.findByTestId('v2-lock')).toBeInTheDocument();
    expect(screen.queryByTestId('zama-seal')).not.toBeInTheDocument();
  });

  it('is not offered against the practice bot', async () => {
    setup(true);
    expect(await screen.findByTestId('v2-lock')).toBeInTheDocument();
    expect(screen.queryByTestId('zama-seal')).not.toBeInTheDocument();
  });

  it('seals the crew on screen, shows both sides sealed with the rival hidden, then locks in sealed', async () => {
    let finish!: () => void;
    m.sealLoadout.mockImplementation(async (o: SealOptions) => {
      o.onStep?.('waiting', chain([true, false]));
      await new Promise<void>((r) => (finish = r));
      o.onStep?.('revealed', chain([true, true], 'revealed'));
      return chain([true, true], 'revealed');
    });
    const rt = setup();
    await userEvent.click(await screen.findByTestId('zama-seal-start'));

    expect(rt.sentOf('v2_seal')).toEqual([{ type: 'v2_seal', matchId: 'mat_seal', address: USER }]);
    await waitFor(() => expect(m.sealLoadout).toHaveBeenCalled());
    const opts = m.sealLoadout.mock.calls[0]![0] as SealOptions;
    // Wick (index 2, its one skill, Standard), then Moss (index 1, no skills, Open).
    expect(opts).toMatchObject({ matchId: 'mat_seal', team: 'A', user: USER, contract: MATCH, values: [2, 1, 0, 1, 0, 0, 1, 2, 0], stake: 10_000_000n });

    expect(await screen.findByTestId('zama-seal-you')).toHaveTextContent('🔒 sealed');
    expect(screen.getByTestId('zama-seal-rival')).toHaveTextContent('not sealing yet');
    act(() => rt.emit({ type: 'v2_sealing', matchId: 'mat_seal', team: 'B' }));
    expect(screen.getByTestId('zama-seal-rival')).toHaveTextContent('sealing… · hidden');
    // The plain lock is gone while sealing, and the crew is frozen.
    expect(screen.queryByTestId('v2-lock')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-lockin')).toHaveTextContent('Sealing on Sepolia');
    expect(rt.sentOf('v2_lock_in')).toEqual([]);

    await act(async () => finish());
    await waitFor(() => expect(rt.sentOf('v2_lock_in')).toEqual([{ type: 'v2_lock_in', matchId: 'mat_seal', tiers: ['standard', 'open'], sealed: true }]));
    expect(screen.getByTestId('zama-seal-rival')).toHaveTextContent('🔒 sealed · hidden');
  });

  it('offers an encrypted stake defaulting to the minimum, warns below it and refuses a non-amount', async () => {
    m.sealLoadout.mockResolvedValue(chain([true, true], 'revealed'));
    setup();
    const input = await screen.findByTestId('zama-stake-input');
    expect(input).toHaveValue('10');
    expect(screen.getByText('🔒 encrypted')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '2.5');
    expect(screen.getByTestId('zama-stake-low')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '25');
    expect(screen.queryByTestId('zama-stake-low')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('zama-seal-start'));
    await waitFor(() => expect(m.sealLoadout).toHaveBeenCalled());
    expect((m.sealLoadout.mock.calls[0]![0] as SealOptions).stake).toBe(25_000_000n);
  });

  it('refuses to seal with a stake that is not an amount', async () => {
    setup();
    const input = await screen.findByTestId('zama-stake-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'lots');
    expect(screen.getByTestId('zama-stake-invalid')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('zama-seal-start'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a stake');
    expect(m.sealLoadout).not.toHaveBeenCalled();
  });

  it('gives the crew back when sealing fails before anything is on chain', async () => {
    m.connect.mockRejectedValue(Object.assign(new Error('nope'), { code: 4001 }));
    setup();
    await userEvent.click(await screen.findByTestId('zama-seal-start'));
    expect(await screen.findByRole('alert')).toHaveTextContent('rejected in the wallet');
    expect(screen.getByTestId('v2-lock')).toBeInTheDocument();
    expect(screen.getByTestId('zama-seal-retry')).toBeInTheDocument();
  });
});
