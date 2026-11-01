// The v2 brain realtime plays with: Haiku 5.5 through OpenRouter when OPENROUTER_API_KEY is set
// (V2_BRAIN=greedy forces the offline brain), else the greedy brain. Every model call's cost goes to
// the daily CostMonitor, so v2 spend raises `cost_alert` like the rest.
import { createV2Brain, type V2Brain } from '@skirm/decision-engine/v2';
import type { CostMonitor } from '@skirm/server';
import type { Logger } from '../deps';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function createRealtimeV2Brain(env: { OPENROUTER_API_KEY?: string; V2_BRAIN?: string }, costs: Pick<CostMonitor, 'record'>, log: Logger, fetch?: Fetch): V2Brain {
  const onUsage = (c: { costUsd: number }) =>
    void costs.record(c.costUsd).catch((err: unknown) => log.warn(`v2 cost total update failed: ${(err as Error).name}`));
  return fetch ? createV2Brain(env, fetch, { onUsage }) : createV2Brain(env, { onUsage });
}
