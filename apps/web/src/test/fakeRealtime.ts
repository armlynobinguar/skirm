// Fake Realtime for component tests: records what the UI watched and sent, and lets the test push
// server messages.
//
//   const rt = new FakeRealtime();
//   renderWithProviders(<V2MatchScreen matchId="mat_1" />, { realtime: rt });
//   act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_1', frame: v2FrameFixture() }));
//   act(() => rt.setStatus('reconnecting'));
//   expect(rt.v2Watchers('mat_1')).toBe(1);                           // V2MatchScreen spectating
import type { ConnectionStatus, OutgoingMessage, Realtime } from '@/lib/realtime/client';
import type { WsServerMessage } from '@/lib/realtime/protocol';

export class FakeRealtime implements Realtime {
  status: ConnectionStatus = 'open';
  /** Messages the UI sent with send() (v2_queue, v2_accept, v2_lock_in, …). */
  readonly sent: OutgoingMessage[] = [];
  connects = 0;
  private readonly statusSubs = new Set<(s: ConnectionStatus) => void>();
  private readonly messageSubs = new Set<(m: WsServerMessage) => void>();
  private readonly v2Watches = new Map<string, number>();

  getStatus() {
    return this.status;
  }
  onStatus(fn: (s: ConnectionStatus) => void) {
    this.statusSubs.add(fn);
    return () => void this.statusSubs.delete(fn);
  }
  onMessage(fn: (m: WsServerMessage) => void) {
    this.messageSubs.add(fn);
    return () => void this.messageSubs.delete(fn);
  }
  watchV2(matchId: string) {
    this.v2Watches.set(matchId, (this.v2Watches.get(matchId) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (this.v2Watches.get(matchId) ?? 1) - 1;
      if (n > 0) this.v2Watches.set(matchId, n);
      else this.v2Watches.delete(matchId);
    };
  }
  send(msg: OutgoingMessage) {
    this.sent.push(msg);
  }
  connect() {
    this.connects++;
  }
  close() {
    this.setStatus('closed');
  }

  // ---------- test controls ----------

  /** Delivers a server message the way RealtimeClient does (to every onMessage listener). */
  emit(msg: WsServerMessage): void {
    for (const fn of [...this.messageSubs]) fn(msg);
  }

  setStatus(s: ConnectionStatus): void {
    this.status = s;
    for (const fn of [...this.statusSubs]) fn(s);
  }

  /** Live watchV2 calls on a v2 match (not yet disposed). */
  v2Watchers(matchId: string): number {
    return this.v2Watches.get(matchId) ?? 0;
  }

  /** What the UI sent of one type, e.g. `rt.sentOf('v2_lock_in')[0]?.crew`. */
  sentOf<T extends OutgoingMessage['type']>(type: T): Extract<OutgoingMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<OutgoingMessage, { type: T }> => m.type === type);
  }
}
