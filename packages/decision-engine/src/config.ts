// Defaults for the v2 decision engine. Prices: Formulas §2 and §10.
// The provider and the model are config (LLM_BASE_URL, LLM_MODEL, ...; see ./llm): these are the
// defaults when the operator sets nothing but a key.

/** OpenRouter's OpenAI-compatible API: the default provider. */
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
/** The default model: acts, speaks and plans for every v2 agent (one model for everyone). */
export const DEFAULT_LLM_MODEL = 'anthropic/claude-haiku-5.5';

/**
 * USD per million tokens for DEFAULT_LLM_MODEL (Formulas §10), the cost estimate when the provider
 * returns no cost and LLM_PRICE_INPUT_USD / LLM_PRICE_OUTPUT_USD are unset.
 */
export const DEFAULT_MODEL_PRICES = {
  input: 0.1,
  cacheRead: 0.01,
  /** 5-minute cache write = 1.25 × input (provider pricing; not in the Formulas doc). */
  cacheWrite: 0.125,
  output: 0.5,
} as const;
