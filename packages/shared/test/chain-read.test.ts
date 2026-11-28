import { describe, expect, it, vi } from 'vitest';
import { handlesSet, isTransientRpcError, retryRead, waitForChain, waitForHandles } from '../src/chain-read';

const noSleep = async () => {};
const ZERO = `0x${'0'.repeat(64)}`;
const SET = `0x${'ab'.repeat(32)}`;
const timeout = () => Object.assign(new Error('request timeout (code=TIMEOUT, version=6.17.0)'), { code: 'TIMEOUT' });

describe('chain reads', () => {
  it('tells RPC hiccups from answers', () => {
    expect(isTransientRpcError(timeout())).toBe(true);
    expect(isTransientRpcError(new Error('fetch failed', { cause: { code: 'ECONNRESET' } }))).toBe(true);
    expect(isTransientRpcError({ status: 503 })).toBe(true);
    expect(isTransientRpcError(new Error('server response 429 Too Many Requests'))).toBe(true);
    expect(isTransientRpcError(Object.assign(new Error('execution reverted: WrongStatus'), { code: 'CALL_EXCEPTION' }))).toBe(false);
    expect(isTransientRpcError(new Error('not your turn'))).toBe(false);
    expect(isTransientRpcError(undefined)).toBe(false);
  });

  it('retries a read that timed out, and stops at once on a revert', async () => {
    const read = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValueOnce(7);
    await expect(retryRead(read, { sleep: noSleep })).resolves.toBe(7);
    expect(read).toHaveBeenCalledTimes(2);

    const revert = vi.fn().mockRejectedValue(Object.assign(new Error('reverted'), { code: 'CALL_EXCEPTION' }));
    await expect(retryRead(revert, { sleep: noSleep })).rejects.toThrow('reverted');
    expect(revert).toHaveBeenCalledTimes(1);

    const down = vi.fn().mockRejectedValue(timeout());
    await expect(retryRead(down, { sleep: noSleep, tries: 3 })).rejects.toThrow('timeout');
    expect(down).toHaveBeenCalledTimes(3);
  });

  it('waits past a stale read until the state shows the transaction', async () => {
    const read = vi.fn().mockResolvedValueOnce('open').mockRejectedValueOnce(timeout()).mockResolvedValueOnce('open').mockResolvedValueOnce('closed');
    await expect(waitForChain(read, (s) => s !== 'open', { sleep: noSleep })).resolves.toBe('closed');
    await expect(waitForChain(async () => 'open', (s) => s !== 'open', { sleep: noSleep, polls: 3, what: 'the market to close' })).rejects.toThrow(
      'the market to close',
    );
  });

  it('waits for non-zero handles before a reveal', async () => {
    expect(handlesSet([SET, SET])).toBe(true);
    expect(handlesSet([SET, ZERO])).toBe(false);
    expect(handlesSet([])).toBe(false);
    const read = vi.fn().mockResolvedValueOnce([ZERO, ZERO]).mockResolvedValueOnce([SET, SET]);
    await expect(waitForHandles(read, { sleep: noSleep })).resolves.toEqual([SET, SET]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
