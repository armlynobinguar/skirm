// Frames of ended v2 matches, kept in Redis for a while so a player can watch the match again at
// another speed (v2_replay → v2_frames). One key per view: each crew's own fogged frames (with its
// own plans) and the whole board for anyone else. Live matches are never served from here.
import type { FrameView, V2Frame } from '@skirm/engine/v2';
import type { PubSub } from '../pubsub';

/** How long frames of an ended match stay (6 hours). */
export const V2_FRAMES_TTL_S = 6 * 3600;

export const v2FramesKey = (matchId: string, view: FrameView) => `v2:match:${matchId}:frames:${view}`;

export interface V2FrameStore {
  put(matchId: string, view: FrameView, frames: readonly V2Frame[]): Promise<void>;
  /** null when nothing is stored (never kept, expired, or not ended yet). */
  get(matchId: string, view: FrameView): Promise<V2Frame[] | null>;
}

/** The store on the instance's Redis command connection (or the in-memory pub/sub in tests). */
export class PubSubV2FrameStore implements V2FrameStore {
  constructor(
    private readonly kv: Pick<PubSub, 'get' | 'set'>,
    private readonly ttlS = V2_FRAMES_TTL_S,
  ) {}

  async put(matchId: string, view: FrameView, frames: readonly V2Frame[]): Promise<void> {
    await this.kv.set(v2FramesKey(matchId, view), JSON.stringify(frames), this.ttlS);
  }

  async get(matchId: string, view: FrameView): Promise<V2Frame[] | null> {
    const raw = await this.kv.get(v2FramesKey(matchId, view));
    if (!raw) return null;
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? (v as V2Frame[]) : null;
    } catch {
      return null;
    }
  }
}
