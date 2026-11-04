import type { ReplayHighlight } from '@skirm/engine/v2';
import { MAPS_V2, createMatch, observe, type AgentSpec } from '@skirm/engine/v2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_MODEL_PRICES,
  chatRequest,
  createModelBrain,
  createModelCaster,
  createV2Brain,
  isOpenRouter,
  llmSettings,
  resetUnpricedWarnings,
  usageCost,
  v2BrainKind,
  v2BrainModel,
  type V2Call,
} from '../src/v2';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string): AgentSpec => ({ id, name: id, role: 'Runner', vision: 3, comms: 3, tier: 'standard' });
const obs = () => observe(createMatch(map, { A: [spec('wick')], B: [spec('wren')] }), 'wick');
const ctx = { skills: [], plan: null, canSpeak: false };

/** A plain OpenAI-compatible server: standard usage, no cost. */
function openAiFetch(content = 'ACTION: 1') {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 2000, completion_tokens: 40, total_tokens: 2040 } }), { status: 200 }),
  );
}

beforeEach(() => resetUnpricedWarnings());

describe('llmSettings', () => {
  it('defaults to OpenRouter and the default model, with no key and no prices', () => {
    expect(llmSettings({})).toEqual({ baseUrl: DEFAULT_LLM_BASE_URL, apiKey: null, model: DEFAULT_LLM_MODEL, plannerModel: DEFAULT_LLM_MODEL, prices: null });
  });

  it('reads LLM_*, trims, and lets the planner model default to LLM_MODEL', () => {
    const s = llmSettings({ LLM_BASE_URL: ' https://api.openai.com/v1/ ', LLM_API_KEY: ' sk-1 ', LLM_MODEL: 'gpt-5-mini', LLM_PRICE_INPUT_USD: '0.25', LLM_PRICE_OUTPUT_USD: '2' });
    expect(s).toEqual({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'gpt-5-mini', plannerModel: 'gpt-5-mini', prices: { input: 0.25, output: 2 } });
    expect(llmSettings({ LLM_MODEL: 'a', LLM_PLANNER_MODEL: 'b' }).plannerModel).toBe('b');
    expect(llmSettings({ LLM_PRICE_INPUT_USD: 1 }).prices).toEqual({ input: 1, output: 0 });
    expect(llmSettings({ LLM_PRICE_INPUT_USD: '', LLM_PRICE_OUTPUT_USD: '' }).prices).toBeNull();
  });

  it('takes OPENROUTER_API_KEY as an alias of LLM_API_KEY (LLM_API_KEY wins)', () => {
    expect(llmSettings({ OPENROUTER_API_KEY: 'or' }).apiKey).toBe('or');
    expect(llmSettings({ OPENROUTER_API_KEY: 'or', LLM_API_KEY: 'llm' }).apiKey).toBe('llm');
    expect(llmSettings({ OPENROUTER_API_KEY: 'or', LLM_API_KEY: ' ' }).apiKey).toBe('or');
  });
});

describe('v2BrainKind', () => {
  it('is model with a key unless V2_BRAIN=greedy, and haiku is the old name of model', () => {
    expect(v2BrainKind({})).toBe('greedy');
    expect(v2BrainKind({ LLM_API_KEY: 'k' })).toBe('model');
    expect(v2BrainKind({ OPENROUTER_API_KEY: 'k' })).toBe('model');
    expect(v2BrainKind({ LLM_API_KEY: 'k', V2_BRAIN: 'greedy' })).toBe('greedy');
    expect(v2BrainKind({ LLM_API_KEY: 'k', V2_BRAIN: 'haiku' })).toBe('model');
    expect(v2BrainKind({ LLM_API_KEY: 'k', V2_BRAIN: 'model' })).toBe('model');
    expect(v2BrainModel({ LLM_API_KEY: 'k', LLM_MODEL: 'qwen3' })).toBe('qwen3');
    expect(v2BrainModel({ V2_BRAIN: 'greedy', LLM_API_KEY: 'k' })).toBeNull();
  });

  it('plays a keyless local server only when asked for explicitly', () => {
    const local = { LLM_BASE_URL: 'http://localhost:11434/v1' };
    expect(v2BrainKind(local)).toBe('greedy');
    expect(v2BrainKind({ ...local, V2_BRAIN: 'model' })).toBe('model');
    expect(v2BrainKind({ ...local, V2_BRAIN: 'haiku' })).toBe('model');
    // OpenRouter always needs a key.
    expect(v2BrainKind({ V2_BRAIN: 'model' })).toBe('greedy');
    expect(v2BrainKind({ V2_BRAIN: 'model', LLM_BASE_URL: DEFAULT_LLM_BASE_URL })).toBe('greedy');
  });
});

