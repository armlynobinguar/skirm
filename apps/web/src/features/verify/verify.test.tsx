import { appendTick, startLog, type LogHeader } from '@skirm/engine/v2';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { config } from '@/lib/config';
import type { PublicMatchLog } from '@/lib/api/matchLogTypes';
import { createFakeApi } from '@/test/fakeApi';
import { v2MatchRecordFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { testRouter } from '@/test/router';
import { VerifyPanel } from './VerifyPanel';
import { VerifyScreen, matchIdFrom } from './VerifyScreen';
import { buildReport, checkChain, fetchRegistryMatch, verifyLinks, verifyMatch, type RegistryMatch } from './verify';

const header: LogHeader = {
  schema: 'skirm.match/v2',
  map: 'copper-hollow',
  crews: {
    A: [{ id: 'wick', name: 'Wick', role: 'Builder', vision: 3, comms: 3, tier: 'standard' }],
    B: [{ id: 'wren', name: 'Wren', role: 'Scout', vision: 4, comms: 2, tier: 'standard' }],
  },
  ranked: true,
  models: { planner: 'greedy', actor: 'greedy', speech: 'greedy' },
};

/** A 3-tick log, as the api serves it (tick 2 carried live commands, so it comes redacted). */
function served(): PublicMatchLog {
  const log = startLog(header);
  appendTick(log, { tick: 1, actions: { wick: { type: 'move', dir: 'E' }, wren: { type: 'wait' } }, says: [{ agent: 'wick', channel: 'team', text: 'going east' }] });
  appendTick(log, { tick: 2, actions: { wick: { type: 'wait' }, wren: { type: 'wait' } }, says: [], commands: [{ team: 'A', agents: ['wick'], preset: null, text: 'hold' }] });
  appendTick(log, { tick: 3, actions: { wick: { type: 'switch' }, wren: { type: 'wait' } }, says: [] });
  log.result = { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 4, B: 2 }, ticks: 3 };
  const json = JSON.parse(JSON.stringify(log)) as typeof log;
  const { commands: _c, ...t2 } = json.ticks[1]!;
  json.ticks[1] = { ...t2, redacted: true } as never;
  return { matchId: 'mat_v2', logHash: log.hashes.at(-1)!, log: json };
}

function record(o: Partial<RegistryMatch> = {}): RegistryMatch {
  const log = served();
  return {
    match_id: 'mat_v2',
    season_id: null,
    map_id: 'copper-hollow',
    ranked: true,
    side_a: { player: 'ada.testnet', agents: ['wick'], tiers: ['standard'], delivered: 4 },
    side_b: { player: 'ben.testnet', agents: ['wren'], tiers: ['standard'], delivered: 2 },
    result: 'A',
    decided_by: 'goal',
    head_start_ticks: 0,
    ticks: 3,
    log_sha256: log.logHash!,
    recorded_at_ms: '1761393780000',
    block_height: '187440904',
    ...o,
  };
}

/** A mocked NEAR RPC node answering `query` / `call_function`. */
function rpc(answer: (params: Record<string, string>) => unknown, status = 200) {
  const calls: Record<string, string>[] = [];
  const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body.params);
    return new Response(JSON.stringify(answer(body.params)), { status });
  });
  return { fetch: f as unknown as typeof fetch, calls };
}
const viewResult = (value: unknown) => ({ jsonrpc: '2.0', id: 'x', result: { result: [...new TextEncoder().encode(JSON.stringify(value))], logs: [], block_height: 1, block_hash: 'h' } });

const match = (o: Parameters<typeof v2MatchRecordFixture>[0] = {}) => v2MatchRecordFixture({ id: 'mat_v2', logHash: served().logHash, registry: { status: 'recorded', txHash: 'Fx9abc' }, ...o });

describe('checkChain', () => {
  it('rechains the log, taking a redacted tick on its logged hash', () => {
    const c = checkChain(served().log);
    expect(c).toEqual({ ok: true, final: served().logHash, brokenAt: null, ticks: 3, redacted: 1 });
  });

  it('finds the tick where a tampered log breaks', () => {
    const s = served();
    s.log.ticks[2]!.actions.wick = { type: 'wait' };
    expect(checkChain(s.log)).toMatchObject({ ok: false, brokenAt: 3, final: null });
    const h = served();
    h.log.header.ranked = false;
    expect(checkChain(h.log)).toMatchObject({ ok: false, brokenAt: 0 });
    const short = served();
    short.log.hashes.pop();
    expect(checkChain(short.log).ok).toBe(false);
  });
});

