import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BackingConfig, BackingPosition, BackingRound } from '@/lib/api/backingTypes';
import { meFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { BackingScreen } from './BackingScreen';
import { BackWriterPanel } from './BackWriterPanel';
import { capX, isWallet, money, sharePct, termsLine, walletTx } from './lib';

const N = 10n ** 24n;

const config = (o: Partial<BackingConfig> = {}): BackingConfig => ({
  mode: 'credits',
  contractId: null,
  creditsPerNear: 1000,
  maxShareBps: 5000,
  minCapMultipleBps: 10000,
  maxCapMultipleBps: 100000,
  minStakeYocto: (N / 10n).toString(),
  maxRaiseYocto: (N * 1_000_000n).toString(),
  openRoundStorageYocto: (N / 100n).toString(),
  ...o,
});

const round = (o: Partial<BackingRound> = {}): BackingRound => ({
  id: 'brd_1',
  writerId: 'acc_wanda',
  writerHandle: 'wanda',
  writerNearAccountId: null,
  skillId: null,
  skillName: null,
  shareBps: 2000,
  capMultipleBps: 20000,
  maxRaiseYocto: (3n * N).toString(),
  raisedYocto: (N).toString(),
  backers: 1,
  status: 'open',
  mode: 'credits',
  chainRoundId: null,
  royaltiesInYocto: '0',
  backersEarnedYocto: '0',
  capYocto: (2n * N).toString(),
  createdAt: '2026-11-04T00:00:00.000Z',
  closedAt: null,
  ...o,
});

const position = (o: Partial<BackingPosition> = {}): BackingPosition => ({
  backingId: 'bkg_1',
  round: round({ status: 'closed', raisedYocto: (3n * N).toString(), backersEarnedYocto: (N).toString(), capYocto: (6n * N).toString() }),
  stakeYocto: (2n * N).toString(),
  earnedYocto: ((2n * N) / 3n).toString(),
  claimedYocto: '0',
  claimableYocto: ((2n * N) / 3n).toString(),
  capYocto: (4n * N).toString(),
  refunded: false,
  ...o,
});

describe('backing helpers', () => {
  it('labels terms and amounts', () => {
    expect(sharePct(2000)).toBe('20%');
    expect(sharePct(1250)).toBe('12.5%');
    expect(capX(20000)).toBe('2×');
    expect(capX(15000)).toBe('1.5×');
    expect(termsLine({ shareBps: 2000, capMultipleBps: 20000 })).toBe('20% of royalties until backers get 2×');
    expect(money(2n * N, 'near')).toBe('2 NEAR');
    expect(money((3n * N) / 2n, 'credits', 1000)).toBe('1,500 credits');
  });

  it('turns a wallet answer into the contract call', () => {
    const w = { wallet: { contractId: 'backing.playskirm.testnet', methodName: 'back', args: { round_id: '1' }, depositYocto: '5', gas: '50' } };
    expect(isWallet(w)).toBe(true);
    expect(isWallet({ round: round() })).toBe(false);
    expect(walletTx(w.wallet)).toEqual({
      receiverId: 'backing.playskirm.testnet',
      actions: [{ type: 'FunctionCall', params: { methodName: 'back', args: { round_id: '1' }, gas: '50', deposit: '5' } }],
    });
  });
});

describe('BackingScreen', () => {
  it('backs an open round with credits and shows the portfolio with paid so far and cap progress', async () => {
    const { api, user } = renderWithProviders(<BackingScreen />, {
      handle: 'bea',
      api: {
        me: async () => meFixture(),
        backingConfig: async () => config(),
        backingRounds: async () => ({ rounds: [round()] }),
        myBacking: async () => ({ mode: 'credits', positions: [position()], rounds: [] }),
        backRound: async () => ({ position: position(), stakedYocto: N.toString() }),
        claimBacking: async () => ({ position: position({ claimableYocto: '0' }), claimedCredits: 666 }),
      },
    });
    const open = await screen.findByTestId('backing-open-rounds');
    expect(within(open).getByTestId('backing-terms')).toHaveTextContent('20% of royalties until backers get 2×');
    expect(within(open).getByTestId('backing-raised')).toHaveTextContent('Raised 1,000 credits of 3,000 credits from 1 backer');
    await user.type(within(open).getByTestId('backing-amount'), '1');
    expect(within(open).getByTestId('backing-cost')).toHaveTextContent('1,000 credits from your paid balance');
    await user.click(within(open).getByTestId('backing-back'));
    expect(api.backRound).toHaveBeenCalledWith('brd_1', N.toString());

    const pos = await screen.findByTestId('backing-position');
    expect(within(pos).getByTestId('backing-paid')).toHaveTextContent('0 credits');
    expect(within(pos).getByTestId('backing-cap-progress')).toHaveAttribute('aria-valuenow', '17');
    await user.click(within(pos).getByTestId('backing-claim'));
    expect(api.claimBacking).toHaveBeenCalledWith('brd_1');
  });

  it('opens a round with the writer terms', async () => {
    const { api, user } = renderWithProviders(<BackingScreen />, {
      handle: 'wanda',
      api: {
        me: async () => meFixture(),
        backingConfig: async () => config(),
        backingRounds: async () => ({ rounds: [] }),
        myBacking: async () => ({ mode: 'credits', positions: [], rounds: [] }),
        openBackingRound: async () => ({ round: round() }),
      },
    });
    await user.type(await screen.findByTestId('backing-raise'), '3');
    await user.click(screen.getByTestId('backing-open'));
    expect(api.openBackingRound).toHaveBeenCalledWith({ shareBps: 2000, capMultipleBps: 20000, maxRaiseYocto: (3n * N).toString() });
  });
});

describe('BackWriterPanel', () => {
  it("shows the writer's open rounds on a skill, and nothing without one", async () => {
    renderWithProviders(<BackWriterPanel skillId="skl_1" isCreator={false} />, {
      handle: 'bea',
      api: { backingConfig: async () => config(), backingRounds: async () => ({ rounds: [round({ skillId: 'skl_1', skillName: 'Dam First' })] }) },
    });
    const panel = await screen.findByTestId('s10-backing');
    expect(panel).toHaveTextContent('Dam First');
    expect(within(panel).getByTestId('backing-back')).toBeInTheDocument();
  });
});
