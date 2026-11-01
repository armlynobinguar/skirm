// Latency timing for provider calls. The v2 brain reports usage itself (V2Call, brain.ts).

/** Timer used for latency; performance.now when available. */
export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
