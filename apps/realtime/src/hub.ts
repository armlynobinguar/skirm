// Connection hub: per-socket state, sign-in and message handling. Every v2_* message goes to the
// V2Hub (matchmaking, the matches this instance holds, watching and replay). Transport-free (sockets
// are `ClientSocket`), so unit tests drive it directly and server.ts plugs in `ws`.
import { AuthError, verifyCredentials } from '@skirm/server';
import { createGreedyBrain } from '@skirm/decision-engine/v2';
import { consoleLogger, type Logger, type RealtimeDeps } from './deps';
import { V2Hub, V2HubError } from './v2/hub';
import { DEFAULT_V2_TIMING } from './v2/match';
import { PubSubV2FrameStore } from './v2/replay';
import {
  errorMessage,
  parseClientMessage,
  type ErrorCode,
  type WsClientMessage,
  type WsServerMessage,
} from './protocol';
import type { Unsubscribe } from './pubsub';
import { DEFAULT_QUEUE_TIMING, realScheduler, type QueueTiming, type Scheduler } from './timing';

export interface ClientSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ClientUser {
  accountId: string;
  handle: string;
}

export interface Client {
  readonly id: number;
  readonly socket: ClientSocket;
  user?: ClientUser;
  /** v2 matches this socket watches. */
  readonly matches: Map<string, Unsubscribe>;
  closed: boolean;
  chain: Promise<void>;
  /** Messages in the current rate window (MESSAGES_PER_WINDOW per WINDOW_MS). */
  window?: { start: number; n: number };
}

/** A client may send this many messages per window; more are refused (`rate_limited`) and dropped. */
export const MESSAGES_PER_WINDOW = 30;
export const MESSAGE_WINDOW_MS = 10_000;

class HubError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Per-socket cap, so one client cannot hold an unbounded number of Redis subscriptions. */
export const MAX_MATCH_WATCHES = 8;
/** How often live match rows that no instance holds any more are voided. */
const ORPHAN_SWEEP_EVERY_MS = 60_000;

export class RealtimeHub {
  private nextId = 1;
  readonly clients = new Set<Client>();
  private readonly byAccount = new Map<string, Set<Client>>();
  readonly v2: V2Hub;
  private readonly scheduler: Scheduler;
  private readonly log: Logger;
  private closing = false;
  private sweepTimer: unknown;

  constructor(private readonly deps: RealtimeDeps) {
    this.scheduler = deps.scheduler ?? realScheduler;
    const queueTiming: QueueTiming = { ...DEFAULT_QUEUE_TIMING, ...deps.queueTiming };
    this.log = deps.log ?? consoleLogger;
    this.v2 = new V2Hub({
      repos: deps.repos,
      vault: deps.vault,
      brain: deps.v2Brain ?? createGreedyBrain(),
      scheduler: this.scheduler,
      queueTiming,
      ...(deps.v2Timing ? { timing: deps.v2Timing } : {}),
      ...(deps.v2Maps ? { maps: deps.v2Maps } : {}),
      ...(deps.v2PickMap ? { pickMap: deps.v2PickMap } : {}),
      send: (accountId, msg) => this.sendAccount(accountId, msg),
      registry: deps.registry,
      frames: new PubSubV2FrameStore(deps.pubsub),
      pubsub: deps.pubsub,
      log: this.log,
    });
    this.scheduleSweep(0);
  }

  // ---------- Orphaned matches ----------

  private scheduleSweep(ms: number): void {
    if (this.closing) return;
    this.sweepTimer = this.scheduler.setTimeout(() => {
      void this.sweepOrphans()
        .catch((err: unknown) => this.log.warn(`orphan sweep failed: ${(err as Error).message}`))
        .finally(() => this.scheduleSweep(ORPHAN_SWEEP_EVERY_MS));
    }, ms);
  }

  /**
   * A match lives only in the memory of the instance that runs it. When that instance dies without
   * a clean shutdown (crash, SIGKILL after the grace period), its row stays `live` and its holds stay
   * held. Any live row older than the longest possible match (accept + lock-in + every tick + a
   * margin for settlement) that this instance does not hold is voided and its holds released.
   */
  sweepOrphans(olderThanMs?: number): Promise<string[]> {
    const t = { ...DEFAULT_V2_TIMING, ...this.deps.v2Timing };
    return this.v2.sweepOrphans(olderThanMs ?? t.acceptMs + t.lockMs + 150 * t.tickMs + 120_000);
  }

  // ---------- Connections ----------

  connect(socket: ClientSocket): Client {
    const c: Client = {
      id: this.nextId++,
      socket,
      matches: new Map(),
      closed: false,
      chain: Promise.resolve(),
    };
    this.clients.add(c);
    if (this.closing) socket.close(1001, 'server shutting down');
    return c;
  }

