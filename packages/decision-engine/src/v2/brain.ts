// v2 brains: what decides an agent's action (and speech) each tick from its Observation.
// - haiku: Claude Haiku 5.5 through OpenRouter acts, speaks and plans (the pinned model for every
//   agent in every mode, so no player can buy a smarter one). One call per agent per tick returns
//   the action and, when the agent may speak, its message, which then goes through the filter.
// - greedy: deterministic and offline, for dev, tests and benchmarks without keys.
// A brain that misses the deadline or answers with nothing legal waits that tick.
import { TALK_TIERS, type Action, type Channel, type Observation } from '@skirm/engine/v2';
import { HAIKU_OPENROUTER_MODEL, OPENROUTER_BASE_URL, PRICES } from '../config';
import { defaultFetch, dig, num, postJson, type FetchLike } from '../http';
import { runWithPolicy } from '../policy';
import { nowMs } from '../usage';
import { filterSpeech } from './filter';
import { greedyAct, greedySay } from './greedy';
import { parseReply, planPrompt, systemPrompt, turnPrompt } from './prompt';

/** 2 s ticks: the action must be back with half a second to spare. */
export const V2_ACTION_DEADLINE_MS = 1500;
export const V2_ACTOR_MAX_TOKENS = 80;
export const V2_PLANNER_MAX_TOKENS = 200;
export const V2_PLANNER_DEADLINE_MS = 6000;

export interface V2Call {
  role: 'actor' | 'planner';
  model: string;
  ok: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** costUsd is OpenRouter's own bill for the call (usage.cost), not the PRICES estimate. */
  billed?: boolean;
  error?: string;
}

export interface V2Decision {
  action: Action;
  /** Why it is a wait when it is: 'timeout', 'error', 'illegal' (nothing legal in the reply). */
  reason: 'chosen' | 'timeout' | 'error' | 'illegal';
  say: { channel: Channel; text: string } | null;
  /** Speech the filter refused (never shown to anyone). */
  refusedSay?: 'leak' | 'abuse' | 'empty';
  call?: V2Call;
}

export interface V2AgentContext {
  /** The agent's equipped skill prompts: secret, sent to the model only. */
  skills: string[];
  /** The owner's instructions (agents.system_prompt), put ahead of the skills; private like them. */
  instructions?: string | null;
  /** The crew's current plan, if any. */
  plan: string | null;
  /** Whether its talk tier lets it speak this tick. */
  canSpeak: boolean;
  /** Its last few actions with where it stood, oldest first. */
  recent?: string[];
}

export interface V2Brain {
  readonly kind: 'haiku' | 'greedy';
  readonly model: string;
  act(o: Observation, ctx: V2AgentContext): Promise<V2Decision>;
  /** A short crew plan (null when the brain does not plan). */
  plan(o: Observation, ctx: Pick<V2AgentContext, 'skills' | 'instructions'>): Promise<{ text: string | null; call?: V2Call }>;
}

/** Whether an agent may speak on `tick` given its tier and the tick it last spoke. */
export function maySpeak(tier: keyof typeof TALK_TIERS, tick: number, lastSpoke: number): boolean {
  const t = TALK_TIERS[tier];
  return t.freeText && tick - lastSpoke >= t.every;
}

export interface HaikuBrainOptions {
  apiKey: string;
  fetch?: FetchLike;
  model?: string;
  baseUrl?: string;
  deadlineMs?: number;
  /**
   * Hears every OpenRouter call once it completes, ok or not, even when the caller stopped waiting
   * (a late actor reply still cost money). Errors it throws are swallowed.
   */
  onUsage?: (c: V2Call) => void;
}

