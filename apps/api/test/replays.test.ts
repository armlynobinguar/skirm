import type { Caster } from '@skirm/decision-engine/v2';
import type { FrameAgent, MatchEvent, V2Frame } from '@skirm/engine/v2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryReplayFrames, createApiCaster, publicFrame, watchFramesKey } from '../src/replays';
import { setup, type Harness, type UserClient } from './helpers';

const SECRET = 'SECRET-PLAN-55: hide by the left sluice';

function agents(): FrameAgent[] {
  return [
    { id: 'rook', name: 'Rook', team: 'A', role: 'Builder', x: 1, y: 1, items: [], delivered: 0, down: false, out: false, tier: 'standard', plan: SECRET, planWhy: SECRET, thought: SECRET },
    { id: 'wren', name: 'Wren', team: 'B', role: 'Digger', x: 20, y: 1, items: [], delivered: 0, down: false, out: false, tier: 'standard', planHidden: true },
  ];
}

/** 30 watch frames: ana leads 2–0, ben comes back to win 3–2 on the goal at tick 30. */
function matchFrames(): V2Frame[] {
  const fs: V2Frame[] = [];
  for (let t = 1; t <= 30; t++) {
    const s = { A: t >= 8 ? 2 : t >= 5 ? 1 : 0, B: t >= 30 ? 3 : t >= 25 ? 2 : t >= 20 ? 1 : 0 };
    const ev: MatchEvent[] = [];
    if (t === 5 || t === 8) ev.push({ kind: 'delivered', agent: 'rook', team: 'A', count: 1, score: s.A });
    if (t === 20 || t === 25 || t === 30) ev.push({ kind: 'delivered', agent: 'wren', team: 'B', count: 1, score: s.B });
    fs.push({
      view: 'watch',
      mapId: 'copper-hollow',
      tick: t,
      limit: 150,
      rows: [],
      agents: agents(),
      score: s,
      goal: 3,
      holdTicks: { A: 0, B: 0 },
      blocks: { A: 0, B: 0 },
      events: ev,
      comms: [],
      result: t === 30 ? { winner: 'B', reason: 'goal', decidedBy: 'goal', score: { A: 2, B: 3 }, ticks: 30 } : null,
      commands: { left: 2, log: [{ tick: 3, agents: ['rook'], preset: 'regroup', text: SECRET }] } as unknown as V2Frame['commands'],
    });
  }
  return fs;
}

