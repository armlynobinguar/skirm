import { DEFAULT_PRACTICE, MAPS_V2, botCrew, createMatch, mapV2, observe, type AgentSpec } from '@skirm/engine/v2';
import { describe, expect, it, vi } from 'vitest';
import { PRICES } from '../src/config';
import { V2_PLANNER_MAX_TOKENS, createGreedyBrain, createHaikuBrain, createV2Brain, playHeadless, type V2Call } from '../src/v2';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string): AgentSpec => ({ id, name: id, role: 'Runner', vision: 3, comms: 3, tier: 'standard' });
const obs = () => observe(createMatch(map, { A: [spec('wick')], B: [spec('wren')] }), 'wick');
const ctx = { skills: [], plan: null, canSpeak: false };

/** An OpenRouter stand-in that answers once `gate` opens (ignoring aborts), optionally with usage.cost. */
function fakeFetch(opts: { gate?: Promise<void>; cost?: number; status?: number } = {}) {
  return vi.fn(async (_url: string, _init: RequestInit) => {
    if (opts.gate) await opts.gate;
    if (opts.status) return new Response('nope', { status: opts.status });
    const usage = { prompt_tokens: 1000, completion_tokens: 10, ...(opts.cost !== undefined ? { cost: opts.cost } : {}) };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ACTION: 1' } }], usage }), { status: 200 });
  });
}

const waitFor = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('Haiku brain usage', () => {
  it("asks OpenRouter for usage and takes its billed cost over the PRICES estimate", async () => {
    const seen: V2Call[] = [];
    const fetch = fakeFetch({ cost: 0.00042 });
    const d = await createHaikuBrain({ apiKey: 'k', fetch, onUsage: (c) => seen.push(c) }).act(obs(), ctx);
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body)).usage).toEqual({ include: true });
    expect(d.call).toMatchObject({ ok: true, costUsd: 0.00042, billed: true, inputTokens: 1000, outputTokens: 10 });
    expect(seen).toEqual([d.call]);
  });

  it('keeps the PRICES estimate, unbilled, when the response has no cost', async () => {
    const seen: V2Call[] = [];
    const d = await createHaikuBrain({ apiKey: 'k', fetch: fakeFetch(), onUsage: (c) => seen.push(c) }).act(obs(), ctx);
    expect(d.call!.costUsd).toBeCloseTo((1000 * PRICES.haiku.input + 10 * PRICES.haiku.output) / 1e6, 12);
    expect(d.call!.billed).toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  it('reports failed calls and planner calls too', async () => {
    const seen: V2Call[] = [];
    const brain = createHaikuBrain({ apiKey: 'k', fetch: fakeFetch({ status: 400 }), onUsage: (c) => seen.push(c) });
    await brain.act(obs(), ctx);
    await brain.plan(obs(), { skills: [] });
    expect(seen.map((c) => [c.role, c.ok, c.costUsd])).toEqual([
      ['actor', false, 0],
      ['planner', false, 0],
    ]);
  });

  it('reports a call that finishes after the caller stopped waiting', async () => {
    const seen: V2Call[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const brain = createHaikuBrain({ apiKey: 'k', fetch: fakeFetch({ gate, cost: 0.0002 }), onUsage: (c) => seen.push(c) });
    // The caller's deadline (as the realtime match and playHeadless race it) passes first.
    const raced = await Promise.race([brain.act(obs(), ctx), new Promise<null>((r) => setTimeout(() => r(null), 5))]);
    expect(raced).toBeNull();
    expect(seen).toHaveLength(0);
    release();
    await waitFor(() => seen.length > 0);
    expect(seen).toEqual([expect.objectContaining({ role: 'actor', ok: true, costUsd: 0.0002, billed: true })]);
  });

  it('never lets a throwing onUsage break a decision', async () => {
    const onUsage = () => {
      throw new Error('monitor down');
    };
    const d = await createHaikuBrain({ apiKey: 'k', fetch: fakeFetch(), onUsage }).act(obs(), ctx);
    expect(d).toMatchObject({ reason: 'chosen', call: { ok: true } });
  });
});

describe('createV2Brain options', () => {
  it('passes onUsage through, after a fetch or in its place', async () => {
    const a: V2Call[] = [];
    const b: V2Call[] = [];
    await createV2Brain({ OPENROUTER_API_KEY: 'k' }, fakeFetch(), { onUsage: (c) => a.push(c) }).act(obs(), ctx);
    expect(a).toHaveLength(1);
    const withOpts = createV2Brain({ V2_BRAIN: 'greedy', OPENROUTER_API_KEY: 'k' }, { onUsage: (c) => b.push(c) });
    expect(withOpts.kind).toBe('greedy');
    expect(createV2Brain({}, { onUsage: (c) => b.push(c) }).kind).toBe('greedy');
    expect(createV2Brain({ OPENROUTER_API_KEY: 'k' }, { onUsage: (c) => b.push(c) }).kind).toBe('haiku');
    expect(b).toHaveLength(0);
  });
});

describe('usage in a headless match', () => {
  it('fires onUsage for actor calls that came back after the action deadline', async () => {
    const usage: V2Call[] = [];
    // Plans answer at once; actor calls hang until the match is over, so every one of them is late.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (JSON.parse(String(init.body)).max_tokens !== V2_PLANNER_MAX_TOKENS) await gate;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ACTION: 1' } }], usage: { prompt_tokens: 1000, completion_tokens: 10, cost: 0.0001 } }), { status: 200 });
    });
    const brain = createHaikuBrain({ apiKey: 'k', fetch, deadlineMs: 60_000, onUsage: (c) => usage.push(c) });
    const r = await playHeadless({
      def: mapV2(DEFAULT_PRACTICE.mapId)!,
      difficulty: DEFAULT_PRACTICE.difficulty,
      crews: { A: botCrew(1, 'a'), B: botCrew(1, 'b') },
      brains: { A: brain, B: createGreedyBrain() },
      deadlineMs: 2,
    });
    expect(r.result.winner).toBe('B');
    expect(usage.every((c) => c.role === 'planner')).toBe(true);
    expect(r.stats.A.calls).toBe(usage.length);
    release();
    const actor = () => usage.filter((c) => c.role === 'actor');
    await waitFor(() => actor().length >= r.ticks);
    expect(actor()).toHaveLength(r.ticks);
    expect(actor().every((c) => c.ok && c.billed && c.costUsd === 0.0001)).toBe(true);
  });
});
