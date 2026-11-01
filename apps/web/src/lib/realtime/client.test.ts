import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCredentialsStore } from '../auth/credentials';
import { RealtimeClient, type SocketLike } from './client';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // test controls
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
  receive(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

function setup(handle: string | null = 'ada') {
  const sockets: FakeSocket[] = [];
  const credentials = createCredentialsStore({ storage: null, initial: handle ? { kind: 'dev', handle } : null });
  const rt = new RealtimeClient({
    url: 'ws://rt.test/ws',
    credentials,
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    backoff: { baseMs: 100, maxMs: 1000 },
    random: () => 1,
  });
  return { rt, sockets, credentials, last: () => sockets[sockets.length - 1]! };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('RealtimeClient', () => {
  it('privy: authenticates with the access token, and with the new one after a refresh', () => {
    const { rt, credentials, last } = setup(null);
    credentials.set({ kind: 'privy', token: 'jwt_1' });
    rt.watchV2('mat_1');
    last().open();
    expect(last().sent[0]).toEqual({ type: 'auth', token: 'jwt_1' });
    const first = last();
    credentials.set({ kind: 'privy', token: 'jwt_2' }); // refreshed before expiry
    expect(first.closed).toBe(true);
    last().open();
    expect(last().sent.slice(0, 2)).toEqual([{ type: 'auth', token: 'jwt_2' }, { type: 'v2_watch', matchId: 'mat_1' }]);
  });

  it('opens lazily and authenticates before rewatching', () => {
    const { rt, sockets, last } = setup();
    rt.onMessage(() => {});
    expect(sockets).toHaveLength(0);
    rt.watchV2('mat_1');
    expect(sockets).toHaveLength(1);
    last().open();
    expect(last().sent).toEqual([
      { type: 'auth', devUser: 'ada' },
      { type: 'v2_watch', matchId: 'mat_1' },
    ]);
    expect(rt.getStatus()).toBe('open');
  });

  it('skips auth when signed out', () => {
    const { rt, last } = setup(null);
    rt.watchV2('mat_1');
    last().open();
    expect(last().sent).toEqual([{ type: 'v2_watch', matchId: 'mat_1' }]);
  });

  it('reconnects with backoff, then re-auths and re-sends live watches only', () => {
    const { rt, sockets, last } = setup();
    const statuses: string[] = [];
    rt.onStatus((s) => statuses.push(s));
    rt.watchV2('mat_1');
    const off = rt.watchV2('mat_2');
    last().open();
    off();
    last().drop();
    expect(rt.getStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(99);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().drop(); // second failure: waits 200 ms
    vi.advanceTimersByTime(199);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    last().open();
    expect(last().sent).toEqual([
      { type: 'auth', devUser: 'ada' },
      { type: 'v2_watch', matchId: 'mat_1' },
    ]);
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  });

  it('queues outgoing messages until the socket is open', () => {
    const { rt, last } = setup();
    rt.send({ type: 'v2_cancel_queue' });
    last().open();
    expect(last().sent).toEqual([{ type: 'auth', devUser: 'ada' }, { type: 'v2_cancel_queue' }]);
  });

  it('starts a new connection when the credentials change', () => {
    const { rt, sockets, credentials, last } = setup();
    rt.watchV2('mat_1');
    last().open();
    credentials.set({ kind: 'dev', handle: 'bo' });
    expect(sockets[0]!.closed).toBe(true);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().sent[0]).toEqual({ type: 'auth', devUser: 'bo' });
  });

  it('does not reconnect after close()', () => {
    const { rt, sockets, last } = setup();
    rt.watchV2('mat_1');
    last().open();
    rt.close();
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
    expect(rt.getStatus()).toBe('closed');
  });

  it('passes every message, errors included, to onMessage and ignores what is not JSON', () => {
    const { rt, last } = setup();
    const all = vi.fn();
    rt.onMessage(all);
    rt.connect();
    last().open();
    last().receive({ type: 'queue_status', searchingMs: 1000, eloRange: 50 });
    last().receive({ type: 'error', code: 'not_found', message: 'match not found' });
    last().onmessage?.({ data: 'not json' });
    expect(all.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(['queue_status', 'error']);
  });

  it('v2 watches: v2_watch once per match, re-sent after a reconnect, v2_unwatch after the last dispose', () => {
    const { rt, last } = setup();
    const all = vi.fn();
    rt.onMessage(all);
    const offA = rt.watchV2('mat_v2');
    last().open();
    expect(last().sent).toEqual([
      { type: 'auth', devUser: 'ada' },
      { type: 'v2_watch', matchId: 'mat_v2' },
    ]);
    const offB = rt.watchV2('mat_v2');
    expect(last().sent).toHaveLength(2);
    // Frames reach onMessage (the v2 store), like every other v2 message.
    last().receive({ type: 'v2_frame', matchId: 'mat_v2', frame: { tick: 3 } });
    expect(all).toHaveBeenCalledWith({ type: 'v2_frame', matchId: 'mat_v2', frame: { tick: 3 } });

    last().drop();
    vi.advanceTimersByTime(100);
    last().open();
    expect(last().sent).toEqual([
      { type: 'auth', devUser: 'ada' },
      { type: 'v2_watch', matchId: 'mat_v2' },
    ]);
    offA();
    offA(); // a second call is a no-op
    expect(last().sent).toHaveLength(2);
    offB();
    expect(last().sent.at(-1)).toEqual({ type: 'v2_unwatch', matchId: 'mat_v2' });
  });

  it('forgets a v2 watch at v2_end: nothing to unwatch, nothing re-sent', () => {
    const { rt, last } = setup();
    const off = rt.watchV2('mat_v2');
    last().open();
    last().receive({ type: 'v2_end', matchId: 'mat_v2', result: null, reason: 'aborted', logHash: null });
    off();
    expect(last().sent.map((m) => (m as { type: string }).type)).toEqual(['auth', 'v2_watch']);
    last().drop();
    vi.advanceTimersByTime(100);
    last().open();
    expect(last().sent).toEqual([{ type: 'auth', devUser: 'ada' }]);
  });
});
