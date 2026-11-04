import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { SkirmAgentClient, type Fetch, type Socket } from '../src/client';
import { handleMessage, serveStdio } from '../src/server';
import { TOOLS, ToolRunner } from '../src/tools';

const TOKEN = `ext_01J00000000000000000000000.sks_${'a'.repeat(43)}`;

/** A pull api in memory: one open turn, answers checked against its legal actions. */
function fakeApi() {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
  let turn: { turnId: string; observation: { legal: unknown[] } } | null = { turnId: 'mat_1.1.agt_1', observation: { legal: [{ type: 'wait' }, { type: 'move', dir: 'N' }] } };
  const answered = new Set<string>();
  const fetch: Fetch = async (url, init = {}) => {
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method: init.method ?? 'GET', url, headers: init.headers ?? {}, body });
    const path = new URL(url).pathname;
    const res = (status: number, v: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(v) });
    if (init.headers?.authorization !== `Bearer ${TOKEN}`) return res(401, { error: { code: 'invalid_agent_token', message: 'no' } });
    if (path === '/agent/v1/me') return res(200, { externalAgent: { id: 'ext_1', agentId: 'agt_1', mode: 'pull' }, account: { id: 'acc_1', handle: 'dev' }, agent: { id: 'agt_1', name: 'Rook' } });
    if (path === '/agent/v1/matches') return res(200, { matches: [{ id: 'mat_0', result: 'win' }] });
    if (path === '/agent/v1/turn') {
      const after = new URL(url).searchParams.get('after');
      return res(200, { turn: turn && turn.turnId !== after ? turn : null });
    }
    if (path === '/agent/v1/action') {
      if (!turn || body?.turnId !== turn.turnId) return res(409, { error: { code: 'stale_turn', message: 'gone' } });
      if (answered.has(turn.turnId)) return res(409, { error: { code: 'already_answered', message: 'twice' } });
      answered.add(turn.turnId);
      return res(200, { accepted: true, turnId: turn.turnId, action: body.action });
    }
    return res(404, { error: { code: 'not_found', message: 'nope' } });
  };
  return { fetch, calls, setTurn: (t: typeof turn) => (turn = t) };
}

/** A realtime socket that answers like a practice match: found, lock-in, start, a frame, the end. */
function fakeRealtime() {
  const sent: Record<string, unknown>[] = [];
  let h: { open?: () => void; message?: (d: string) => void; close?: () => void } = {};
  const emit = (m: unknown) => h.message?.(JSON.stringify(m));
  const socket: Socket = {
    send: (d) => {
      const m = JSON.parse(d) as Record<string, unknown>;
      sent.push(m);
      if (m.type === 'v2_queue') queueMicrotask(() => emit({ type: 'v2_found', matchId: 'mat_9', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10000, practice: true }));
      if (m.type === 'v2_accept') queueMicrotask(() => emit({ type: 'v2_lockin', matchId: 'mat_9', lockMs: 30000, rival: { agents: 1 } }));
      if (m.type === 'v2_lock_in') {
        queueMicrotask(() => emit({ type: 'v2_start', matchId: 'mat_9', team: 'A', rival: { handle: 'Greedy bot' }, tickMs: 2000, holdTicks: { A: 0, B: 0 } }));
        queueMicrotask(() => emit({ type: 'v2_frame', matchId: 'mat_9', frame: { tick: 1, score: { A: 0, B: 0 } } }));
      }
    },
    close: () => h.close?.(),
    onOpen: (fn) => {
      h.open = fn;
      queueMicrotask(fn);
    },
    onMessage: (fn) => void (h.message = fn),
    onClose: (fn) => void (h.close = fn),
    onError: () => undefined,
  };
  return { socket, sent, emit };
}

const text = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text) as Record<string, unknown>;