export function createHaikuBrain(opts: HaikuBrainOptions): V2Brain {
  const fetch = opts.fetch ?? defaultFetch();
  const model = opts.model ?? HAIKU_OPENROUTER_MODEL;
  const url = `${opts.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`;
  const headers = { Authorization: `Bearer ${opts.apiKey}`, 'X-Title': 'skirm' };

  const report = (c: V2Call) => {
    try {
      opts.onUsage?.(c);
    } catch {
      // usage reporting must never break a decision
    }
  };

  const call = async (role: V2Call['role'], system: string, user: string, maxTokens: number, deadline: number) => {
    const started = nowMs();
    const out = await runWithPolicy(
      (signal) =>
        postJson({
          fetch,
          url,
          headers,
          signal,
          // Reasoning off: Haiku 5.5 on OpenRouter reasons by default, and with a short token cap
          // the whole budget goes to reasoning and the reply comes back empty. usage.include asks
          // OpenRouter for the call's real cost.
          body: { model, max_tokens: maxTokens, temperature: 0.4, reasoning: { enabled: false }, usage: { include: true }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
        }),
      { timeLimitMs: deadline },
    );
    const latencyMs = nowMs() - started;
    if (!out.ok) {
      const c: V2Call = { role, model, ok: false, latencyMs, inputTokens: 0, outputTokens: 0, costUsd: 0, error: out.reason };
      report(c);
      return { text: null, reason: out.reason, call: c };
    }
    const text = String(dig(out.value, 'choices', 0, 'message', 'content') ?? '');
    const inputTokens = num(dig(out.value, 'usage', 'prompt_tokens'));
    const outputTokens = num(dig(out.value, 'usage', 'completion_tokens'));
    const billed = dig(out.value, 'usage', 'cost');
    const c: V2Call =
      typeof billed === 'number' && Number.isFinite(billed)
        ? { role, model, ok: true, latencyMs, inputTokens, outputTokens, costUsd: billed, billed: true }
        : { role, model, ok: true, latencyMs, inputTokens, outputTokens, costUsd: (inputTokens * PRICES.haiku.input + outputTokens * PRICES.haiku.output) / 1e6 };
    report(c);
    return { text, reason: null, call: c };
  };

  return {
    kind: 'haiku',
    model,
    async act(o, ctx) {
      const wait: Action = { type: 'wait' };
      const r = await call('actor', systemPrompt(ctx.skills, ctx.instructions), turnPrompt(o, ctx.plan, ctx.canSpeak, ctx.recent ?? []), V2_ACTOR_MAX_TOKENS, opts.deadlineMs ?? V2_ACTION_DEADLINE_MS);
      if (r.text === null) return { action: wait, reason: r.reason === 'timeout' ? 'timeout' : 'error', say: null, call: r.call };
      const parsed = parseReply(r.text, o.legal, ctx.canSpeak);
      let say: V2Decision['say'] = null;
      let refusedSay: V2Decision['refusedSay'];
      if (parsed.say) {
        const f = filterSpeech(parsed.say.text, ctx.instructions ? [...ctx.skills, ctx.instructions] : ctx.skills);
        if (f.ok) say = { channel: parsed.say.channel, text: f.text };
        else refusedSay = f.reason;
      }
      return {
        action: parsed.action ?? wait,
        reason: parsed.action ? 'chosen' : 'illegal',
        say,
        ...(refusedSay ? { refusedSay } : {}),
        call: r.call,
      };
    },
    async plan(o, ctx) {
      const r = await call('planner', systemPrompt(ctx.skills, ctx.instructions), planPrompt(o), V2_PLANNER_MAX_TOKENS, V2_PLANNER_DEADLINE_MS);
      return { text: r.text ? r.text.trim().slice(0, 800) : null, call: r.call };
    },
  };
}

export function createGreedyBrain(): V2Brain {
  return {
    kind: 'greedy',
    model: 'greedy',
    async act(o, ctx) {
      const action = greedyAct(o);
      const text = ctx.canSpeak ? greedySay(o, action) : null;
      return { action, reason: 'chosen', say: text ? { channel: 'team', text } : null };
    },
    async plan() {
      return { text: null };
    },
  };
}

export interface V2BrainOptions {
  /** See HaikuBrainOptions.onUsage; the greedy brain makes no calls. */
  onUsage?: (c: V2Call) => void;
}

/**
 * Haiku when OPENROUTER_API_KEY is set, else the offline greedy brain. The second argument is a
 * fetch (tests) or the options; `createV2Brain(env, fetch, opts)` takes both.
 */
export function createV2Brain(env: { OPENROUTER_API_KEY?: string; V2_BRAIN?: string }, extra?: FetchLike | V2BrainOptions, opts: V2BrainOptions = {}): V2Brain {
  const fetch = typeof extra === 'function' ? extra : undefined;
  const o = typeof extra === 'object' ? { ...extra, ...opts } : opts;
  if (env.V2_BRAIN !== 'greedy' && env.OPENROUTER_API_KEY)
    return createHaikuBrain({ apiKey: env.OPENROUTER_API_KEY, ...(fetch ? { fetch } : {}), ...(o.onUsage ? { onUsage: o.onUsage } : {}) });
  return createGreedyBrain();
}
