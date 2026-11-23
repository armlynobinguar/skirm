// The on-chain randomness card with the chain faked: nothing for a match without FHE randomness, the
// seed chip with its reveal tx, "next drop: encrypted" turning into the tile once it is revealed,
// and nothing at all with NEXT_PUBLIC_ZAMA_ENABLED off.
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MATCH, cfg } = vi.hoisted(() => ({ MATCH: '0x00000000000000000000000000000000000000aa', cfg: { enabled: true } }));

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: {
    get enabled() {
      return cfg.enabled;
    },
    chainId: 11155111,
    rpcUrl: 'http://127.0.0.1:1',
    explorerUrl: 'https://sepolia.etherscan.io',
    contracts: { credits: null, match: MATCH },
  },
}));
vi.mock('@/lib/zama/wallet', async (orig) => ({ ...(await orig<typeof import('@/lib/zama/wallet')>()), restoreEvmWallet: vi.fn(async () => null) }));
vi.mock('@/lib/zama/relayer', () => ({ getFhevmInstance: vi.fn(async () => ({})) }));

import { ChainRandomness, LIVE_POLL_MS } from './ChainRandomness';
import { dropTileOf, type ChainRandomness as Rnd, type RandomnessApi } from './randomness';
import { ZamaRandomnessSlot } from './ZamaRandomnessSlot';

const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;
const SEED_TX = H(0xa1);
const DROP_TX = H(0xb2);

function fakeApi(init: Partial<Rnd>) {
  const state: Rnd = { seedHandle: H(1), dropHandles: [H(2), H(3), H(4)], seed: '18446744073709551615', drops: [null, null, null], startedAt: 1, dropsRequested: 0, dropsRevealed: 0, ...init };
  const api: RandomnessApi = {
    read: vi.fn(async () => ({ ...state, drops: [...state.drops] })),
    txs: vi.fn(async () => ({ seed: SEED_TX, drops: [state.dropsRevealed ? DROP_TX : null, null, null] })),
    revealDrop: vi.fn(),
    finalizeDrop: vi.fn(),
  };
  return { state, api };
}

describe('ChainRandomness', () => {
  beforeEach(() => {
    cfg.enabled = true;
  });

  it('renders nothing in the debrief of a match SkirmMatch drew no randomness for', async () => {
    const { api } = fakeApi({ seedHandle: `0x${'0'.repeat(64)}`, seed: null, startedAt: 0 });
    const { container } = render(<ChainRandomness matchId="mat_x" mapId="copper-hollow" team="A" mode="debrief" api={api} />);
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('shows the seed chip with its reveal tx and each drop as it is revealed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { state, api } = fakeApi({});
    render(<ChainRandomness matchId="mat_x" mapId="copper-hollow" team="A" mode="live" seed="18446744073709551615" api={api} />);
    expect(screen.getByTestId('zama-seed-chip').textContent).toContain('Seed drawn on-chain (FHE)');
    await waitFor(() => expect(screen.getByTestId('zama-seed-tx')).toHaveAttribute('href', `https://sepolia.etherscan.io/tx/${SEED_TX}`));
    expect(screen.getByTestId('zama-drop-0').textContent).toContain('next drop: encrypted');
    // copper-hollow has one drop: the live card shows only the slot the map uses.
    expect(screen.queryByTestId('zama-drop-1')).toBeNull();

    state.drops[0] = 513;
    state.dropsRequested = 1;
    state.dropsRevealed = 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    });
    const tile = dropTileOf('copper-hollow', 513)!;
    await waitFor(() => expect(screen.getByTestId('zama-drop-0').textContent).toContain(`tile ${tile.join(',')}`));
    await waitFor(() => expect(screen.getByTestId('zama-drop-0').querySelector('a')).toHaveAttribute('href', `https://sepolia.etherscan.io/tx/${DROP_TX}`));
    vi.useRealTimers();
  });

  it('lists every draw in the debrief and offers to publish the ones still sealed', async () => {
    const { api } = fakeApi({ drops: [7, null, null], dropsRequested: 1, dropsRevealed: 1 });
    render(<ChainRandomness matchId="mat_x" mapId="copper-hollow" team="A" mode="debrief" api={api} />);
    expect(await screen.findByTestId('zama-drop-0')).toHaveTextContent('Drop 1');
    expect(screen.getByTestId('zama-drop-1')).toHaveTextContent('next draw: encrypted');
    expect(screen.getByTestId('zama-drop-2')).toHaveTextContent('draw: encrypted');
    expect(screen.getByTestId('zama-publish-draws')).toBeEnabled();
  });

  it('is not mounted with NEXT_PUBLIC_ZAMA_ENABLED off', () => {
    cfg.enabled = false;
    const { container } = render(<ZamaRandomnessSlot matchId="mat_x" mapId="copper-hollow" team="A" mode="debrief" />);
    expect(container.innerHTML).toBe('');
  });
});
