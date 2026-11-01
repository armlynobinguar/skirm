import { describe, expect, it, vi } from 'vitest';
import { fetchNearBalance, nearShort } from './useNearBalance';

const RPC = 'https://rpc.test';
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('fetchNearBalance', () => {
  it('posts a final view_account query and returns the liquid amount', async () => {
    const f = reply({ jsonrpc: '2.0', id: 'skirm', result: { amount: '3204000000000000000000000', locked: '0' } });
    expect(await fetchNearBalance('ada.testnet', RPC, f)).toBe('3204000000000000000000000');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RPC);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 'skirm',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: 'ada.testnet' },
    });
  });

  it('returns null for an account that is not on the network', async () => {
    const unknown = reply({ error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' }, message: 'Server error' } });
    expect(await fetchNearBalance('ghost.testnet', RPC, unknown)).toBeNull();
    const legacy = reply({ result: { error: 'account ghost.testnet does not exist while viewing' } });
    expect(await fetchNearBalance('ghost.testnet', RPC, legacy)).toBeNull();
  });

  it('throws on HTTP and other RPC errors', async () => {
    await expect(fetchNearBalance('ada.testnet', RPC, reply({}, 503))).rejects.toThrow('NEAR RPC 503');
    await expect(
      fetchNearBalance('ada.testnet', RPC, reply({ error: { name: 'REQUEST_VALIDATION_ERROR', message: 'Parse error' } })),
    ).rejects.toThrow('Parse error');
    await expect(fetchNearBalance('ada.testnet', RPC, reply({ result: {} }))).rejects.toThrow('no amount');
  });
});

describe('nearShort', () => {
  it('shows two decimals, rounded down', () => {
    expect(nearShort('3204000000000000000000000')).toBe('3.20');
    expect(nearShort('3209999999999999999999999')).toBe('3.20');
    expect(nearShort(0n)).toBe('0.00');
    expect(nearShort('12050000000000000000000000')).toBe('12.05');
  });
});