describe('MCP tool handlers', () => {
  const setup = () => {
    const api = fakeApi();
    const rt = fakeRealtime();
    const client = new SkirmAgentClient({ apiUrl: 'http://api.test', wsUrl: 'ws://rt.test/ws', token: TOKEN, fetch: api.fetch, connect: () => rt.socket });
    return { api, rt, client, tools: new ToolRunner(client) };
  };

  it('lists the four play tools and the status tool, each with an input schema', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(['list_matches', 'queue_practice', 'get_observation', 'submit_action', 'get_match_status']);
    for (const t of TOOLS) expect(t.inputSchema.type).toBe('object');
  });

  it('list_matches reads the pull api with the bearer token', async () => {
    const { api, tools } = setup();
    const r = await tools.call('list_matches', { limit: 3 });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toEqual({ matches: [{ id: 'mat_0', result: 'win' }] });
    expect(api.calls[0]).toMatchObject({ method: 'GET', url: 'http://api.test/agent/v1/matches?limit=3' });
    expect(api.calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('queue_practice signs in with the agent token, queues practice with its agent, accepts and locks in', async () => {
    const { rt, tools, client } = setup();
    const r = await tools.call('queue_practice', { difficulty: 'easy' });
    expect(text(r)).toMatchObject({ matchId: 'mat_9', phase: 'found', mapId: 'copper-hollow' });
    await new Promise((res) => setTimeout(res, 10));
    expect(rt.sent.map((m) => m.type)).toEqual(['auth', 'v2_queue', 'v2_accept', 'v2_lock_in']);
    expect(rt.sent[0]).toEqual({ type: 'auth', agentToken: TOKEN });
    expect(rt.sent[1]).toEqual({ type: 'v2_queue', crew: [{ agentId: 'agt_1', tier: 'standard' }], ranked: false, opponent: 'bot', difficulty: 'easy' });
    expect(client.status).toMatchObject({ phase: 'live', tick: 1 });
    const st = await tools.call('get_match_status', {});
    expect(text(st)).toMatchObject({ status: { matchId: 'mat_9', phase: 'live' } });
    rt.emit({ type: 'v2_end', matchId: 'mat_9', result: { winner: 'A' }, reason: 'goal', logHash: 'x' });
    expect(client.status).toMatchObject({ phase: 'ended', reason: 'goal' });
  });

  it('queue_practice reports a realtime refusal as a tool error', async () => {
    const api = fakeApi();
    const sock: Socket = {
      send: (d) => {
        if ((JSON.parse(d) as { type: string }).type === 'v2_queue') queueMicrotask(() => h?.(JSON.stringify({ type: 'error', code: 'agent_busy', message: 'an agent is in a match' })));
      },
      close: () => undefined,
      onOpen: (fn) => queueMicrotask(fn),
      onMessage: (fn) => void (h = fn),
      onClose: () => undefined,
      onError: () => undefined,
    };
    let h: ((d: string) => void) | undefined;
    const tools = new ToolRunner(new SkirmAgentClient({ apiUrl: 'http://api.test', wsUrl: 'ws://x', token: TOKEN, fetch: api.fetch, connect: () => sock }));
    const r = await tools.call('queue_practice', {});
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('agent_busy');
  });

  it('get_observation returns the open turn, submit_action answers it, and the next poll waits past it', async () => {
    const { api, tools } = setup();
    const obs = text(await tools.call('get_observation', { waitMs: 0 }));
    expect(obs.turnId).toBe('mat_1.1.agt_1');
    const sub = await tools.call('submit_action', { turnId: 'mat_1.1.agt_1', action: { type: 'move', dir: 'N' }, thought: 'north' });
    expect(text(sub)).toMatchObject({ accepted: true, action: { type: 'move', dir: 'N' } });
    expect(api.calls.at(-1)!.body).toEqual({ turnId: 'mat_1.1.agt_1', action: { type: 'move', dir: 'N' }, thought: 'north' });
    // The same turn is not handed out again.
    const next = text(await tools.call('get_observation', { waitMs: 0 }));
    expect(next.turn).toBeNull();
    expect(api.calls.at(-1)!.url).toContain('after=mat_1.1.agt_1');
  });

  it('submit_action surfaces stale and duplicate answers as tool errors', async () => {
    const { tools } = setup();
    const stale = await tools.call('submit_action', { turnId: 'old', action: { type: 'wait' } });
    expect(stale).toMatchObject({ isError: true });
    expect(stale.content[0]!.text).toContain('stale_turn');
    await tools.call('submit_action', { turnId: 'mat_1.1.agt_1', action: { type: 'wait' } });
    const dup = await tools.call('submit_action', { turnId: 'mat_1.1.agt_1', action: { type: 'wait' } });
    expect(dup.content[0]!.text).toContain('already_answered');
    expect((await tools.call('submit_action', { action: { type: 'wait' } })).isError).toBe(true);
  });

  it('a wrong token is a tool error, not a crash', async () => {
    const api = fakeApi();
    const tools = new ToolRunner(new SkirmAgentClient({ apiUrl: 'http://api.test', wsUrl: 'ws://x', token: 'nope', fetch: api.fetch }));
    const r = await tools.call('list_matches', {});
    expect(r).toMatchObject({ isError: true });
    expect(r.content[0]!.text).toContain('invalid_agent_token');
  });
});

describe('MCP JSON-RPC', () => {
  const tools = new ToolRunner(new SkirmAgentClient({ apiUrl: 'http://api.test', wsUrl: 'ws://x', token: TOKEN, fetch: fakeApi().fetch }));

  it('initializes with the tools capability and echoes a known protocol version', async () => {
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, tools);
    expect(r).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'skirm' } } });
  });

  it('lists tools, calls one, and refuses unknown tools and methods', async () => {
    const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, tools);
    expect((list!.result as { tools: unknown[] }).tools).toHaveLength(TOOLS.length);
    const call = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_matches', arguments: {} } }, tools);
    expect((call!.result as { isError?: boolean }).isError).toBeUndefined();
    expect(await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }, tools)).toMatchObject({ error: { code: -32602 } });
    expect(await handleMessage({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, tools)).toMatchObject({ error: { code: -32601 } });
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools)).toBeNull();
  });

  it('speaks newline-delimited JSON over stdio', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    serveStdio(tools, input, output);
    const lines: string[] = [];
    output.on('data', (d: Buffer) => lines.push(...d.toString().split('\n').filter(Boolean)));
    input.write('{"jsonrpc":"2.0","id":7,"method":"ping"}\nnot json\n');
    await new Promise((r) => setTimeout(r, 20));
    expect(lines.map((l) => JSON.parse(l))).toEqual(
      expect.arrayContaining([
        { jsonrpc: '2.0', id: 7, result: {} },
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      ]),
    );
  });
});
