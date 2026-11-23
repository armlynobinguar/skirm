import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/render';
import { SealedVerify, VerifyRoundLink } from './SealedVerify';
import { sealedFixture } from './sealedFixture';

const MATCH = '0x00000000000000000000000000000000000000aa';
const m = vi.hoisted(() => ({ readSealedChain: vi.fn(), cfg: { enabled: true, chainId: 11155111, rpcUrl: 'http://127.0.0.1:1', explorerUrl: 'https://sepolia.etherscan.io', contracts: { credits: null, match: null as string | null } } }));
vi.mock('@/lib/zama/config', () => ({ zamaConfig: m.cfg }));
vi.mock('./sealedChain', async (orig) => ({ ...(await orig<typeof import('./sealedChain')>()), readSealedChain: m.readSealedChain, ethersSealedSource: () => ({}) }));

beforeEach(() => {
  m.cfg.contracts.match = MATCH;
  m.readSealedChain.mockReset();
});

describe('SealedVerify', () => {
  it('shows the fixture, clearly labelled, with every check passing', () => {
    renderWithProviders(<SealedVerify matchId="fixture-sealed-round" />, { api: createFakeApi() });
    expect(screen.getByTestId('sealed-fixture-label')).toHaveTextContent('Fixture, not a live match');
    expect(screen.getByTestId('sealed-status')).toHaveTextContent('Fair round, verified on Sepolia');
    for (const id of ['commitments', 'seed', 'drops', 'loadouts', 'anchor', 'replay']) expect(screen.getByTestId(`sealed-check-${id}`)).toHaveAttribute('data-state', 'pass');
    expect(screen.getByTestId('sealed-check-privacy')).toHaveAttribute('data-state', 'private');
    expect(screen.getByTestId('sealed-check-privacy')).toHaveTextContent('🔒');
  });

  it('a tampered fixture fails the matching check', () => {
    renderWithProviders(<SealedVerify matchId="fixture-sealed-round~wrong-seed" />, { api: createFakeApi() });
    expect(screen.getByTestId('sealed-status')).toHaveTextContent('Mismatch');
    expect(screen.getByTestId('sealed-check-seed')).toHaveAttribute('data-state', 'fail');
    expect(screen.getByTestId('sealed-check-seed')).toHaveTextContent('❌');
  });

  it('reads SkirmMatch for a sealed match and links the transactions', async () => {
    const f = sealedFixture();
    m.readSealedChain.mockResolvedValue({ ...f.chain, contract: MATCH });
    const api = createFakeApi({ v2MatchLog: async () => ({ ...f.log, matchId: 'mat_s' }) });
    renderWithProviders(<SealedVerify matchId="mat_s" />, { api });
    expect(await screen.findByTestId('sealed-status')).toHaveTextContent('Fair round');
    expect(m.readSealedChain).toHaveBeenCalledWith(expect.anything(), 'mat_s', expect.anything());
    expect(screen.getByTestId('sealed-contract')).toHaveAttribute('href', `https://sepolia.etherscan.io/address/${MATCH}`);
    expect(screen.getByTestId('sealed-check-seed').querySelector('a')).toHaveAttribute('href', expect.stringMatching(/^https:\/\/sepolia\.etherscan\.io\/tx\/0x/));
    fireEvent.click(screen.getByTestId('sealed-run'));
    expect(await screen.findByText('Verify again')).toBeInTheDocument();
  });

  it('says so when SkirmMatch has no record, and when it is not deployed', async () => {
    const f = sealedFixture();
    m.readSealedChain.mockResolvedValue({ ...f.chain, status: 'none' });
    const api = createFakeApi({ v2MatchLog: async () => f.log });
    const { unmount } = renderWithProviders(<SealedVerify matchId="mat_s" />, { api });
    expect(await screen.findByTestId('sealed-not-found')).toHaveTextContent(MATCH);
    unmount();
    m.cfg.contracts.match = null;
    renderWithProviders(<SealedVerify matchId="mat_s2" />, { api });
    expect(await screen.findByTestId('sealed-undeployed')).toHaveTextContent('not deployed');
  });

  it('renders nothing for a match that was not a sealed round', async () => {
    const f = sealedFixture();
    const { seed: _s, sealedDrops: _d, ...header } = f.log.log.header;
    const api = createFakeApi({ v2MatchLog: async () => ({ ...f.log, log: { ...f.log.log, header } }) });
    renderWithProviders(
      <>
        <SealedVerify matchId="mat_plain" />
        <VerifyRoundLink matchId="mat_plain" />
      </>,
      { api },
    );
    await vi.waitFor(() => expect(api.v2MatchLog).toHaveBeenCalled());
    expect(screen.queryByTestId('sealed-verify')).toBeNull();
    expect(screen.queryByTestId('verify-round-link')).toBeNull();
    expect(m.readSealedChain).not.toHaveBeenCalled();
  });

  it('the debrief offers "Verify this round" for a sealed round', async () => {
    const api = createFakeApi({ v2MatchLog: async () => sealedFixture().log });
    renderWithProviders(<VerifyRoundLink matchId="mat_s" />, { api });
    expect(await screen.findByTestId('verify-round')).toHaveTextContent('Verify this round');
  });
});
