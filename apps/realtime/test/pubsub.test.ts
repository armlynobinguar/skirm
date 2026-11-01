// The pub/sub seam v2 spectating relays through: one backend subscription per channel however many
// watchers listen, let go after the last one, and RedisPubSub wired onto the Redis client calls.
import { EventEmitter } from 'node:events';
import { v2MatchChannel, v2MatchLastKey } from '@skirm/server';
import { describe, expect, it } from 'vitest';
import { MemoryPubSub, RedisPubSub } from '../src/pubsub';
import { delay } from './helpers';

const ch = v2MatchChannel('mat_1');

describe('MemoryPubSub refcounting', () => {
  it('subscribes once per channel and unsubscribes after the last listener', async () => {
    const ps = new MemoryPubSub();
    const got: string[] = [];
    const u1 = await ps.subscribe(ch, (p) => got.push(`1:${p}`));
    const u2 = await ps.subscribe(ch, (p) => got.push(`2:${p}`));
    await ps.publish(ch, 'x');
    await delay(1);
    expect(got.sort()).toEqual(['1:x', '2:x']);
    await u1();
    expect(ps.activeChannels()).toEqual([ch]);
    await u2();
    await u2();
    expect(ps.activeChannels()).toEqual([]);
    expect(ps.backendOps).toEqual([`sub ${ch}`, `unsub ${ch}`]);
  });
});

/** The ioredis calls RedisPubSub makes, recorded. */
class FakeRedis extends EventEmitter {
  readonly ops: string[] = [];
  readonly kv = new Map<string, string>();
  async subscribe(c: string) {
    this.ops.push(`subscribe ${c}`);
  }
  async unsubscribe(c: string) {
    this.ops.push(`unsubscribe ${c}`);
  }
  async publish(c: string, p: string) {
    this.ops.push(`publish ${c} ${p}`);
  }
  async get(k: string) {
    return this.kv.get(k) ?? null;
  }
  async set(k: string, v: string, ex: string, ttl: number) {
    this.ops.push(`set ${k} ${ex} ${ttl}`);
    this.kv.set(k, v);
  }
  async quit() {
    this.ops.push('quit');
  }
}

describe('RedisPubSub', () => {
  it('shares one SUBSCRIBE per channel, dispatches messages and keeps a re-subscribed channel', async () => {
    const cmd = new FakeRedis();
    const sub = new FakeRedis();
    const ps = new RedisPubSub(cmd as never, sub as never);
    const got: string[] = [];
    const u1 = await ps.subscribe(ch, (p) => got.push(`1:${p}`));
    const u2 = await ps.subscribe(ch, (p) => got.push(`2:${p}`));
    sub.emit('message', ch, 'f1');
    sub.emit('message', v2MatchChannel('mat_other'), 'nope');
    expect(got.sort()).toEqual(['1:f1', '2:f1']);
    await u1();
    await u2();
    expect(sub.ops).toEqual([`subscribe ${ch}`, `unsubscribe ${ch}`]);
    // Leave and come back before the UNSUBSCRIBE runs: the channel stays subscribed.
    const u3 = await ps.subscribe(ch, () => {});
    const leaving = u3();
    const u4 = await ps.subscribe(ch, (p) => got.push(`4:${p}`));
    await leaving;
    expect(ps.activeChannels()).toEqual([ch]);
    sub.emit('message', ch, 'f2');
    expect(got).toContain('4:f2');
    await u4();
    expect(ps.activeChannels()).toEqual([]);

    await ps.publish(ch, 'p');
    await ps.set(v2MatchLastKey('mat_1'), 'last', 120);
    expect(await ps.get(v2MatchLastKey('mat_1'))).toBe('last');
    expect(cmd.ops).toEqual([`publish ${ch} p`, `set ${v2MatchLastKey('mat_1')} EX 120`]);
    await ps.close();
    expect(cmd.ops.at(-1)).toBe('quit');
    expect(sub.ops.at(-1)).toBe('quit');
  });
});