  /**
   * Queues a raw frame for this client; messages of one client are handled in order. A client over
   * MESSAGES_PER_WINDOW in MESSAGE_WINDOW_MS is told so and the message is dropped before it queues,
   * so a flood can never build a backlog.
   */
  message(c: Client, raw: unknown): Promise<void> {
    const now = Date.now();
    if (!c.window || now - c.window.start >= MESSAGE_WINDOW_MS) c.window = { start: now, n: 0 };
    if (++c.window.n > MESSAGES_PER_WINDOW) {
      if (c.window.n === MESSAGES_PER_WINDOW + 1) this.send(c, errorMessage('rate_limited', 'too many messages, slow down'));
      return c.chain;
    }
    const run = async () => {
      if (c.closed) return;
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) return this.send(c, errorMessage(parsed.code, parsed.message));
      try {
        await this.handle(c, parsed.msg);
      } catch (err) {
        if (err instanceof HubError) this.send(c, errorMessage(err.code, err.message));
        else if (err instanceof V2HubError) this.send(c, errorMessage(err.code, err.message));
        else {
          this.log.error(`client ${c.id}: ${(err as Error).stack ?? String(err)}`);
          this.deps.report?.(err, `client message ${parsed.msg.type}`);
          this.send(c, errorMessage('internal', 'something went wrong'));
        }
      }
    };
    c.chain = c.chain.then(run, run);
    return c.chain;
  }

  disconnect(c: Client): Promise<void> {
    if (c.closed) return c.chain;
    c.closed = true;
    this.clients.delete(c);
    const cleanup = async () => {
      const subs = [...c.matches.values()];
      c.matches.clear();
      await Promise.all(subs.map((u) => u().catch(() => undefined)));
      if (c.user) {
        const set = this.byAccount.get(c.user.accountId);
        set?.delete(c);
        if (set && set.size === 0) {
          this.byAccount.delete(c.user.accountId);
          // Nobody left to play the match: stop searching. A found match plays on and the player
          // can reconnect to it.
          this.v2.dropSearch(c.user.accountId);
        }
      }
    };
    c.chain = c.chain.then(cleanup, cleanup);
    return c.chain;
  }

  send(c: Client, msg: WsServerMessage): void {
    if (c.closed) return;
    try {
      c.socket.send(JSON.stringify(msg));
    } catch {
      // Socket already gone; disconnect() cleans up.
    }
  }

  private sendAccount(accountId: string, msg: WsServerMessage): void {
    for (const c of this.byAccount.get(accountId) ?? []) this.send(c, msg);
  }

  // ---------- Messages ----------

  private async handle(c: Client, msg: WsClientMessage): Promise<void> {
    switch (msg.type) {
      case 'auth':
        return this.auth(c, msg);
      case 'v2_queue': {
        const opts = {
          ...(msg.mapId !== undefined ? { mapId: msg.mapId } : {}),
          ...(msg.difficulty !== undefined ? { difficulty: msg.difficulty } : {}),
        };
        // The parser already refused a ranked practice (practice_unranked).
        if (msg.opponent === 'bot') return this.v2.practice(this.requireUser(c), msg.crew, opts);
        return this.v2.queue(this.requireUser(c), msg.crew, msg.ranked, opts);
      }
      case 'v2_cancel_queue':
        return this.v2.cancel(this.requireUser(c).accountId);
      case 'v2_accept':
        return this.v2.accept(this.requireUser(c).accountId, msg.matchId);
      case 'v2_decline':
        return this.v2.decline(this.requireUser(c).accountId, msg.matchId);
      case 'v2_lock_in':
        return this.v2.lockIn(this.requireUser(c).accountId, msg.matchId, msg.tiers, msg.crew);
      case 'v2_command': {
        const r = this.v2.command(this.requireUser(c).accountId, msg.matchId, { agentId: msg.agentId, preset: msg.preset, text: msg.text });
        this.send(c, { type: 'v2_command_ok', matchId: msg.matchId, tick: r.tick, left: r.left });
        return;
      }
      case 'v2_watch':
        return this.watch(c, msg.matchId);
      case 'v2_unwatch': {
        const u = c.matches.get(msg.matchId);
        c.matches.delete(msg.matchId);
        await u?.();
        return;
      }
      case 'v2_replay': {
        const frames = await this.v2.replay(c.user?.accountId ?? null, msg.matchId);
        this.send(c, { type: 'v2_frames', matchId: msg.matchId, frames });
        return;
      }
    }
  }

  /** Spectating needs no sign-in; the watch is released on v2_end, v2_unwatch or disconnect. */
  private async watch(c: Client, matchId: string): Promise<void> {
    if (c.matches.has(matchId)) return;
    if (c.matches.size >= MAX_MATCH_WATCHES)
      throw new HubError('too_many_subscriptions', `at most ${MAX_MATCH_WATCHES} matches at once`);
    // An ended match answers with its v2_end inside watch(), before the slot is taken.
    let ended = false;
    const unsub = await this.v2.watch(matchId, (m) => {
      this.send(c, m);
      if (m.type === 'v2_end') {
        ended = true;
        const u = c.matches.get(matchId);
        c.matches.delete(matchId);
        void u?.();
      }
    });
    if (c.closed || ended || c.matches.has(matchId)) return void (await unsub());
    c.matches.set(matchId, unsub);
  }

  private async auth(c: Client, msg: Extract<WsClientMessage, { type: 'auth' }>): Promise<void> {
    if (c.user) throw new HubError('already_authenticated', 'this connection is already signed in');
    let user;
    try {
      user = await verifyCredentials(this.deps.config, { token: msg.token, devUser: msg.devUser });
    } catch (err) {
      if (err instanceof AuthError) throw new HubError('auth_failed', err.message);
      throw err;
    }
    const { account } = await this.deps.repos.accounts.getOrCreate(user, this.deps.vault);
    if (c.closed) return;
    c.user = { accountId: account.id, handle: account.handle };
    let set = this.byAccount.get(account.id);
    if (!set) this.byAccount.set(account.id, (set = new Set()));
    set.add(c);
    // Reconnect during a match: tell the player where it stands.
    this.v2.resume(account.id, (m) => this.send(c, m));
  }

  private requireUser(c: Client): ClientUser {
    if (!c.user) throw new HubError('unauthenticated', 'send auth first');
    return c.user;
  }

  // ---------- Shutdown ----------

  /** Stops matchmaking, voids live matches (credits returned) and closes every socket. */
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.sweepTimer !== undefined) this.scheduler.clearTimeout(this.sweepTimer);
    await this.v2.close();
    for (const c of [...this.clients]) {
      try {
        c.socket.close(1001, 'server shutting down');
      } catch {
        // ignore
      }
      await this.disconnect(c);
    }
  }
}