describe('chatRequest', () => {
  const args = { apiKey: 'k', model: 'm', maxTokens: 10, temperature: 0.4, system: 's', user: 'u' };

  it('sends OpenRouter-only fields and headers to OpenRouter only', () => {
    expect(isOpenRouter('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouter('https://api.openai.com/v1')).toBe(false);
    expect(isOpenRouter('https://evil.example/openrouter.ai')).toBe(false);
    const or = chatRequest({ ...args, baseUrl: 'https://openrouter.ai/api/v1' });
    expect(or.headers).toEqual({ Authorization: 'Bearer k', 'X-Title': 'skirm' });
    expect(or.body).toMatchObject({ reasoning: { enabled: false }, usage: { include: true } });
    const plain = chatRequest({ ...args, baseUrl: 'https://api.groq.com/openai/v1/' });
    expect(plain.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(plain.headers).toEqual({ Authorization: 'Bearer k' });
    expect(Object.keys(plain.body).sort()).toEqual(['max_tokens', 'messages', 'model', 'temperature']);
    expect(chatRequest({ ...args, apiKey: null, baseUrl: 'http://localhost:1234/v1' }).headers).toEqual({});
  });
});

describe('usageCost', () => {
  it("prefers the provider's bill, then the prices, then 0 with one warning per model", () => {
    const warn = vi.fn();
    const u = { usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000 } };
    expect(usageCost({ usage: { ...u.usage, cost: 0.3 } }, 'm', { input: 1, output: 2 }, warn)).toEqual({ inputTokens: 1_000_000, outputTokens: 500_000, costUsd: 0.3, billed: true });
    expect(usageCost(u, 'm', { input: 1, output: 2 }, warn)).toEqual({ inputTokens: 1_000_000, outputTokens: 500_000, costUsd: 2 });
    expect(usageCost(u, 'm', null, warn)).toEqual({ inputTokens: 1_000_000, outputTokens: 500_000, costUsd: 0 });
    usageCost(u, 'm', null, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('LLM_PRICE_INPUT_USD');
  });
});

describe('model brain on a plain OpenAI-compatible provider', () => {
  const env = { LLM_BASE_URL: 'https://api.openai.com/v1', LLM_API_KEY: 'sk-1', LLM_MODEL: 'gpt-5-mini', LLM_PLANNER_MODEL: 'gpt-5', LLM_PRICE_INPUT_USD: '0.25', LLM_PRICE_OUTPUT_USD: '2' };

  it('sends no OpenRouter-only fields and prices the standard usage', async () => {
    const fetch = openAiFetch();
    const seen: V2Call[] = [];
    const brain = createV2Brain(env, fetch, { onUsage: (c) => seen.push(c) });
    expect(brain).toMatchObject({ kind: 'model', model: 'gpt-5-mini' });
    const d = await brain.act(obs(), ctx);
    expect(d.reason).toBe('chosen');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-1' });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('gpt-5-mini');
    expect(body).not.toHaveProperty('usage');
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('provider');
    expect(d.call).toMatchObject({ model: 'gpt-5-mini', inputTokens: 2000, outputTokens: 40, costUsd: (2000 * 0.25 + 40 * 2) / 1e6 });
    expect(d.call!.billed).toBeUndefined();
    await brain.plan(obs(), { skills: [] });
    expect(JSON.parse(String(fetch.mock.calls[1]![1].body)).model).toBe('gpt-5');
    expect(seen.map((c) => c.model)).toEqual(['gpt-5-mini', 'gpt-5']);
  });

  it('records cost 0 and warns once when there is no price for the model', async () => {
    const warn = vi.fn();
    const fetch = openAiFetch();
    const brain = createModelBrain({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', fetch, warn });
    const a = await brain.act(obs(), ctx);
    const b = await brain.act(obs(), ctx);
    expect([a.call!.costUsd, b.call!.costUsd]).toEqual([0, 0]);
    expect(a.call!.inputTokens).toBe(2000);
    expect(warn).toHaveBeenCalledTimes(1);
    // Keyless: no Authorization header.
    expect(fetch.mock.calls[0]![1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('keeps the default price table for the default model', async () => {
    const d = await createModelBrain({ apiKey: 'k', baseUrl: 'https://example.test/v1', fetch: openAiFetch() }).act(obs(), ctx);
    expect(d.call!.costUsd).toBeCloseTo((2000 * DEFAULT_MODEL_PRICES.input + 40 * DEFAULT_MODEL_PRICES.output) / 1e6, 12);
  });

  it('casts replays through the same provider', async () => {
    const hl: ReplayHighlight = { id: 'goal-30', kind: 'goal', tick: 30, start: 24, end: 34, team: 'A', title: 'Rook scores', facts: 'Rook scores.', weight: 5, score: { A: 1, B: 0 } };
    const fetch = openAiFetch('goal-30: What a finish from Rook!');
    const r = await createModelCaster({ apiKey: 'sk-1', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', prices: { input: 1, output: 1 }, fetch }).cast({ mapName: 'Copper Hollow', crews: { A: 'ana', B: 'ben' }, highlights: [hl] });
    expect(r).toMatchObject({ caster: 'model', model: 'gpt-5-mini', costUsd: 2040 / 1e6 });
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body));
    expect(body).not.toHaveProperty('usage');
    expect(body).not.toHaveProperty('reasoning');
  });
});
