// Defaults for the v2 decision engine. Prices: Formulas §2 and §10.

/** Claude Haiku 5.5 on OpenRouter: acts, speaks and plans for every v2 agent. */
export const HAIKU_OPENROUTER_MODEL = 'anthropic/claude-haiku-5.5';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** USD per million tokens (Formulas §10 `price.haiku`). */
export const PRICES = {
  haiku: {
    input: 0.1,
    cacheRead: 0.01,
    /** 5-minute cache write = 1.25 × input (Anthropic pricing; not in the Formulas doc). */
    cacheWrite: 0.125,
    output: 0.5,
  },
} as const;
