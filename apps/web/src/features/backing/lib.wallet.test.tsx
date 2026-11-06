import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { meFixture } from '@/test/fixtures';
import { FakeWallet } from '@/test/fakeWallet';
import { renderWithProviders } from '@/test/render';
import { useBackingWrite } from './lib';

const linked = () => meFixture({ account: { ...meFixture().account, nearAccountId: 'ada.testnet' } });
const call = { contractId: 'backing.playskirm.testnet', methodName: 'back', args: { round: 1 }, depositYocto: '1000', gas: '30000000000000' };

function Back() {
  const run = useBackingWrite();
  const [out, setOut] = useState('');
  return (
    <button type="button" onClick={() => run(async () => ({ wallet: call })).then(() => setOut('ok'), (e: Error) => setOut(e.message))}>
      back {out}
    </button>
  );
}

describe('backing with NEAR', () => {
  it('keeps a signed stake whose sync failed and syncs it on the next try, never staking twice', async () => {
    const wallet = new FakeWallet({ account: 'ada.testnet', connected: true });
    let up = false;
    const { user, api } = renderWithProviders(<Back />, {
      authMode: 'privy',
      token: 'jwt_1',
      wallet,
      api: {
        me: async () => linked(),
        syncBacking: async () => {
          if (!up) throw new ApiError(503, 'rpc_unavailable', 'NEAR RPC is unavailable');
          return {} as never;
        },
      },
    });
    const btn = await screen.findByRole('button');
    await act(async () => {
      await user.click(btn);
    });
    expect(await screen.findByText(/NEAR RPC is unavailable/)).toBeInTheDocument();
    expect(wallet.sent).toHaveLength(1);
    up = true;
    await act(async () => {
      await user.click(btn);
    });
    expect(await screen.findByText('back ok')).toBeInTheDocument();
    expect(wallet.sent).toHaveLength(1);
    expect(api.syncBacking.mock.calls).toEqual([['tx_1'], ['tx_1']]);
  });
});
