// The model provider: any OpenAI-compatible chat-completions API (OpenRouter by default; OpenAI,
// Anthropic's OpenAI-compatible endpoint, Groq, Together, a local Ollama / LM Studio / vLLM ...).
// Settings come from the environment:
//   LLM_BASE_URL          default https://openrouter.ai/api/v1
//   LLM_API_KEY           (OPENROUTER_API_KEY is an alias) unset → the offline greedy brain
//   LLM_MODEL             default DEFAULT_LLM_MODEL
//   LLM_PLANNER_MODEL     default LLM_MODEL
//   LLM_PRICE_INPUT_USD / LLM_PRICE_OUTPUT_USD   USD per 1M tokens, for the cost monitor when the
//                         provider returns no cost (OpenRouter's usage.cost)
//   V2_BRAIN              model | greedy ('haiku' is the old name of model)
// OpenRouter-only request fields and headers are sent only when the base URL is OpenRouter's.
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL, DEFAULT_MODEL_PRICES } from './config';
import { dig, num } from './http';

export interface LlmEnv {
  LLM_BASE_URL?: string | undefined;
  LLM_API_KEY?: string | undefined;
  LLM_MODEL?: string | undefined;
  LLM_PLANNER_MODEL?: string | undefined;
  LLM_PRICE_INPUT_USD?: string | number | undefined;
  LLM_PRICE_OUTPUT_USD?: string | number | undefined;
  /** Old name of LLM_API_KEY (LLM_API_KEY wins when both are set). */
  OPENROUTER_API_KEY?: string | undefined;
  /** `model` | `greedy` (`haiku`: the old name of `model`). */
  V2_BRAIN?: string | undefined;
}

/** USD per million tokens. */
export interface LlmPrices {
  input: number;
  output: number;
}

export interface LlmSettings {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  plannerModel: string;
  /** Configured prices; null → DEFAULT_MODEL_PRICES for the default model, else no estimate. */
  prices: LlmPrices | null;
}

export type V2BrainKind = 'model' | 'greedy';

const str = (v: string | undefined) => (v === undefined || v.trim() === '' ? undefined : v.trim());
const price = (v: string | number | undefined): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : undefined;
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** The provider settings the environment asks for (with the defaults and the old aliases). */
export function llmSettings(env: LlmEnv): LlmSettings {
  const model = str(env.LLM_MODEL) ?? DEFAULT_LLM_MODEL;
  const input = price(env.LLM_PRICE_INPUT_USD);
  const output = price(env.LLM_PRICE_OUTPUT_USD);
  return {
    baseUrl: (str(env.LLM_BASE_URL) ?? DEFAULT_LLM_BASE_URL).replace(/\/+$/, ''),
    apiKey: str(env.LLM_API_KEY) ?? str(env.OPENROUTER_API_KEY) ?? null,
    model,
    plannerModel: str(env.LLM_PLANNER_MODEL) ?? model,
    prices: input === undefined && output === undefined ? null : { input: input ?? 0, output: output ?? 0 },
  };
}

/** Whether a base URL is OpenRouter's (the only provider that gets OpenRouter-only fields). */
export function isOpenRouter(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

/**
 * The v2 brain the environment selects: `greedy` when V2_BRAIN=greedy or no model is reachable,
 * else `model`. A model needs an API key, except a keyless local server (Ollama, LM Studio, vLLM):
 * V2_BRAIN=model with a non-OpenRouter LLM_BASE_URL.
 */
export function v2BrainKind(env: LlmEnv): V2BrainKind {
  const brain = str(env.V2_BRAIN)?.toLowerCase();
  if (brain === 'greedy') return 'greedy';
  const s = llmSettings(env);
  if (s.apiKey) return 'model';
  const explicit = brain === 'model' || brain === 'haiku';
  return explicit && str(env.LLM_BASE_URL) !== undefined && !isOpenRouter(s.baseUrl) ? 'model' : 'greedy';
}

/** The model id the selected brain plays with (null for the greedy brain). */
export function v2BrainModel(env: LlmEnv): string | null {
  return v2BrainKind(env) === 'model' ? llmSettings(env).model : null;
}

/** Prices for the cost estimate: the configured ones, else the default model's, else none. */
export function pricesFor(model: string, configured: LlmPrices | null | undefined): LlmPrices | null {
  if (configured) return configured;
  return model === DEFAULT_LLM_MODEL ? { input: DEFAULT_MODEL_PRICES.input, output: DEFAULT_MODEL_PRICES.output } : null;
}

export interface ChatRequestArgs {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  maxTokens: number;
  temperature: number;
  system: string;
  user: string;
}

/** URL, headers and body of one chat completion; OpenRouter-only fields go to OpenRouter only. */
export function chatRequest(a: ChatRequestArgs): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const openRouter = isOpenRouter(a.baseUrl);
  const headers: Record<string, string> = {};
  if (a.apiKey) headers.Authorization = `Bearer ${a.apiKey}`;
  if (openRouter) headers['X-Title'] = 'skirm';
  const body: Record<string, unknown> = {
    model: a.model,
    max_tokens: a.maxTokens,
    temperature: a.temperature,
    messages: [
      { role: 'system', content: a.system },
      { role: 'user', content: a.user },
    ],
  };
  if (openRouter) {
    // Reasoning off: a model that reasons by default on OpenRouter spends a short token cap on it
    // and comes back empty. usage.include asks OpenRouter for the call's real cost.
    body.reasoning = { enabled: false };
    body.usage = { include: true };
  }
  return { url: `${a.baseUrl.replace(/\/+$/, '')}/chat/completions`, headers, body };
}

const unpriced = new Set<string>();

/** Test hook: forget which models were already warned about. */
export function resetUnpricedWarnings(): void {
  unpriced.clear();
}

/**
 * Tokens and cost of a completed call: the provider's own bill (usage.cost) when it returns one,
 * else the standard token counts at `prices`, else cost 0 (warned once per model).
 */
export function usageCost(
  response: unknown,
  model: string,
  prices: LlmPrices | null,
  warn: (msg: string) => void = (m) => console.warn(m),
): { inputTokens: number; outputTokens: number; costUsd: number; billed?: true } {
  const inputTokens = num(dig(response, 'usage', 'prompt_tokens'));
  const outputTokens = num(dig(response, 'usage', 'completion_tokens'));
  const billed = dig(response, 'usage', 'cost');
  if (typeof billed === 'number' && Number.isFinite(billed)) return { inputTokens, outputTokens, costUsd: billed, billed: true };
  if (prices) return { inputTokens, outputTokens, costUsd: (inputTokens * prices.input + outputTokens * prices.output) / 1e6 };
  if (!unpriced.has(model)) {
    unpriced.add(model);
    warn(`llm: the provider returned no cost and LLM_PRICE_INPUT_USD / LLM_PRICE_OUTPUT_USD are unset for ${model}: its spend is recorded as 0`);
  }
  return { inputTokens, outputTokens, costUsd: 0 };
}
