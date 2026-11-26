// The live "Predict 🔒" panel and the debrief "Claim 🔒" with the chain, wallet and relayer faked:
// a count and "pool hidden" while open (never an amount), a side + amount encrypted before they are
// sent, the totals and odds once revealed, and a claim that decrypts only the caller's own payout.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { CREDITS, m } = vi.hoisted(() => ({
  CREDITS: '0x00000000000000000000000000000000000000c5',
  m: { connect: vi.fn(), encrypt: vi.fn(), approve: vi.fn(), revealMine: vi.fn() },
}));

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: 'http://127.0.0.1:1', explorerUrl: 'https://sepolia.etherscan.io', contracts: { credits: CREDITS, match: null, fog: null, auction: null, predictions: null } },
}));
vi.mock('@/lib/zama/wallet', async (orig) => ({ ...(await orig<typeof import('@/lib/zama/wallet')>()), connectEvmWallet: m.connect, restoreEvmWallet: vi.fn(async () => null) }));
vi.mock('@/lib/zama/relayer', () => ({ getFhevmInstance: vi.fn(async () => ({})) }));
vi.mock('@/features/zama/stakes/stakes', async (orig) => ({ ...(await orig<typeof import('@/features/zama/stakes/stakes')>()), approveOperator: m.approve }));
vi.mock('./predictions', async (orig) => ({ ...(await orig<typeof import('./predictions')>()), encryptPrediction: m.encrypt, revealMine: m.revealMine }));

import { PredictionClaim } from './PredictionClaim';
import { PredictPanel } from './PredictPanel';
import type { ChainMarket, MyPrediction, PredictionsApi } from './predictions';

const ME = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0x00000000000000000000000000000000000000a7';
const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;
const UNIT = 1_000_000n;

function fakeApi(market: Partial<ChainMarket>, mine: Partial<MyPrediction> = {}) {
  const state = {
    market: { status: 'open', closesAt: Math.floor(Date.now() / 1000) + 600, winner: 255, feeBps: 500, predictors: 3, totalA: 0n, totalB: 0n, ...market } as ChainMarket,
    mine: { side: H(0), stake: H(0), payout: H(0), claimed: false, ...mine } as MyPrediction,
  };
  const api: PredictionsApi = {
    get: vi.fn(async () => state.market),
    mine: vi.fn(async () => state.mine),
    predict: vi.fn(async () => {
      state.mine = { ...state.mine, side: H(1), stake: H(2) };
      state.market = { ...state.market, predictors: state.market.predictors + 1 };
      return H(0xbe7);
    }),
    claim: vi.fn(async () => {
      state.mine = { ...state.mine, payout: H(3), claimed: true };
      return H(0xc1a);
    }),
  };
  return { state, api };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.connect.mockResolvedValue({ address: ME, chainId: 11155111, eip1193: { request: vi.fn() }, provider: {}, signer: {} });
  m.encrypt.mockResolvedValue({ side: H(0xa), amount: H(0xb), inputProof: '0x9f' });
  m.approve.mockResolvedValue(true);
});

describe('PredictPanel', () => {
  it('shows only a count while open, encrypts the side and amount, and reveals the caller’s own prediction', async () => {
    const { api } = fakeApi({});
    render(<PredictPanel matchId="mat_1" tick={4} api={api} contract={CONTRACT} address={ME} names={{ A: 'ana', B: 'ben' }} />);
    expect(await screen.findByTestId('zama-predict-count')).toHaveTextContent('3 sealed predictions');
    expect(screen.getByTestId('zama-predict-hidden')).toHaveTextContent('Pool hidden until tick 30');
    expect(screen.queryByTestId('zama-predict-pool')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('zama-predict-side-B'));
    await userEvent.type(screen.getByTestId('zama-predict-amount'), '7.5');
    await userEvent.click(screen.getByTestId('zama-predict-submit'));
    await waitFor(() => expect(api.predict).toHaveBeenCalled());
    expect(m.approve).toHaveBeenCalledWith({}, CREDITS, ME, CONTRACT);
    expect(m.encrypt).toHaveBeenCalledWith({}, CONTRACT, ME, 'B', 7_500_000n);
    expect(api.predict).toHaveBeenCalledWith('mat_1', { side: H(0xa), amount: H(0xb), inputProof: '0x9f' });
    expect(await screen.findByTestId('zama-predict-count')).toHaveTextContent('4 sealed predictions');

    m.revealMine.mockResolvedValue({ team: 'B', stake: 7_500_000n, payout: null });
    await userEvent.click(await screen.findByTestId('zama-predict-reveal'));
    expect(await screen.findByTestId('zama-predict-mine')).toHaveTextContent('You backed ben with 7.5 cSKIRM');
  });

  it('stops taking predictions at tick 30, then shows the revealed totals and odds', async () => {
    const closing = fakeApi({});
    const { unmount } = render(<PredictPanel matchId="mat_1" tick={30} api={closing.api} contract={CONTRACT} address={null} />);
    expect(await screen.findByTestId('zama-predict-panel')).toHaveTextContent('Betting closed at tick 30');
    expect(screen.queryByTestId('zama-predict-amount')).not.toBeInTheDocument();
    unmount();

    const revealed = fakeApi({ status: 'revealed', totalA: 40n * UNIT, totalB: 20n * UNIT });
    render(<PredictPanel matchId="mat_1" tick={44} api={revealed.api} contract={CONTRACT} address={null} />);
    const pool = await screen.findByTestId('zama-predict-pool');
    expect(pool).toHaveTextContent('Crew A40 cSKIRM · ×1.50');
    expect(pool).toHaveTextContent('Crew B20 cSKIRM · ×3.00');
  });

  it('renders nothing on a match without a market', async () => {
    const { api } = fakeApi({ status: 'none' });
    const { container } = render(<PredictPanel matchId="mat_1" tick={4} api={api} contract={CONTRACT} address={null} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PredictionClaim', () => {
  it('claims and decrypts the caller’s payout once resolved', async () => {
    const { api } = fakeApi({ status: 'resolved', winner: 1, totalA: 40n * UNIT, totalB: 20n * UNIT }, { side: H(1), stake: H(2) });
    render(<PredictionClaim matchId="mat_1" api={api} contract={CONTRACT} address={ME} names={{ A: 'ana', B: 'ben' }} />);
    m.revealMine.mockResolvedValue({ team: 'B', stake: 10n * UNIT, payout: 29n * UNIT });
    await userEvent.click(await screen.findByTestId('zama-prediction-claim-btn'));
    await waitFor(() => expect(api.claim).toHaveBeenCalledWith('mat_1'));
    expect(await screen.findByTestId('zama-prediction-payout')).toHaveTextContent('You backed ben with 10 cSKIRM · paid 29 cSKIRM');
  });

  it('renders nothing for a wallet that did not predict', async () => {
    const { api } = fakeApi({ status: 'resolved', winner: 0 });
    const { container } = render(<PredictionClaim matchId="mat_1" api={api} contract={CONTRACT} address={ME} />);
    await waitFor(() => expect(api.mine).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