describe('fetchRegistryMatch', () => {
  it('calls get_match on the registry with base64 args and decodes the record', async () => {
    const r = rpc(() => viewResult(record()));
    const got = await fetchRegistryMatch('mat_v2', { rpcUrl: 'https://rpc.test', contractId: 'registry.playskirm.testnet', fetch: r.fetch });
    expect(got).toEqual(record());
    expect(r.calls[0]).toMatchObject({ request_type: 'call_function', account_id: 'registry.playskirm.testnet', method_name: 'get_match', finality: 'final' });
    expect(JSON.parse(atob(r.calls[0]!.args_base64!))).toEqual({ match_id: 'mat_v2' });
  });

  it('null when the registry has no such match', async () => {
    expect(await fetchRegistryMatch('mat_v2', { rpcUrl: 'https://rpc.test', fetch: rpc(() => viewResult(null)).fetch })).toBeNull();
  });

  it('unavailable for a missing account or contract, a node error and no network', async () => {
    const opts = (f: typeof fetch) => ({ rpcUrl: 'https://rpc.test', contractId: 'registry.playskirm.testnet', fetch: f });
    await expect(fetchRegistryMatch('m', opts(rpc(() => ({ error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' } } })).fetch))).rejects.toThrow('does not exist');
    await expect(fetchRegistryMatch('m', opts(rpc(() => ({ result: { error: 'wasm execution failed with error: CompilationError(CodeDoesNotExist { .. })' } })).fetch))).rejects.toThrow('no contract deployed');
    await expect(fetchRegistryMatch('m', opts(rpc(() => ({}), 503).fetch))).rejects.toThrow('503');
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchRegistryMatch('m', opts(down))).rejects.toThrow('could not reach');
  });
});

describe('buildReport', () => {
  it('verified when the record matches the rechained log, winner and score', () => {
    const r = buildReport({ match: match(), log: served(), record: record(), contractId: 'registry.playskirm.testnet', network: 'testnet' });
    expect(r.status).toBe('verified');
    expect(r.checks.map((c) => [c.id, c.ok])).toEqual([
      ['chain', true],
      ['server_hash', true],
      ['log_result', true],
      ['chain_hash', true],
      ['chain_winner', true],
      ['chain_score', true],
    ]);
    expect(r.links).toEqual({ contract: 'https://testnet.nearblocks.io/address/registry.playskirm.testnet', tx: 'https://testnet.nearblocks.io/txns/Fx9abc' });
  });

  it('mismatch on another onchain hash, winner or score', () => {
    expect(buildReport({ match: match(), log: served(), record: record({ log_sha256: 'cd'.repeat(32) }) }).status).toBe('mismatch');
    expect(buildReport({ match: match(), log: served(), record: record({ result: 'B' }) }).status).toBe('mismatch');
    const r = buildReport({ match: match(), log: served(), record: record({ side_b: { player: 'ben.testnet', agents: ['wren'], tiers: ['standard'], delivered: 3 } }) });
    expect(r.status).toBe('mismatch');
    expect(r.checks.find((c) => c.id === 'chain_score')).toMatchObject({ ok: false, detail: 'onchain 4–3, scoreboard 4–2' });
  });

  it('mismatch when the log does not hash to what the server says, even with no record', () => {
    const r = buildReport({ match: match({ logHash: 'ee'.repeat(32) }), log: served(), record: null });
    expect(r.status).toBe('mismatch');
  });

  it('not recorded: explains why from the match', () => {
    const casual = buildReport({ match: match({ ranked: false, registry: { status: 'none' } }), log: served(), record: null });
    expect(casual.status).toBe('not_recorded');
    expect(casual.reason).toMatch(/Only ranked matches/);
    expect(casual.links.tx).toBeNull();
    expect(buildReport({ match: match({ registry: { status: 'local', txHash: 'noop:abc' } }), log: served(), record: null }).reason).toMatch(/NEAR is off/);
    expect(buildReport({ match: match({ registry: { status: 'pending' } }), log: served(), record: null }).reason).toMatch(/queued/);
    expect(buildReport({ match: match({ registry: { status: 'recorded' } }), log: served(), record: null }).reason).toMatch(/signer is not set up/);
  });

  it('unavailable when NEAR could not be read; no log is a failed browser check', () => {
    expect(buildReport({ match: match(), log: served(), record: { unavailable: 'down' } })).toMatchObject({ status: 'unavailable', reason: 'Could not read the registry: down.' });
    const noLog = buildReport({ match: match(), log: null, record: record() });
    expect(noLog.status).toBe('mismatch');
    expect(noLog.checks[0]).toMatchObject({ id: 'chain', ok: false });
  });

  it('mainnet links go to nearblocks.io', () => {
    expect(verifyLinks({ registry: { status: 'recorded', txHash: 'T' } }, 'registry.near', 'mainnet')).toEqual({ contract: 'https://nearblocks.io/address/registry.near', tx: 'https://nearblocks.io/txns/T' });
  });
});

describe('verifyMatch', () => {
  it('fetches the match, its log and the record; a missing log is not an error', async () => {
    const api = { v2Match: vi.fn(async () => match()), v2MatchLog: vi.fn(async () => served()) };
    const r = await verifyMatch(api, 'mat_v2', { rpcUrl: 'https://rpc.test', fetch: rpc(() => viewResult(record())).fetch });
    expect(r.status).toBe('verified');
    api.v2MatchLog.mockRejectedValueOnce(new ApiError(404, 'not_found', 'log not found'));
    const r2 = await verifyMatch(api, 'mat_v2', { rpcUrl: 'https://rpc.test', fetch: rpc(() => viewResult(null)).fetch });
    expect(r2.status).toBe('mismatch');
  });

  it('refuses a live match', async () => {
    const api = { v2Match: vi.fn(async () => match({ status: 'live' })), v2MatchLog: vi.fn() };
    await expect(verifyMatch(api, 'mat_v2')).rejects.toMatchObject({ code: 'match_live' });
    expect(api.v2MatchLog).not.toHaveBeenCalled();
  });
});

describe('VerifyPanel and /verify', () => {
  it('runs on click and shows not recorded onchain with the reason', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(rpc(() => viewResult(null)).fetch);
    const api = createFakeApi({ v2Match: async () => match({ ranked: false, registry: { status: 'none' } }), v2MatchLog: async () => served() });
    renderWithProviders(<VerifyPanel matchId="mat_v2" />, { api });
    fireEvent.click(screen.getByTestId('verify-run'));
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Not recorded onchain');
    expect(screen.getByTestId('verify-result')).toHaveTextContent('Only ranked matches');
    expect(screen.getByTestId('verify-check-chain')).toHaveAttribute('data-ok');
    fetchSpy.mockRestore();
  });

  it('the page takes a pasted match link and runs the check from ?id=', async () => {
    expect(matchIdFrom(' https://playskirm.xyz/matches/mat_01ABC/result ')).toBe('mat_01ABC');
    expect(matchIdFrom('https://playskirm.xyz/verify?id=mat_2')).toBe('mat_2');
    expect(matchIdFrom('mat_3')).toBe('mat_3');

    const api = createFakeApi();
    const { unmount } = renderWithProviders(<VerifyScreen />, { api, path: '/verify' });
    fireEvent.change(screen.getByTestId('verify-input'), { target: { value: 'https://x/matches/mat_v2' } });
    fireEvent.click(screen.getByTestId('verify-submit'));
    expect(testRouter.replace).toHaveBeenCalledWith('/verify?id=mat_v2');
    unmount();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(rpc(() => viewResult(record())).fetch);
    const api2 = createFakeApi({ v2Match: async () => match(), v2MatchLog: async () => served() });
    renderWithProviders(<VerifyScreen />, { api: api2, path: '/verify', search: '?id=mat_v2' });
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Pass · Verified on NEAR');
    expect(screen.getByTestId('verify-glyph')).toHaveTextContent('✓');
    expect(screen.getByTestId('verify-compare')).toHaveAttribute('data-same');
    expect(screen.getByTestId('verify-compare')).toHaveTextContent('= identical');
    expect(screen.getByTestId('verify-hash-browser')).toHaveTextContent(served().logHash!);
    expect(screen.getByTestId('verify-hash-onchain')).toHaveTextContent(served().logHash!);
    expect(screen.getByTestId('verify-tx')).toHaveAttribute('href', 'https://testnet.nearblocks.io/txns/Fx9abc');
    expect(screen.getByTestId('verify-contract')).toHaveAttribute('href', 'https://testnet.nearblocks.io/address/registry.playskirm.testnet');
    fetchSpy.mockRestore();
  });

  it('a mismatched onchain hash reads as a fail with both hashes side by side', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(rpc(() => viewResult(record({ log_sha256: 'cd'.repeat(32) }))).fetch);
    const api = createFakeApi({ v2Match: async () => match(), v2MatchLog: async () => served() });
    renderWithProviders(<VerifyPanel matchId="mat_v2" auto />, { api });
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Fail · Mismatch');
    expect(screen.getByTestId('verify-glyph')).toHaveTextContent('✗');
    expect(screen.getByTestId('verify-compare')).not.toHaveAttribute('data-same');
    expect(screen.getByTestId('verify-compare')).toHaveTextContent('≠ different');
    expect(screen.getByTestId('verify-hash-onchain')).toHaveTextContent('cd'.repeat(32));
    fetchSpy.mockRestore();
  });
});

describe('/verify sample match', () => {
  const original = config.sampleMatchId;
  afterEach(() => {
    config.sampleMatchId = original;
  });

  it('is hidden when NEXT_PUBLIC_SAMPLE_MATCH_ID is unset', () => {
    config.sampleMatchId = '';
    renderWithProviders(<VerifyScreen />, { api: createFakeApi(), path: '/verify' });
    expect(screen.queryByTestId('verify-sample')).not.toBeInTheDocument();
  });

  it('fills the input with the sample id and runs the check', async () => {
    config.sampleMatchId = 'mat_v2';
    renderWithProviders(<VerifyScreen />, { api: createFakeApi(), path: '/verify' });
    fireEvent.click(screen.getByTestId('verify-sample'));
    expect(screen.getByTestId('verify-input')).toHaveValue('mat_v2');
    expect(testRouter.replace).toHaveBeenCalledWith('/verify?id=mat_v2');
  });
});