describe('shareable replays and highlights', () => {
  let h: Harness;
  let frames: MemoryReplayFrames;
  let cast: ReturnType<typeof vi.fn>;
  let ana: UserClient;
  let ben: UserClient;
  let cat: UserClient;
  let matchId: string;

  beforeEach(async () => {
    frames = new MemoryReplayFrames();
    cast = vi.fn(async (input: Parameters<Caster['cast']>[0]) => ({
      lines: Object.fromEntries(input.highlights.map((x) => [x.id, `CAST ${x.title}`])),
      caster: 'model' as const,
      model: 'anthropic/claude-haiku-5.5',
      costUsd: 0.0002,
    }));
    h = await setup({ replayFrames: frames, caster: { kind: 'model', cast } });
    ana = await h.as('ana');
    ben = await h.as('ben');
    cat = await h.as('cat');
    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId });
    await h.repos.v2Matches.finish(m.id, { winner: 'B', reason: 'goal', decidedBy: 'goal', score: { A: 2, B: 3 }, ticks: 30 });
    matchId = m.id;
    frames.frames.set(matchId, matchFrames());
  });
  afterEach(() => h.close());

  it('reads the key realtime writes the watch frames under', () => {
    expect(watchFramesKey('mat_1')).toBe('v2:match:mat_1:frames:watch');
  });

  it('strips everything crew-only from a public frame', () => {
    const f = publicFrame(matchFrames()[0]!);
    expect(JSON.stringify(f)).not.toContain('SECRET');
    expect(f).not.toHaveProperty('commands');
    expect(f.agents[1]).not.toHaveProperty('planHidden');
  });

  it('serves highlights with caster lines, cast once and cached', async () => {
    const r1 = await h.http().get(`/v2/matches/${matchId}/highlights`).expect(200);
    expect(r1.body.caster).toBe('model');
    expect(r1.body.framesKept).toBe(true);
    const ticks = r1.body.highlights.map((x: { tick: number }) => x.tick);
    expect(ticks).toEqual([5, 8, 20, 25, 30]);
    const goal = r1.body.highlights.at(-1);
    expect(goal).toMatchObject({ kind: 'goal', title: 'Wren delivers the goal', line: 'CAST Wren delivers the goal' });
    expect(goal.facts).toContain('ben');
    await h.http().get(`/v2/matches/${matchId}/highlights`).expect(200);
    expect(cast).toHaveBeenCalledTimes(1);
    expect((await h.repos.replays.getCast(matchId))!.costUsd).toBeCloseTo(0.0002);
    // The cache outlives the frames.
    frames.frames.delete(matchId);
    const r3 = await h.http().get(`/v2/matches/${matchId}/highlights`).expect(200);
    expect(r3.body.highlights).toHaveLength(5);
    expect(r3.body.framesKept).toBe(false);
  });

  it('a live match has no highlights yet; a void one has none', async () => {
    const live = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: cat.accountId });
    await h.http().get(`/v2/matches/${live.id}/highlights`).expect(409);
    await ana.post(`/v2/matches/${live.id}/shares`).expect(409);
  });

  it('only a player can share; the link shows the watch view to anyone, signed in or not', async () => {
    await h.http().post(`/v2/matches/${matchId}/shares`).send({}).expect(401);
    const refused = await cat.post(`/v2/matches/${matchId}/shares`).expect(403);
    expect(refused.body.error.code).toBe('forbidden');

    const made = await ana.post(`/v2/matches/${matchId}/shares`).expect(201);
    const share = made.body.share;
    expect(share.id).toMatch(/^rps_[A-Za-z0-9_-]{16}$/);
    expect(share).toMatchObject({ matchId, clip: null, path: `/replays/${share.id}` });

    for (const who of [h.http(), ana, cat]) {
      const r = await who.get(`/replays/${share.id}`).expect(200);
      expect(r.body.share.by).toBe('ana');
      expect(r.body.match).toMatchObject({ id: matchId, winner: 'B', score: { A: 2, B: 3 } });
      expect(r.body.match).not.toHaveProperty('you');
      expect(r.body.match).not.toHaveProperty('debrief');
      expect(r.body.frames).toHaveLength(30);
      expect(r.body.highlights).toHaveLength(5);
      expect(JSON.stringify(r.body)).not.toContain('SECRET');
    }
    const meta = await h.http().get(`/replays/${share.id}?frames=0`).expect(200);
    expect(meta.body).not.toHaveProperty('frames');
    expect(meta.body.framesKept).toBe(true);

    const mine = await ana.get(`/v2/matches/${matchId}/shares`).expect(200);
    expect(mine.body.shares.map((s: { id: string }) => s.id)).toEqual([share.id]);
    expect((await ben.get(`/v2/matches/${matchId}/shares`).expect(200)).body.shares).toEqual([]);
  });

  it('a clip link carries only its ticks and the highlights inside them', async () => {
    const made = await ben.post(`/v2/matches/${matchId}/shares`, { clip: { start: 24, end: 30 } }).expect(201);
    expect(made.body.share.clip).toEqual({ start: 24, end: 30 });
    const r = await h.http().get(`/replays/${made.body.share.id}`).expect(200);
    expect(r.body.frames.map((f: { tick: number }) => f.tick)).toEqual([24, 25, 26, 27, 28, 29, 30]);
    expect(r.body.highlights.map((x: { tick: number }) => x.tick)).toEqual([25, 30]);

    for (const clip of [{ start: 10, end: 10 }, { start: 20, end: 31 }]) {
      const bad = await ben.post(`/v2/matches/${matchId}/shares`, { clip }).expect(422);
      expect(bad.body.error.code).toBe('bad_clip');
    }
    await ben.post(`/v2/matches/${matchId}/shares`, { clip: { start: -1, end: 4 } }).expect(400);
  });

  it('a link needs the frames still kept, and its creator can end it', async () => {
    frames.frames.delete(matchId);
    const gone = await ana.post(`/v2/matches/${matchId}/shares`).expect(409);
    expect(gone.body.error.code).toBe('replay_expired');

    frames.frames.set(matchId, matchFrames());
    const { share } = (await ana.post(`/v2/matches/${matchId}/shares`).expect(201)).body;
    frames.frames.delete(matchId);
    // Frames gone later: the link still shows the result and highlights, without playback.
    const late = await h.http().get(`/replays/${share.id}`).expect(200);
    expect(late.body.frames).toBeNull();
    expect(late.body.framesKept).toBe(false);

    await ben.del(`/replays/${share.id}`).expect(404);
    await ana.del(`/replays/${share.id}`).expect(200);
    await h.http().get(`/replays/${share.id}`).expect(404);
    await h.http().get('/replays/not-a-token').expect(404);
  });
});

describe('api caster choice', () => {
  it('uses the model only with a key and a model brain', () => {
    expect(createApiCaster({}).kind).toBe('template');
    expect(createApiCaster({ OPENROUTER_API_KEY: 'k', V2_BRAIN: 'greedy' }).kind).toBe('template');
    expect(createApiCaster({ OPENROUTER_API_KEY: 'k' }).kind).toBe('model');
    expect(createApiCaster({ LLM_API_KEY: 'k', LLM_BASE_URL: 'https://api.openai.com/v1' }).kind).toBe('model');
    expect(createApiCaster({ V2_BRAIN: 'model', LLM_BASE_URL: 'http://localhost:11434/v1' }).kind).toBe('model');
    expect(createApiCaster({ V2_BRAIN: 'model' }).kind).toBe('template');
  });

  it('falls back to template lines without a caster', async () => {
    const frames = new MemoryReplayFrames();
    const h = await setup({ replayFrames: frames });
    try {
      const ana = await h.as('ana');
      const ben = await h.as('ben');
      const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId });
      await h.repos.v2Matches.finish(m.id, { winner: 'B', reason: 'goal', decidedBy: 'goal', score: { A: 2, B: 3 }, ticks: 30 });
      frames.frames.set(m.id, matchFrames());
      const r = await h.http().get(`/v2/matches/${m.id}/highlights`).expect(200);
      expect(r.body.caster).toBe('template');
      expect(r.body.highlights.at(-1).line).toContain('Wren delivers the goal');
    } finally {
      await h.close();
    }
  });
});
