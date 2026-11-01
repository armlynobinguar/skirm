// One shared WebSocket to apps/realtime for the whole tab.
//
// - Lazy: the socket opens on the first watchV2 / send (or connect()). onMessage alone does not
//   open it (the app-wide cache invalidation listens without forcing a socket).
// - Auth on open: `{type:'auth', devUser | token}` from the CredentialsStore, sent first; the server
//   handles one connection's messages in order, so watches can follow at once. Signed-out clients
//   skip auth (public matches still stream to spectators).
// - Refcounted watches: watchV2(matchId) sends `v2_watch` for the first watcher and `v2_unwatch`
//   after the last; the watch is forgotten at v2_end, when the server drops it. Its frames reach
//   onMessage listeners (the tab's v2 store).
// - Reconnect with exponential backoff and jitter (0.5 s doubling to 10 s). After a reconnect it
//   re-authenticates and re-sends every live v2 watch. A queue entry is NOT restored: the server
//   drops it when the last socket closes, so the queue screens re-queue (watch `status`).
// - Credentials change (sign in / out): the socket is replaced, because auth is once per connection.
import type { CredentialsStore } from '../auth/credentials';
import type { V2ClientMessage, WsClientMessage, WsServerMessage } from './protocol';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Messages a screen sends itself (queue, accept, lock-in, replay). Watches go through watchV2. */
export type OutgoingMessage = V2ClientMessage;

/** What hooks and screens use. RealtimeClient implements it; FakeRealtime (src/test) too. */
export interface Realtime {
  getStatus(): ConnectionStatus;
  onStatus(fn: (s: ConnectionStatus) => void): () => void;
  /** Every server message, including `error`, `queue_status` and `v2_found`. Does not connect. */
  onMessage(fn: (m: WsServerMessage) => void): () => void;
  /**
   * Spectates a v2 match: its whole-board v2_frame and v2_end messages arrive through onMessage.
   * Refcounted; re-sent after a reconnect. Returns the dispose function.
   */
  watchV2(matchId: string): () => void;
  /** Sends now when open, otherwise once the next connection is authenticated. */
  send(msg: OutgoingMessage): void;
  connect(): void;
  close(): void;
}

/** The subset of the browser WebSocket the client needs (tests pass a fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface RealtimeClientOptions {
  url: string;
  credentials: CredentialsStore;
  createSocket?: (url: string) => SocketLike;
  backoff?: { baseMs: number; maxMs: number };
  /** For tests: 0..1. */
  random?: () => number;
}

const OPEN = 1;

export class RealtimeClient implements Realtime {
  private socket: SocketLike | null = null;
  private status: ConnectionStatus = 'idle';
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private readonly statusSubs = new Set<(s: ConnectionStatus) => void>();
  private readonly messageSubs = new Set<(m: WsServerMessage) => void>();
  /** v2 matches watched: watchers per match id. */
  private readonly v2Watches = new Map<string, number>();
  private outbox: OutgoingMessage[] = [];
  private readonly unsubCredentials: () => void;

  constructor(private readonly opts: RealtimeClientOptions) {
    // Sign in / out: auth is per connection, so start a new one (only if one was in use).
    this.unsubCredentials = opts.credentials.subscribe(() => {
      if (this.socket || this.retryTimer) this.restart();
    });
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatus(fn: (s: ConnectionStatus) => void): () => void {
    this.statusSubs.add(fn);
    return () => this.statusSubs.delete(fn);
  }

  onMessage(fn: (m: WsServerMessage) => void): () => void {
    this.messageSubs.add(fn);
    return () => this.messageSubs.delete(fn);
  }

  watchV2(matchId: string): () => void {
    const n = this.v2Watches.get(matchId) ?? 0;
    this.v2Watches.set(matchId, n + 1);
    this.connect();
    if (n === 0) this.sendNow({ type: 'v2_watch', matchId });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = this.v2Watches.get(matchId);
      // Gone already: the match ended (the server dropped the watch with v2_end).
      if (n === undefined) return;
      if (n > 1) return void this.v2Watches.set(matchId, n - 1);
      this.v2Watches.delete(matchId);
      this.sendNow({ type: 'v2_unwatch', matchId });
    };
  }

  send(msg: OutgoingMessage): void {
    this.connect();
    if (this.socket?.readyState === OPEN) this.raw(msg);
    else this.outbox.push(msg);
  }

  connect(): void {
    this.closedByUser = false;
    if (this.socket || this.retryTimer) return;
    this.open();
  }

  /** Closes for good (until the next connect()). Subscriptions are kept for a later connect. */
  close(): void {
    this.closedByUser = true;
    this.clearRetry();
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = s.onerror = s.onmessage = s.onopen = null;
      try {
        s.close(1000, 'client closed');
      } catch {
        /* ignore */
      }
    }
    this.setStatus('closed');
  }

  /** close() plus dropping every listener and the credentials subscription. */
  dispose(): void {
    this.close();
    this.unsubCredentials();
    this.v2Watches.clear();
    this.messageSubs.clear();
    this.statusSubs.clear();
    this.outbox = [];
  }

  // ---------- internals ----------

  private restart(): void {
    this.close();
    this.closedByUser = false;
    this.attempt = 0;
    this.open();
  }

  private createSocket(url: string): SocketLike | null {
    if (this.opts.createSocket) return this.opts.createSocket(url);
    if (typeof WebSocket === 'undefined') return null; // SSR
    return new WebSocket(url) as unknown as SocketLike;
  }

  private open(): void {
    const socket = this.createSocket(this.opts.url);
    if (!socket) return;
    this.socket = socket;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      const c = this.opts.credentials.get();
      if (c) this.raw(c.kind === 'dev' ? { type: 'auth', devUser: c.handle } : { type: 'auth', token: c.token });
      for (const matchId of this.v2Watches.keys()) this.raw({ type: 'v2_watch', matchId });
      const out = this.outbox;
      this.outbox = [];
      for (const m of out) this.raw(m);
      this.setStatus('open');
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as WsServerMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      this.dispatch(msg);
    };
    socket.onerror = () => {
      /* onclose follows */
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closedByUser) return this.setStatus('closed');
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    const { baseMs, maxMs } = this.opts.backoff ?? { baseMs: 500, maxMs: 10_000 };
    const rnd = this.opts.random ?? Math.random;
    const delay = Math.min(maxMs, baseMs * 2 ** this.attempt) * (0.5 + rnd() / 2);
    this.attempt++;
    this.setStatus('reconnecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private dispatch(msg: WsServerMessage): void {
    if (msg.type === 'v2_end') this.v2Watches.delete(msg.matchId);
    for (const fn of [...this.messageSubs]) fn(msg);
  }

  /** Watch bookkeeping messages: dropped when closed (re-sent on open from the watch map). */
  private sendNow(msg: WsClientMessage): void {
    if (this.socket?.readyState === OPEN) this.raw(msg);
  }

  private raw(msg: WsClientMessage): void {
    try {
      this.socket?.send(JSON.stringify(msg));
    } catch {
      /* closing; onclose reconnects */
    }
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of [...this.statusSubs]) fn(s);
  }
}
