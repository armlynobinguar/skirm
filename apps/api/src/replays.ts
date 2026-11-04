// Replays for the public: the stored whole-board frames of an ended match (read from where realtime
// keeps them), its highlights and caster lines (worked out once and cached in replay_casts).
//
// Only the watch view is ever read here, and every frame is stripped again of anything a crew
// alone may see (plans, planner reasons, inner voice, live commands, the playbook name), so a share link can never
// show more than a spectator saw. Frames live 6 h in Redis today (realtime replay.ts); the reader is
// an interface so permanent storage can replace it without touching the routes.
import type { ReplayCastRow, ReplayHighlightRecord, Repos, V2MatchRow } from '@skirm/db';
import { createModelCaster, createTemplateCaster, llmSettings, v2BrainKind, type Caster, type LlmEnv } from '@skirm/decision-engine/v2';
import { PRACTICE_BOT_HANDLE } from './views';
import { detectHighlights, mapV2, type V2Frame } from '@skirm/engine/v2';

/** The Redis key realtime stores a view's frames under (apps/realtime/src/v2/replay.ts v2FramesKey). */
export const watchFramesKey = (matchId: string) => `v2:match:${matchId}:frames:watch`;

export interface ReplayFrameReader {
  /** The whole-board frames of an ended match; null when none are kept (expired or never stored). */
  watchFrames(matchId: string): Promise<V2Frame[] | null>;
}

/** Reads realtime's frames from Redis; null when Redis is slow or down. */
export class RedisReplayFrames implements ReplayFrameReader {
  constructor(
    private readonly redis: { get(key: string): Promise<string | null> },
    private readonly timeoutMs = 1500,
  ) {}

  async watchFrames(matchId: string): Promise<V2Frame[] | null> {
    try {
      const raw = await Promise.race([
        this.redis.get(watchFramesKey(matchId)),
        new Promise<null>((r) => setTimeout(() => r(null), this.timeoutMs).unref()),
      ]);
      if (!raw) return null;
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? (v as V2Frame[]) : null;
    } catch {
      return null;
    }
  }
}

/**
 * The caster the api runs: the configured model (LLM_BASE_URL, LLM_MODEL; v2BrainKind decides) when
 * the environment selects the model brain, never with V2_BRAIN=greedy (which promises no model
 * calls); else the offline template caster. Its spend is
 * platform spend, reported to `onCost` (the daily cost total), never charged to a player.
 */
export function createApiCaster(env: LlmEnv, onCost?: (usd: number) => void): Caster {
  if (v2BrainKind(env) !== 'model') return createTemplateCaster();
  const s = llmSettings(env);
  return createModelCaster({ apiKey: s.apiKey, baseUrl: s.baseUrl, model: s.model, prices: s.prices, onUsage: (c) => onCost?.(c.costUsd) });
}

/** Frames held in memory (tests, local runs without Redis). */
export class MemoryReplayFrames implements ReplayFrameReader {
  readonly frames = new Map<string, V2Frame[]>();
  async watchFrames(matchId: string): Promise<V2Frame[] | null> {
    return this.frames.get(matchId) ?? null;
  }
}

/** A frame as anyone may see it: the watch view, with every crew-only field dropped. */
export function publicFrame(f: V2Frame): V2Frame {
  const { commands: _commands, playbook: _playbook, ...rest } = f;
  return {
    ...rest,
    view: 'watch',
    agents: f.agents.map(({ plan: _p, planWhy: _w, thought: _t, planHidden: _h, ...a }) => a),
  };
}

export interface ReplayHighlightsView {
  highlights: ReplayHighlightRecord[];
  caster: 'model' | 'template' | null;
  /** Whether the match's frames are still stored (the replay can be played). */
  framesKept: boolean;
}

/** The crew names a highlight uses: the players' handles (the practice bot as itself). */
export async function crewNames(repos: Repos, m: V2MatchRow): Promise<Record<'A' | 'B', string>> {
  const [a, b] = await Promise.all([repos.accounts.get(m.teamAAccountId), repos.accounts.get(m.teamBAccountId)]);
  return { A: a?.handle ?? 'Crew A', B: m.practice ? PRACTICE_BOT_HANDLE : (b?.handle ?? 'Crew B') };
}

export class ReplayService {
  private readonly inflight = new Map<string, Promise<ReplayCastRow | null>>();

  constructor(
    private readonly repos: Repos,
    private readonly frames: ReplayFrameReader | undefined,
    private readonly caster: Caster = createTemplateCaster(),
  ) {}

  /** The public frames of an ended match, or null. */
  async framesOf(matchId: string): Promise<V2Frame[] | null> {
    const fs = await this.frames?.watchFrames(matchId);
    if (!fs) return null;
    return fs.filter((f) => f.view === 'watch').map(publicFrame);
  }

  /**
   * The match's highlights with caster lines: from the cache, else detected from its frames and
   * cast once (concurrent asks share the one cast). Empty, uncached, when no frames are kept.
   */
  async highlights(m: V2MatchRow, frames?: V2Frame[] | null): Promise<ReplayHighlightsView> {
    const cached = await this.repos.replays.getCast(m.id);
    if (cached) return { highlights: cached.highlights, caster: cached.caster, framesKept: frames !== undefined ? !!frames : true };
    let p = this.inflight.get(m.id);
    if (!p) {
      p = this.cast(m, frames).finally(() => this.inflight.delete(m.id));
      this.inflight.set(m.id, p);
    }
    const row = await p;
    return row ? { highlights: row.highlights, caster: row.caster, framesKept: true } : { highlights: [], caster: null, framesKept: false };
  }

  private async cast(m: V2MatchRow, given?: V2Frame[] | null): Promise<ReplayCastRow | null> {
    const frames = given !== undefined ? given : await this.framesOf(m.id);
    if (!frames?.length) return null;
    const crews = await crewNames(this.repos, m);
    const found = detectHighlights(frames, { crews });
    let cast = { lines: {} as Record<string, string>, caster: 'template' as 'model' | 'template', model: null as string | null, costUsd: 0 };
    if (found.length) {
      try {
        cast = await this.caster.cast({ mapName: mapV2(m.mapId)?.name ?? m.mapId, crews, highlights: found });
      } catch {
        cast = await createTemplateCaster().cast({ mapName: m.mapId, crews, highlights: found });
      }
    }
    const fallback = found.length ? (await createTemplateCaster().cast({ mapName: m.mapId, crews, highlights: found })).lines : {};
    const highlights: ReplayHighlightRecord[] = found.map((h) => ({ ...h, line: cast.lines[h.id] ?? fallback[h.id] ?? h.title }));
    return this.repos.replays.putCast({ matchId: m.id, highlights, caster: cast.caster, model: cast.model, costUsd: cast.costUsd });
  }
}
