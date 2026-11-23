import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { TOKEN, USER, HANDLE } = vi.hoisted(() => ({
  TOKEN: '0x00000000000000000000000000000000000000aA',
  USER: '0x1111111111111111111111111111111111111111',
  HANDLE: `0x${'01'.repeat(32)}`,
}));

const m = vi.hoisted(() => ({
  restore: vi.fn(),
  connect: vi.fn(),
  readBalanceHandle: vi.fn(),
  readFaucet: vi.fn(),
  claimFaucet: vi.fn(),
  userDecryptUint: vi.fn(),
  getFhevmInstance: vi.fn(async () => ({})),
}));

vi.mock('@/lib/zama/config', () => ({
  zamaConfig: { enabled: true, chainId: 11155111, rpcUrl: '', explorerUrl: '', contracts: { credits: TOKEN } },
}));
vi.mock('@/lib/zama/wallet', () => ({ restoreEvmWallet: m.restore, connectEvmWallet: m.connect }));
vi.mock('@/lib/zama/relayer', () => ({ getFhevmInstance: m.getFhevmInstance }));
vi.mock('@/lib/zama/fhe', async (orig) => ({ ...(await orig<typeof import('@/lib/zama/fhe')>()), userDecryptUint: m.userDecryptUint }));
vi.mock('./credits', async (orig) => ({
  ...(await orig<typeof import('./credits')>()),
  creditsAddress: () => TOKEN,
  readBalanceHandle: m.readBalanceHandle,
  readFaucet: m.readFaucet,
  claimFaucet: m.claimFaucet,
}));

import { CSkirmBalance, errorMessage } from './CSkirmBalance';

const conn = (chainId = 11155111) => ({ address: USER, chainId, eip1193: { request: vi.fn() }, provider: {}, signer: {} });

beforeEach(() => {
  vi.clearAllMocks();
  m.restore.mockResolvedValue(null);
  m.readBalanceHandle.mockResolvedValue(HANDLE);
  m.readFaucet.mockResolvedValue({ amount: 1_000_000_000n, availableAt: 0 });
});

describe('CSkirmBalance', () => {
  it('asks for an EVM wallet, then shows a sealed balance', async () => {
    m.connect.mockResolvedValue(conn());
    render(<CSkirmBalance />);
    await userEvent.click(await screen.findByTestId('zama-connect'));
    expect(await screen.findByTestId('zama-cskirm-balance')).toHaveTextContent('••••••');
    expect(m.readBalanceHandle).toHaveBeenCalledWith({}, USER);
  });

  it('reveals the balance with a user decrypt and hides it again', async () => {
    m.restore.mockResolvedValue(conn());
    m.userDecryptUint.mockResolvedValue(1_250_000_000n);
    render(<CSkirmBalance />);
    await userEvent.click(await screen.findByTestId('zama-reveal'));
    expect(await screen.findByTestId('zama-cskirm-balance')).toHaveTextContent('1,250');
    expect(m.userDecryptUint).toHaveBeenCalledWith({}, {}, { handle: HANDLE, contractAddress: TOKEN });
    await userEvent.click(screen.getByTestId('zama-hide'));
    expect(screen.getByTestId('zama-cskirm-balance')).toHaveTextContent('••••••');
  });

  it('claims the faucet and re-reads the new handle', async () => {
    m.restore.mockResolvedValue(conn());
    m.claimFaucet.mockResolvedValue('0xtx');
    render(<CSkirmBalance />);
    const button = await screen.findByTestId('zama-faucet');
    await waitFor(() => expect(button).toHaveTextContent('Get 1,000 test credits'));
    m.readFaucet.mockResolvedValue({ amount: 1_000_000_000n, availableAt: Math.floor(Date.now() / 1000) + 3 * 3600 + 60 });
    await userEvent.click(button);
    expect(m.claimFaucet).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('zama-faucet')).toHaveTextContent(/Next claim in 3h/));
    expect(screen.getByTestId('zama-faucet')).toBeDisabled();
  });

  it('offers a network switch off Sepolia and shows wallet errors', async () => {
    m.restore.mockResolvedValue(conn(1));
    m.connect.mockRejectedValue(Object.assign(new Error('nope'), { code: 4001 }));
    render(<CSkirmBalance />);
    await userEvent.click(await screen.findByTestId('zama-switch'));
    expect(await screen.findByTestId('zama-error')).toHaveTextContent('rejected');
  });
});

describe('errorMessage', () => {
  it('prefers ethers short messages', () => {
    expect(errorMessage({ shortMessage: 'execution reverted' })).toBe('execution reverted');
    expect(errorMessage({ code: 'ACTION_REJECTED' })).toMatch(/rejected/);
    expect(errorMessage(null)).toMatch(/went wrong/);
  });
});
