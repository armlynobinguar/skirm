// The "Sealed auction 🔒" card with the chain, wallet and relayer faked: countdown and a bid count
// (never an amount), a bid that is encrypted before it is sent, the caller's own bid revealed on
// demand, then the winner and price, and the loser's confidential refund.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { CREDITS, m } = vi.hoisted(() => ({
  CREDITS: '0x00000000000000000000000000000000000000c5',
  m: { connect: vi.fn(), encrypt: vi.fn(), approve: vi.fn(), revealMyBid: vi.fn() },
}));

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: 'http://127.0.0.1:1', explorerUrl: 'https://sepolia.etherscan.io', contracts: { credits: CREDITS, match: null, fog: null, auction: null } },
}));
vi.mock('@/lib/zama/wallet', async (orig) => ({ ...(await orig<typeof import('@/lib/zama/wallet')>()), connectEvmWallet: m.connect, restoreEvmWallet: vi.fn(async () => null) }));
vi.mock('@/lib/zama/relayer', () => ({ getFhevmInstance: vi.fn(async () => ({})) }));
vi.mock('@/lib/zama/fhe', async (orig) => ({ ...(await orig<typeof import('@/lib/zama/fhe')>()), encryptU64: m.encrypt }));
vi.mock('@/features/zama/stakes/stakes', async (orig) => ({ ...(await orig<typeof import('@/features/zama/stakes/stakes')>()), approveOperator: m.approve }));
vi.mock('./auctions', async (orig) => ({ ...(await orig<typeof import('./auctions')>()), revealMyBid: m.revealMyBid }));

import type { SealedAuctionCard as Card } from '@/lib/api/zamaTypes';
import { SealedAuctionCard } from './SealedAuctionCard';
import type { AuctionApi, ChainAuction } from './auctions';

const ME = '0x1111111111111111111111111111111111111111';
const WINNER = '0x3333333333333333333333333333333333333333';
const CONTRACT = '0x00000000000000000000000000000000000000a7';
const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;

const card: Card = {
  id: 'auc_1',
  auctionId: '1',
  skill: { id: 'skl_1', version: 2, name: 'Gap Sealer' },
  seller: { id: 'acc_s', handle: 'seller' },
  endsAt: new Date().toISOString(),
  status: 'open',
  price: null,
  winnerAddress: null,
  buyer: null,
};

function fakeApi(a: Partial<ChainAuction>, bid = H(0)) {
  const state = {
    auction: {
      seller: '0x2222222222222222222222222222222222222222',
      skillRef: H(9),
      endTime: Math.floor(Date.now() / 1000) + 3_600,
      status: 'open',
      feeBps: 250,
      reserveEncrypted: true,
      reserve: 0n,
      bidders: 3,
      winner: '0x0000000000000000000000000000000000000000',
      price: 0n,
      ...a,
    } as ChainAuction,
    bid,
    refunded: false,
  };
  const api: AuctionApi = {
    get: vi.fn(async () => state.auction),
    bidOf: vi.fn(async () => state.bid),
    refunded: vi.fn(async () => state.refunded),
    revealHandles: vi.fn(async () => [H(1), H(2)] as [`0x${string}`, `0x${string}`]),
    create: vi.fn(async () => 1n),
    bid: vi.fn(async () => {
      state.bid = H(5);
      state.auction = { ...state.auction, bidders: state.auction.bidders + 1 };
      return H(0xb1d);
    }),
    close: vi.fn(async () => '0xc'),
    finalize: vi.fn(async () => '0xf'),
    refund: vi.fn(async () => {
      state.refunded = true;
      return H(0xfe);
    }),
  };
  return { state, api };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.connect.mockResolvedValue({ address: ME, chainId: 11155111, eip1193: { request: vi.fn() }, provider: {}, signer: {} });
  m.encrypt.mockResolvedValue({ handle: H(0xe), inputProof: '0x9f' });
  m.approve.mockResolvedValue(true);
});

describe('SealedAuctionCard', () => {
  it('shows the countdown and how many sealed bids, encrypts a bid and reveals only the caller’s own', async () => {
    const { api } = fakeApi({});
    render(<SealedAuctionCard card={card} contract={CONTRACT} api={api} address={ME} />);
    expect(await screen.findByTestId('zama-auction-bids')).toHaveTextContent('3 sealed bids');
    expect(screen.getByTestId('zama-auction-countdown')).toHaveTextContent(/⏱ (59m|1h 00m)/);
    expect(screen.getByTestId('zama-auction-card')).toHaveTextContent('reserve sealed 🔒');

    await userEvent.type(screen.getByTestId('zama-auction-amount'), '12.5');
    await userEvent.click(screen.getByTestId('zama-auction-bid'));
    await waitFor(() => expect(api.bid).toHaveBeenCalled());
    expect(m.approve).toHaveBeenCalledWith({}, CREDITS, ME, CONTRACT);
    expect(m.encrypt).toHaveBeenCalledWith({}, CONTRACT, ME, 12_500_000n);
    expect(api.bid).toHaveBeenCalledWith(1n, { handle: H(0xe), inputProof: '0x9f' });
    expect(await screen.findByTestId('zama-auction-bids')).toHaveTextContent('4 sealed bids');

    m.revealMyBid.mockResolvedValue(12_500_000n);
    await userEvent.click(await screen.findByTestId('zama-auction-reveal'));
    expect(await screen.findByTestId('zama-auction-mine')).toHaveTextContent('Your bid: 12.5 cSKIRM');
  });

  it('after a sale shows the winner and price, and refunds a losing bid without revealing it', async () => {
    const { api } = fakeApi({ status: 'won', winner: WINNER, price: 40_000_000n, endTime: 1 }, H(5));
    render(<SealedAuctionCard card={{ ...card, status: 'granted', buyer: { id: 'acc_w', handle: 'winner' } }} contract={CONTRACT} api={api} address={ME} />);
    expect(await screen.findByTestId('zama-auction-result')).toHaveTextContent('Won by winner at 40 cSKIRM');
    expect(screen.queryByTestId('zama-auction-amount')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByTestId('zama-auction-refund'));
    expect(await screen.findByTestId('zama-auction-refunded')).toHaveTextContent('Your bid was refunded 🔒');
    expect(api.refund).toHaveBeenCalledWith(1n, ME);
  });

  it('tells a failed auction apart and offers to open an ended one', async () => {
    const failed = fakeApi({ status: 'failed', bidders: 0, endTime: 1 });
    const { unmount } = render(<SealedAuctionCard card={card} contract={CONTRACT} api={failed.api} address={null} />);
    expect(await screen.findByTestId('zama-auction-result')).toHaveTextContent('No sale: no bids');
    unmount();

    const ended = fakeApi({ endTime: 1 });
    render(<SealedAuctionCard card={card} contract={CONTRACT} api={ended.api} address={null} />);
    expect(await screen.findByTestId('zama-auction-close')).toBeInTheDocument();
    expect(screen.queryByTestId('zama-auction-countdown')).not.toBeInTheDocument();
  });
});
