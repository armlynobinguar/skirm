import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRelayerOutage, resetZamaProgress, trackRelayer, trackStep, trackTx, zamaProgress } from '@/lib/zama/steps';
import { ZamaProgress } from './ZamaProgress';

beforeEach(() => resetZamaProgress());
afterEach(() => resetZamaProgress());

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}
const step = (name: string) => screen.getByText(new RegExp(name)).closest('li')!;

describe('zama steps', () => {
  it('shows nothing while idle, then each wait in turn', async () => {
    render(<ZamaProgress />);
    expect(screen.queryByTestId('zama-progress')).not.toBeInTheDocument();
    const enc = deferred<void>();
    const sent = deferred<{ wait(): Promise<string> }>();
    const mined = deferred<string>();
    let run!: Promise<{ receipt: string }>;
    act(() => {
      run = trackStep('encrypt', () => enc.promise).then(() => trackTx(() => sent.promise));
    });
    expect(step('Encrypting').dataset.state).toBe('active');
    await act(async () => enc.resolve());
    expect(step('Encrypting').dataset.state).toBe('done');
    expect(step('Signing').dataset.state).toBe('active');
    await act(async () => sent.resolve({ wait: () => mined.promise }));
    expect(step('Confirming').dataset.state).toBe('active');
    await act(async () => mined.resolve('receipt'));
    expect((await run).receipt).toBe('receipt');
    expect(step('Decrypting').dataset.state).toBe('todo');
  });

  it('retries a relayer outage by itself, but not a refusal or a rejected wallet request', async () => {
    let tries = 0;
    const out = await trackRelayer('decrypt', async () => {
      if (++tries < 3) throw new Error('Failed to fetch');
      return 'ok';
    }, [1, 1]);
    expect([out, tries]).toEqual(['ok', 3]);
    tries = 0;
    await expect(trackRelayer('decrypt', async () => (tries++, Promise.reject(new Error('not authorized on handle'))), [1, 1])).rejects.toThrow('not authorized');
    expect(tries).toBe(1);
    expect(isRelayerOutage(Object.assign(new Error('network error'), { code: 4001 }))).toBe(false);
    expect(isRelayerOutage(new Error('handle 0x5025001429'))).toBe(false);
  });

  it('asks the player when the relayer keeps failing: try again, or give up', async () => {
    render(<ZamaProgress />);
    const user = userEvent.setup();
    const fn = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce('ok');
    let run!: Promise<string>;
    await act(async () => void (run = trackRelayer('decrypt', fn, [])));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await run).toBe('ok');

    let failed!: Promise<string>;
    await act(async () => {
      failed = trackRelayer('encrypt', () => Promise.reject(new Error('503')), []);
      failed.catch(() => undefined);
    });
    await user.click(await screen.findByRole('button', { name: 'Give up' }));
    await expect(failed).rejects.toThrow('503');
  });

  it('never repeats a transaction, and fails at once with no panel to ask', async () => {
    const send = vi.fn(() => Promise.reject(new Error('Failed to fetch')));
    await expect(trackTx(send)).rejects.toThrow('Failed to fetch');
    expect(send).toHaveBeenCalledTimes(1);
    await expect(trackRelayer('decrypt', () => Promise.reject(new Error('503')), [])).rejects.toThrow('503');
    expect(zamaProgress.get().failed).toBeNull();
  });
});
