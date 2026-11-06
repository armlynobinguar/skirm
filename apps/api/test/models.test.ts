// GET /v2/models: the per-agent model catalog the crew builder shows (public; realtime prices picks itself).
import { afterEach, describe, expect, it } from 'vitest';
import { setup, type Harness } from './helpers';

describe('GET /v2/models', () => {
  let h: Harness | undefined;
  afterEach(async () => {
    await h?.close();
  });

  it('is the default model alone at 1.0x when LLM_MODELS is unset', async () => {
    h = await setup();
    const res = await h.http().get('/v2/models');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      default: 'anthropic/claude-haiku-5.5',
      models: [{ id: 'anthropic/claude-haiku-5.5', label: 'claude-haiku-5.5', rateMultiplierBps: 10000 }],
    });
  });

  it('lists the configured catalog, default first', async () => {
    const llmModels = [
      { id: 'a/base', label: 'Base', rateMultiplierBps: 10000 },
      { id: 'x/big', label: 'Big', rateMultiplierBps: 15000 },
    ];
    h = await setup({ config: { LLM_MODEL: 'a/base', llmModels } });
    const res = await h.http().get('/v2/models');
    expect(res.body).toEqual({ default: 'a/base', models: llmModels });
  });
});
