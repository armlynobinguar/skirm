// /bench*: the writers' skill test bench (runs are played by the worker; here they stay queued).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffWords } from '../src/text-diff';
import { FLOOD_WARDEN, SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let writer: UserClient;
let other: UserClient;
let draftId: string;

const seed = { mapId: 'copper-hollow', difficulty: 'easy' };

beforeAll(async () => {
  h = await setup({ config: { BENCH_RUNS_PER_HOUR: 4 } });
  writer = await h.as('bench-writer');
  other = await h.as('bench-other');
  draftId = (await writer.post('/skills', SAMPLE_SKILL)).body.id;
});
afterAll(() => h.close());

describe('bench', () => {
  it('GET /bench: free on the greedy brain, with the hourly cap', async () => {
    const res = await writer.get('/bench');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brain: 'greedy', free: true, costCredits: 0, limit: { perHour: 4, used: 0, left: 4 } });
  });

  it('GET /bench: a model brain prices one Standard agent', async () => {
    const m = await setup({ config: { OPENROUTER_API_KEY: 'k' } });
    try {
      const u = await m.as('priced');
      expect((await u.get('/bench')).body).toMatchObject({ brain: 'model', free: false, costCredits: 30 });
    } finally {
      await m.close();
    }
  });

  it('queues a run of a draft the caller wrote, with or without an edited prompt', async () => {
    const plain = await writer.post('/bench/runs', { skillId: draftId, ...seed });
    expect(plain.status).toBe(202);
    expect(plain.body).toMatchObject({
      skillId: draftId,
      version: 1,
      skillName: 'Gap Sealer',
      seed: 'copper-hollow:easy',
      status: 'queued',
      edited: false,
      result: null,
    });
    expect(h.benchmarks.jobs).toContainEqual({ kind: 'bench', runId: plain.body.id });

    const edited = await writer.post('/bench/runs', { skillId: draftId, version: 1, ...seed, prompt: 'SECRET-PROMPT-7f3a: block the widest gap first.' });
    expect(edited.status).toBe(202);
    expect(edited.body.edited).toBe(true);
    // The draft is sealed on the row, never stored as text.
    const row = await h.repos.bench.get(edited.body.id);
    expect(row?.ciphertext).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('widest gap');

    const one = await writer.get(`/bench/runs/${edited.body.id}`);
    expect(one.body).toMatchObject({ prompt: 'SECRET-PROMPT-7f3a: block the widest gap first.', reflexes: null, promptHidden: false });
    const own = await writer.get(`/bench/runs/${plain.body.id}`);
    expect(own.body).toMatchObject({ prompt: SAMPLE_SKILL.prompt, reflexes: SAMPLE_SKILL.reflexes });

    const list = await writer.get(`/bench/runs?skillId=${draftId}`);
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([edited.body.id, plain.body.id]);
  });

  it('compares two runs with a word diff of their prompts', async () => {
    const [b2, a2] = (await writer.get(`/bench/runs?skillId=${draftId}`)).body as { id: string }[];
    const res = await writer.get(`/bench/compare?a=${a2!.id}&b=${b2!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.prompt.hidden).toBe(false);
    expect(res.body.prompt.same).toBe(false);
    const diff = res.body.prompt.diff as { op: string; text: string }[];
    expect(diff.filter((p) => p.op === 'add').map((p) => p.text).join('')).toContain('widest');
    expect(diff.filter((p) => p.op === 'del').map((p) => p.text).join('')).toContain('narrowest');
    // Other players cannot read, list or compare someone's runs.
    expect((await other.get(`/bench/runs/${a2!.id}`)).status).toBe(404);
    expect((await other.get(`/bench/compare?a=${a2!.id}&b=${b2!.id}`)).status).toBe(404);
    expect((await other.get(`/bench/runs?skillId=${draftId}`)).body).toEqual([]);
  });

  it('refuses someone else’s draft, edits of a bought text, and unknown seeds', async () => {
    expect((await other.post('/bench/runs', { skillId: draftId, ...seed })).status).toBe(403);
    expect((await writer.post('/bench/runs', { skillId: draftId, mapId: 'nowhere', difficulty: 'easy' })).status).toBe(400);
    expect((await writer.post('/bench/runs', { skillId: draftId, mapId: 'copper-hollow', difficulty: 'impossible' })).status).toBe(400);
    expect((await writer.post('/bench/runs', { skillId: draftId, ...seed, prompt: 'x'.repeat(1201) })).status).toBe(400);
    // Flood Warden: held (the starter grant) but written by the platform.
    const held = await other.post('/bench/runs', { ...seed, skillId: FLOOD_WARDEN.id });
    expect(held.status).toBe(202);
    expect((await other.get(`/bench/runs/${held.body.id}`)).body).toMatchObject({ prompt: null, promptHidden: true });
    expect((await other.post('/bench/runs', { ...seed, skillId: FLOOD_WARDEN.id, prompt: 'mine now' })).status).toBe(403);
    const again = await other.post('/bench/runs', { ...seed, skillId: FLOOD_WARDEN.id });
    const cmp = await other.get(`/bench/compare?a=${held.body.id}&b=${again.body.id}`);
    expect(cmp.body.prompt).toEqual({ hidden: true, same: null, diff: null });
  });

  it('caps runs per account per hour (429 bench_limit)', async () => {
    // The writer has used 2 of 4.
    expect((await writer.post('/bench/runs', { skillId: draftId, ...seed })).status).toBe(202);
    expect((await writer.post('/bench/runs', { skillId: draftId, ...seed })).status).toBe(202);
    const over = await writer.post('/bench/runs', { skillId: draftId, ...seed });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('bench_limit');
    expect(over.body.error.details).toMatchObject({ limit: 4, used: 4 });
    expect((await writer.get('/bench')).body.limit).toEqual({ perHour: 4, used: 4, left: 0 });
  });

  it('a queue outage fails the run with 503', async () => {
    const q = await setup();
    try {
      const u = await q.as('outage');
      const id = (await u.post('/skills', SAMPLE_SKILL)).body.id;
      q.benchmarks.enqueue = async () => {
        throw new Error('redis down');
      };
      const res = await u.post('/bench/runs', { skillId: id, ...seed });
      expect(res.status).toBe(503);
      const [run] = await q.repos.bench.list(u.accountId);
      expect(run).toMatchObject({ status: 'failed', error: 'queue_unavailable' });
    } finally {
      await q.close();
    }
  });
});

describe('diffWords', () => {
  it('keeps shared words and marks removed and added ones', () => {
    expect(diffWords('block the narrow gap', 'block the wide gap now')).toEqual([
      { op: 'same', text: 'block the ' },
      { op: 'del', text: 'narrow' },
      { op: 'add', text: 'wide' },
      { op: 'same', text: ' gap' },
      { op: 'add', text: ' now' },
    ]);
    expect(diffWords('same', 'same')).toEqual([{ op: 'same', text: 'same' }]);
    expect(diffWords('', 'new')).toEqual([{ op: 'add', text: 'new' }]);
  });
});
