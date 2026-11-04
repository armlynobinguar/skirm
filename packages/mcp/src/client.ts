// The skirm side of the MCP server: the external agent pull api (`/agent/v1/*`, docs/external-agents.md)
// over HTTP, and practice matches over the realtime WebSocket, both signed in with one external agent
// token (`<id>.<secret>`). Standalone on purpose (no @skirm/* imports), so it can ship on its own.

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The few socket calls the client needs (`ws` in production, a fake in tests). */
export interface Socket {
  send(data: string): void;
  close(): void;
  onOpen(fn: () => void): void;
  onMessage(fn: (data: string) => void): void;
  onClose(fn: () => void): void;
  onError(fn: (err: Error) => void): void;
}

export type Connect = (url: string) => Socket;

export interface ClientOptions {
  /** e.g. http://localhost:4000 */
  apiUrl: string;
  /** e.g. ws://localhost:4001/ws */
  wsUrl: string;
  /** The external agent token, shown when it was registered or rotated. */
  token: string;
  fetch?: Fetch;
  connect?: Connect;
  /** How long queue_practice waits for the match to be found (default 15 s). */
  queueTimeoutMs?: number;
}

export class SkirmApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SkirmApiError';
  }
}

/** What the practice socket has seen of the latest match. */
export interface MatchStatus {
  matchId: string;
  phase: 'found' | 'lockin' | 'live' | 'ended';
  mapId?: string;
  difficulty?: string;
  tick?: number;
  score?: unknown;
  result?: unknown;
  reason?: string;
  error?: string;
}

export interface PracticeOptions {
  mapId?: string;
  difficulty?: 'easy' | 'normal' | 'hard' | 'agentic' | 'mega';
}

export class SkirmAgentClient {
  private readonly fetch: Fetch;
  status: MatchStatus | null = null;
  private socket: Socket | null = null;

  constructor(private readonly opts: ClientOptions) {
    this.fetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(`${this.opts.apiUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.opts.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new SkirmApiError(res.status, e?.code ?? 'http_error', e?.message ?? `HTTP ${res.status}`);
    }
    return json as T;
  }

  me() {
    return this.call<{ externalAgent: { id: string; agentId: string | null; mode: string }; account: { id: string; handle: string }; agent: { id: string; name: string } | null }>('GET', '/agent/v1/me');
  }

  matches(limit = 10) {
    return this.call<{ matches: unknown[] }>('GET', `/agent/v1/matches?limit=${limit}`);
  }

  turn(waitMs = 0, after?: string) {
    const q = new URLSearchParams({ waitMs: String(waitMs), ...(after ? { after } : {}) });
    return this.call<{ turn: ({ turnId: string } & Record<string, unknown>) | null }>('GET', `/agent/v1/turn?${q}`);
  }

  action(body: { turnId: string; action: unknown; say?: unknown; thought?: unknown }) {
    return this.call<{ accepted: true; turnId: string; action: unknown }>('POST', '/agent/v1/action', body);
  }

  /**
   * Starts a practice match against the greedy bot with the agent this external agent plays:
   * signs in on the realtime socket with the token, queues, accepts and locks in at Standard.
   * Resolves once the match is found; the socket stays open (status updates) until it ends.
   */
  async queuePractice(p: PracticeOptions = {}): Promise<MatchStatus> {
    const me = await this.me();
    if (!me.agent) throw new SkirmApiError(409, 'not_bound', 'bind this external agent to one of your agents first (Account → External agents)');
    if (this.status && this.status.phase !== 'ended' && this.socket) throw new SkirmApiError(409, 'in_match', `already in match ${this.status.matchId}`);
    const connect = this.opts.connect ?? defaultConnect;
    const agentId = me.agent.id;
    const ws = connect(this.opts.wsUrl);
    this.socket = ws;
    return new Promise<MatchStatus>((resolve, reject) => {
      let settled = false;
      const done = (err: Error | null, s?: MatchStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          ws.close();
          if (this.socket === ws) this.socket = null;
          reject(err);
        } else resolve(s!);
      };
      const timer = setTimeout(() => done(new SkirmApiError(504, 'queue_timeout', 'no match was found in time')), this.opts.queueTimeoutMs ?? 15_000);
      ws.onOpen(() => {
        ws.send(JSON.stringify({ type: 'auth', agentToken: this.opts.token }));
        ws.send(JSON.stringify({ type: 'v2_queue', crew: [{ agentId, tier: 'standard' }], ranked: false, opponent: 'bot', ...(p.mapId ? { mapId: p.mapId } : {}), ...(p.difficulty ? { difficulty: p.difficulty } : {}) }));
      });
      ws.onMessage((raw) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }
        const matchId = typeof m.matchId === 'string' ? m.matchId : this.status?.matchId;
        switch (m.type) {
          case 'v2_found':
            this.status = { matchId: matchId!, phase: 'found', mapId: m.mapId as string, ...(m.difficulty ? { difficulty: m.difficulty as string } : {}) };
            ws.send(JSON.stringify({ type: 'v2_accept', matchId }));
            done(null, { ...this.status });
            break;
          case 'v2_lockin':
            if (this.status) this.status.phase = 'lockin';
            ws.send(JSON.stringify({ type: 'v2_lock_in', matchId, tiers: ['standard'] }));
            break;
          case 'v2_start':
            if (this.status) this.status.phase = 'live';
            break;
          case 'v2_frame': {
            const f = m.frame as { tick?: number; score?: unknown } | undefined;
            if (this.status) Object.assign(this.status, { phase: 'live', tick: f?.tick, score: f?.score });
            break;
          }
          case 'v2_end':
            if (this.status) Object.assign(this.status, { phase: 'ended', result: m.result, reason: m.reason });
            if (this.socket === ws) this.socket = null;
            ws.close();
            break;
          case 'error':
            if (!settled) done(new SkirmApiError(400, String(m.code), String(m.message)));
            else if (this.status) this.status.error = `${String(m.code)}: ${String(m.message)}`;
            break;
        }
      });
      ws.onError((err) => done(new SkirmApiError(502, 'ws_error', err.message)));
      ws.onClose(() => {
        if (this.socket === ws) this.socket = null;
        done(new SkirmApiError(502, 'ws_closed', 'the realtime connection closed'));
      });
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

/** A `ws` socket, loaded on first use so tests never need the package. */
const defaultConnect: Connect = (url) => {
  let handlers: { open?: () => void; message?: (d: string) => void; close?: () => void; error?: (e: Error) => void } = {};
  const pending: string[] = [];
  let sock: import('ws').WebSocket | null = null;
  let closed = false;
  void import('ws').then(({ WebSocket }) => {
    if (closed) return;
    const s = new WebSocket(url);
    sock = s;
    s.on('open', () => {
      for (const p of pending.splice(0)) s.send(p);
      handlers.open?.();
    });
    s.on('message', (d) => handlers.message?.(d.toString()));
    s.on('close', () => handlers.close?.());
    s.on('error', (e) => handlers.error?.(e));
  });
  return {
    send: (d) => (sock && sock.readyState === sock.OPEN ? sock.send(d) : void pending.push(d)),
    close: () => {
      closed = true;
      sock?.close();
      handlers = {};
    },
    onOpen: (fn) => void (handlers.open = fn),
    onMessage: (fn) => void (handlers.message = fn),
    onClose: (fn) => void (handlers.close = fn),
    onError: (fn) => void (handlers.error = fn),
  };
};
