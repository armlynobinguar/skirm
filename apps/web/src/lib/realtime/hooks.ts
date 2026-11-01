'use client';
// React hooks over the shared Realtime client (one WebSocket per tab).
//
//   useRealtimeMessage((m) => { if (m.type === 'v2_found') … }); // S11 queue
//   const status = useRealtimeStatus();                          // "Reconnecting..." banners
//
// v2 match state (frames, phases, the end) lives in the tab's v2 store (features/v2/v2Store).
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useRealtime } from '../services';
import type { ConnectionStatus } from './client';
import type { WsServerMessage } from './protocol';

export function useRealtimeStatus(): ConnectionStatus {
  const rt = useRealtime();
  return useSyncExternalStore(
    (fn) => rt.onStatus(fn),
    () => rt.getStatus(),
    () => 'idle',
  );
}

/** Calls `handler` for every server message while mounted (opens the socket). */
export function useRealtimeMessage(handler: (m: WsServerMessage) => void, enabled = true): void {
  const rt = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const off = rt.onMessage((m) => ref.current(m));
    rt.connect();
    return off;
  }, [rt, enabled]);
}
