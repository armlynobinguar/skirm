// Test wiring: pglite db, in-memory pub/sub (or real Redis), the greedy v2 brain by default.
import { createRepos, type Repos } from '@skirm/db';
import { createTestDb } from '@skirm/db/testing';
import { createVault, loadConfig, type RegistryJobData } from '@skirm/server';
import type { RealtimeDeps } from '../src/deps';
import { silentLogger } from '../src/deps';
import type { ClientSocket } from '../src/hub';
import type { WsServerMessage } from '../src/protocol';
import { MemoryPubSub, type PubSub } from '../src/pubsub';

export interface TestDeps extends RealtimeDeps {
  repos: Repos;
  registryJobs: RegistryJobData[];
}

export async function makeDeps(over: Partial<RealtimeDeps> = {}): Promise<TestDeps> {
  const config = loadConfig({});
  const db = await createTestDb();
  const registryJobs: RegistryJobData[] = [];
  const pubsub: PubSub = over.pubsub ?? new MemoryPubSub();
  return {
    config,
    repos: createRepos(db),
    vault: createVault(config),
    pubsub,
    registry: { enqueue: async (d) => void registryJobs.push(d) },
    registryJobs,
    queueTiming: { statusEveryMs: 50 },
    pingIntervalMs: 0,
    log: silentLogger,
    ...over,
  } as TestDeps;
}

/** Collects what the hub sends; `next(pred)` waits for a matching message. */
export class Inbox {
  readonly all: WsServerMessage[] = [];
  private waiters: {
    pred: (m: WsServerMessage) => boolean;
    resolve: (m: WsServerMessage) => void;
  }[] = [];
  private seen = 0;

  push(m: WsServerMessage): void {
    this.all.push(m);
    for (const w of [...this.waiters])
      if (w.pred(m)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(m);
      }
  }

  /** First message after the previous `next` result that matches. */
  next<T extends WsServerMessage['type']>(
    type: T,
    pred: (m: Extract<WsServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 10_000,
  ): Promise<Extract<WsServerMessage, { type: T }>> {
    const match = (m: WsServerMessage) =>
      m.type === type && pred(m as Extract<WsServerMessage, { type: T }>);
    for (let i = this.seen; i < this.all.length; i++)
      if (match(this.all[i]!)) {
        this.seen = i + 1;
        return Promise.resolve(this.all[i] as Extract<WsServerMessage, { type: T }>);
      }
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () =>
          reject(
            new Error(
              `timed out waiting for ${type}; got ${this.all.map((m) => m.type).join(',')}`,
            ),
          ),
        timeoutMs,
      );
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(t);
          this.seen = this.all.indexOf(m) + 1;
          resolve(m as Extract<WsServerMessage, { type: T }>);
        },
      });
    });
  }

  ofType<T extends WsServerMessage['type']>(type: T): Extract<WsServerMessage, { type: T }>[] {
    return this.all.filter((m) => m.type === type) as Extract<WsServerMessage, { type: T }>[];
  }
}

export class FakeSocket implements ClientSocket {
  readonly inbox = new Inbox();
  closed?: { code?: number; reason?: string };
  send(data: string): void {
    this.inbox.push(JSON.parse(data) as WsServerMessage);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
}

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
