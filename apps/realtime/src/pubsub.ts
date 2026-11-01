// Pub/sub seam: one shared Redis subscriber connection for the whole instance, with refcounted
// channel subscriptions (SUBSCRIBE on the first listener, UNSUBSCRIBE after the last one leaves),
// plus a command connection for PUBLISH and GET of `v2match:<id>:last`. MemoryPubSub is the same
// contract in memory, for unit tests.
import { createRedis } from '@skirm/server';

type Redis = ReturnType<typeof createRedis>;

export type Listener = (payload: string) => void;
export type Unsubscribe = () => Promise<void>;

export interface PubSub {
  publish(channel: string, payload: string): Promise<void>;
  get(key: string): Promise<string | null>;
  /** SET key value EX ttlS (e.g. `v2match:<id>:last`). */
  set(key: string, value: string, ttlS: number): Promise<void>;
  /** Resolves once the channel is live (messages published after this are delivered). */
  subscribe(channel: string, listener: Listener): Promise<Unsubscribe>;
  /** Channels with at least one listener (for tests and metrics). */
  activeChannels(): string[];
  close(): Promise<void>;
}

interface Backend {
  sub(channel: string): Promise<void>;
  unsub(channel: string): Promise<void>;
}

/** Listener sets per channel; backend (un)subscribe calls are serialised per channel. */
class Channels {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly backend: Backend) {}

  private enqueue(channel: string, op: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(channel) ?? Promise.resolve();
    const next = prev.then(op, op);
    const settled = next.catch(() => undefined);
    this.chains.set(channel, settled);
    void settled.then(() => {
      if (this.chains.get(channel) === settled) this.chains.delete(channel);
    });
    return next;
  }

  async add(channel: string, l: Listener): Promise<Unsubscribe> {
    let set = this.listeners.get(channel);
    const first = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(l);
    if (first) {
      try {
        await this.enqueue(channel, () => this.backend.sub(channel));
      } catch (err) {
        set.delete(l);
        if (set.size === 0 && this.listeners.get(channel) === set) this.listeners.delete(channel);
        throw err;
      }
    } else {
      // Wait for an in-flight SUBSCRIBE so the caller's "live from here" guarantee holds.
      await (this.chains.get(channel) ?? Promise.resolve());
    }
    let done = false;
    return async () => {
      if (done) return;
      done = true;
      const cur = this.listeners.get(channel);
      if (!cur || !cur.delete(l)) return;
      if (cur.size > 0) return;
      this.listeners.delete(channel);
      await this.enqueue(channel, async () => {
        // Someone subscribed again while we waited: keep the server-side subscription.
        if (this.listeners.has(channel)) return;
        await this.backend.unsub(channel);
      }).catch(() => undefined);
    };
  }

  dispatch(channel: string, payload: string): void {
    const set = this.listeners.get(channel);
    if (!set) return;
    for (const l of [...set]) {
      try {
        l(payload);
      } catch {
        // A broken listener must not stop delivery to the others.
      }
    }
  }

  channels(): string[] {
    return [...this.listeners.keys()];
  }
}

export class MemoryPubSub implements PubSub {
  readonly kv = new Map<string, string>();
  /** Backend subscribe/unsubscribe calls, in order (tests check the refcounting). */
  readonly backendOps: string[] = [];
  readonly published: { channel: string; payload: string }[] = [];
  private readonly subscribed = new Set<string>();
  private readonly ch = new Channels({
    sub: async (c) => {
      this.backendOps.push(`sub ${c}`);
      this.subscribed.add(c);
    },
    unsub: async (c) => {
      this.backendOps.push(`unsub ${c}`);
      this.subscribed.delete(c);
    },
  });

  async publish(channel: string, payload: string): Promise<void> {
    this.published.push({ channel, payload });
    if (this.subscribed.has(channel)) queueMicrotask(() => this.ch.dispatch(channel, payload));
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string, _ttlS: number): Promise<void> {
    this.kv.set(key, value);
  }

  subscribe(channel: string, listener: Listener): Promise<Unsubscribe> {
    return this.ch.add(channel, listener);
  }

  activeChannels(): string[] {
    return this.ch.channels();
  }

  async close(): Promise<void> {}
}

export class RedisPubSub implements PubSub {
  private readonly ch: Channels;

  constructor(
    private readonly cmd: Redis,
    private readonly sub: Redis,
    private readonly ownsClients = true,
  ) {
    this.ch = new Channels({
      sub: async (c) => {
        await this.sub.subscribe(c);
      },
      unsub: async (c) => {
        await this.sub.unsubscribe(c);
      },
    });
    this.sub.on('message', (channel: string, payload: string) =>
      this.ch.dispatch(channel, payload),
    );
  }

  static fromUrl(url: string): RedisPubSub {
    return new RedisPubSub(createRedis(url), createRedis(url));
  }

  async publish(channel: string, payload: string): Promise<void> {
    await this.cmd.publish(channel, payload);
  }

  get(key: string): Promise<string | null> {
    return this.cmd.get(key);
  }

  async set(key: string, value: string, ttlS: number): Promise<void> {
    await this.cmd.set(key, value, 'EX', ttlS);
  }

  subscribe(channel: string, listener: Listener): Promise<Unsubscribe> {
    return this.ch.add(channel, listener);
  }

  activeChannels(): string[] {
    return this.ch.channels();
  }

  async close(): Promise<void> {
    if (!this.ownsClients) return;
    await Promise.all(
      [this.sub, this.cmd].map((c) =>
        c.quit().then(
          () => undefined,
          () => c.disconnect(),
        ),
      ),
    );
  }
}
