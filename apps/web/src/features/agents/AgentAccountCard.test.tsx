// The agent editor's "Agent account" tile: hidden while the server has agent accounts off, create
// (needs a linked NEAR account), the per-match cap, funding through the wallet as a plain transfer
// (FakeWallet stands in for NEAR Connect) and withdrawing to the linked account.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import type { AgentAccount } from '@/lib/api/types';
import { meFixture } from '@/test/fixtures';
import { FakeWallet } from '@/test/fakeWallet';
import { renderWithProviders } from '@/test/render';
import { AgentAccountCard } from './AgentAccountCard';

const ONE = '1000000000000000000000000';
const ACCOUNT: AgentAccount = {
  agentId: 'agt_wick',
  nearAccountId: 'agt-wick.agents.skirm.testnet',
  balanceYocto: '2000000000000000000000000',
  spendableYocto: '1980000000000000000000000',
  capYocto: '0',
  committedYocto: '0',
  custodial: true,
};

function setup(api: Partial<ApiClient>, o: { nearId?: string | null; wallet?: FakeWallet } = {}) {
  const nearId = o.nearId === undefined ? 'ada.testnet' : o.nearId;
  const wallet = o.wallet ?? new FakeWallet({ account: 'ada.testnet', connected: true });
  return renderWithProviders(<AgentAccountCard agentId="agt_wick" agentName="Wick" />, {
    authMode: 'privy',
    token: 'jwt_1',
    wallet,
    api: { me: async () => meFixture({ account: { id: 'acc_me', handle: 'ada', nearAccountId: nearId } }), ...api },
  });
}

describe('AgentAccountCard', () => {
  it('renders nothing while the feature is off', async () => {
    const { api } = setup({ agentAccount: async () => ({ enabled: false, account: null }) });
    await waitFor(() => expect(api.agentAccount).toHaveBeenCalled());
    expect(screen.queryByTestId('agent-account')).toBeNull();
  });

  it('creates the account, which needs a linked NEAR account', async () => {
    const { user, api } = setup({
      agentAccount: async () => ({ enabled: true, account: null }),
      createAgentAccount: async () => ({ account: ACCOUNT }),
    });
    expect(await screen.findByTestId('agent-account-note')).toHaveTextContent('skirm holds its key');
    await user.click(screen.getByTestId('agent-account-create'));
    expect(api.createAgentAccount).toHaveBeenCalledWith('agt_wick');
    expect(await screen.findByTestId('agent-account-id')).toHaveTextContent(ACCOUNT.nearAccountId);
    expect(screen.getByTestId('agent-account-balance')).toHaveTextContent('2 NEAR');
  });

  it('asks for a linked NEAR account before creating', async () => {
    setup({ agentAccount: async () => ({ enabled: true, account: null }) }, { nearId: null });
    expect(await screen.findByTestId('agent-account-note')).toHaveTextContent('Link a NEAR account first');
    expect(screen.getByTestId('agent-account-create')).toBeDisabled();
  });

  it('sets the cap, funds with a wallet transfer and withdraws to the linked account', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    const { user, api } = setup(
      {
        agentAccount: async () => ({ enabled: true, account: ACCOUNT }),
        setAgentAccountCap: async (_id, capYocto) => ({ account: { ...ACCOUNT, capYocto } }),
        withdrawAgentAccount: async () => ({
          txHash: 'mem:1',
          amountYocto: ACCOUNT.spendableYocto!,
          to: 'ada.testnet',
          account: { ...ACCOUNT, balanceYocto: '20000000000000000000000', spendableYocto: '0' },
        }),
      },
      { wallet },
    );
    expect(await screen.findByTestId('agent-account-cap')).toHaveTextContent('Cap 0 NEAR a match');
    await user.type(screen.getByTestId('agent-account-cap-input'), '1');
    await user.click(screen.getByTestId('agent-account-cap-save'));
    expect(api.setAgentAccountCap).toHaveBeenCalledWith('agt_wick', ONE);
    expect(await screen.findByText(/Cap 1 NEAR a match/)).toBeInTheDocument();

    await user.type(screen.getByTestId('agent-account-fund-input'), '0.5');
    await user.click(screen.getByTestId('agent-account-fund'));
    await waitFor(() => expect(wallet.sent).toHaveLength(1));
    expect(wallet.sent[0]).toEqual({
      receiverId: ACCOUNT.nearAccountId,
      actions: [{ type: 'Transfer', params: { deposit: '500000000000000000000000' } }],
    });

    await user.click(screen.getByTestId('agent-account-withdraw'));
    expect(api.withdrawAgentAccount).toHaveBeenCalledWith('agt_wick');
    await waitFor(() => expect(screen.getByTestId('agent-account-withdraw')).toBeDisabled());
    // The editor never receives or shows a key.
    expect(document.body.textContent).not.toMatch(/ed25519|secret/i);
  });
});
