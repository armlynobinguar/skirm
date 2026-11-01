// Redis names for spectating a v2 match from any realtime instance. The instance running the match
// publishes every watch-view message (v2_frame, v2_end) on `v2match:<id>` and keeps the latest one
// in `v2match:<id>:last`, so a watcher on another instance gets the board now and every frame after.

export const v2MatchChannel = (matchId: string) => `v2match:${matchId}`;
/** Latest watch-view message of a v2 match (a frame, then its v2_end), read first by a remote watcher. */
export const v2MatchLastKey = (matchId: string) => `v2match:${matchId}:last`;
/** Short TTL: the key outlives its match by at most this long. */
export const V2_MATCH_LAST_TTL_S = 120;

export function parseV2Channel(channel: string): { id: string } | undefined {
  const m = /^v2match:([^:]+)$/.exec(channel);
  return m ? { id: m[1]! } : undefined;
}
