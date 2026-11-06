// v2 brains: what decides an agent's action (and speech) each tick from its Observation.
// - model: the operator's model (LLM_MODEL on any OpenAI-compatible provider, ../llm) acts, speaks
//   and plans. Outside ranked an agent may act with another model from the operator's catalog
//   (LLM_MODELS, @skirm/shared models.ts; V2AgentContext.model), priced into its talk rate by the
//   server; ranked always plays LLM_MODEL. One call per agent per tick returns the action and, when
//   the agent may speak, its message, which then goes through the filter.
// - greedy: deterministic and offline, for dev, tests and benchmarks without keys.
// A brain that misses the deadline or answers with nothing legal waits that tick.
import { TALK_TIERS, skillTriggerHolds, type Action, type Channel, type CommandPreset, type Observation, type SkillTrigger } from '@skirm/engine/v2';
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from '../config';
import { defaultFetch, dig, postJson, type FetchLike } from '../http';
import { chatRequest, llmSettings, pricesFor, usageCost, v2BrainKind, type LlmEnv, type LlmPrices } from '../llm';
import { runWithPolicy } from '../policy';
import { nowMs } from '../usage';
import { filterSpeech } from './filter';
import { greedyAct, greedyPlan, greedySay, greedyThought } from './greedy';
import { parsePlan, parseReply, planPrompt, systemPrompt, turnPrompt } from './prompt';

/** 2 s ticks: the action must be back with half a second to spare. */
export const V2_ACTION_DEADLINE_MS = 1500;
/** Room for the action, a message and the inner-voice line. */
export const V2_ACTOR_MAX_TOKENS = 110;
/** Room for the plan and its WHY line. */
export const V2_PLANNER_MAX_TOKENS = 240;
export const V2_PLANNER_DEADLINE_MS = 6000;

export interface V2Call {
  role: 'actor' | 'planner';
  model: string;
  ok: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** costUsd is the provider's own bill for the call (OpenRouter's usage.cost), not a price estimate. */
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
  /** The agent's inner voice this tick: first person, private to its crew (withheld like the plan). */
  thought?: string;
  /** Index into the context's `skills` of the skill the model said drove this move (the debrief timeline). */
  skill?: number;
  call?: V2Call;
}

/** A crew plan and the planner's reason for it (the mind panel's planner trace). */
export interface V2Plan {
  text: string | null;
  why?: string | null;
  call?: V2Call;
}

export interface V2AgentContext {
  /** The agent's equipped skill prompts: secret, sent to the model only. */
  skills: string[];
  /**
   * Each skill's trigger, in skill order (absent or null: always). A skill whose trigger does not
   * hold on this tick's observation is left out of the prompt (activeSkills); the speech filter
   * still guards every skill.
   */
  skillTriggers?: (SkillTrigger | null)[];
  /** The owner's instructions (agents.system_prompt), put ahead of the skills; private like them. */
  instructions?: string | null;
  /**
   * The player's crew playbook for this match (whole for the planner, one line for an actor); private
   * like the skills, and guarded by the speech filter the same way.
   */
  playbook?: string | null;
  /** The crew's current plan, if any. */
  plan: string | null;
  /** Whether its talk tier lets it speak this tick. */
  canSpeak: boolean;
  /** Its last few actions with where it stood, oldest first. */
  recent?: string[];
  /** A live command from its player still in force (DEFAULTS.commands.activeTicks), or none. */
  command?: V2AgentCommand | null;
  /**
   * The catalog model this agent acts with when not the brain's own (the server resolved and priced
   * it). Absent: the brain's model. The crew planner always uses the planner model.
   */
  model?: string | null;
}

/** A player's live command as an agent receives it. */
export interface V2AgentCommand {
  preset: CommandPreset | null;
  /** The whole order for the model: the preset's directive, then the player's words (commandOrder). */
  order: string;
  /** Ticks the order has left. */
  ticksLeft: number;
  /** go_drop: the tiles it points at (landed supply drops, else middle items); empty when none. */
  targets?: [number, number][];
}

/** What the planner is given: the crew's skills, instructions and playbook, and who its player steers. */
export type V2PlanContext = Pick<V2AgentContext, 'skills' | 'skillTriggers' | 'instructions' | 'playbook'> & {
  /** Hybrid control: the name of the crew's agent its player steers by hand (plan around it, never for it). */
  controlled?: string | null;
};

export interface V2Brain {
  /** external: a player's own program (bring your own agent), greedy on any tick it misses. */
  readonly kind: 'model' | 'greedy' | 'external';
  readonly model: string;
  act(o: Observation, ctx: V2AgentContext): Promise<V2Decision>;
  /** A short crew plan (null when the brain does not plan). */
  plan(o: Observation, ctx: V2PlanContext): Promise<V2Plan>;
}

/** The skills whose triggers hold on this observation, in order (skills without a trigger always do). */
export function activeSkills(o: Observation, ctx: Pick<V2AgentContext, 'skills' | 'skillTriggers'>): string[] {
  return ctx.skills.filter((_, i) => skillTriggerHolds(ctx.skillTriggers?.[i], o));
}

/** Whether an agent may speak on `tick` given its tier and the tick it last spoke. */
export function maySpeak(tier: keyof typeof TALK_TIERS, tick: number, lastSpoke: number): boolean {
  const t = TALK_TIERS[tier];
  return t.freeText && tick - lastSpoke >= t.every;
}

export interface ModelBrainOptions {
  /** Bearer token; null or empty sends no Authorization header (a keyless local server). */
  apiKey?: string | null;
  fetch?: FetchLike;
  /** The actor's model (default DEFAULT_LLM_MODEL). */
  model?: string;
  /** The planner's model (default `model`). */
  plannerModel?: string;
  /** An OpenAI-compatible API root (default DEFAULT_LLM_BASE_URL, OpenRouter). */
  baseUrl?: string;
  /** USD per 1M tokens when the provider returns no cost (default: DEFAULT_MODEL_PRICES for the default model). */
  prices?: LlmPrices | null;
  deadlineMs?: number;
  /** Where the once-per-model "no price" warning goes (default console.warn). */
  warn?: (msg: string) => void;
  /**
   * Hears every model call once it completes, ok or not, even when the caller stopped waiting
   * (a late actor reply still cost money). Errors it throws are swallowed.
   */
  onUsage?: (c: V2Call) => void;
}

export function createModelBrain(opts: ModelBrainOptions = {}): V2Brain {
  const fetch = opts.fetch ?? defaultFetch();
  const actorModel = opts.model ?? DEFAULT_LLM_MODEL;
  const plannerModel = opts.plannerModel ?? actorModel;
  const baseUrl = opts.baseUrl ?? DEFAULT_LLM_BASE_URL;
  const apiKey = opts.apiKey || null;

  const report = (c: V2Call) => {
    try {
      opts.onUsage?.(c);
    } catch {
      // usage reporting must never break a decision
    }
  };

  const call = async (role: V2Call['role'], system: string, user: string, maxTokens: number, deadline: number, chosen?: string | null) => {
    const model = role === 'planner' ? plannerModel : (chosen ?? actorModel);
    // Configured LLM_PRICE_* are the default model's; another catalog model is priced by its provider bill.
    const prices = model === actorModel || model === plannerModel ? opts.prices : null;
    const req = chatRequest({ baseUrl, apiKey, model, maxTokens, temperature: 0.4, system, user });
    const started = nowMs();
    const out = await runWithPolicy((signal) => postJson({ fetch, url: req.url, headers: req.headers, signal, body: req.body }), { timeLimitMs: deadline });
    const latencyMs = nowMs() - started;
    if (!out.ok) {
      const c: V2Call = { role, model, ok: false, latencyMs, inputTokens: 0, outputTokens: 0, costUsd: 0, error: out.reason };
      report(c);
      return { text: null, reason: out.reason, call: c };
    }
    const text = String(dig(out.value, 'choices', 0, 'message', 'content') ?? '');
    const c: V2Call = { role, model, ok: true, latencyMs, ...usageCost(out.value, model, pricesFor(model, prices), opts.warn) };
    report(c);
    return { text, reason: null, call: c };
  };

  return {
    kind: 'model',
    model: actorModel,
    async act(o, ctx) {
      const wait: Action = { type: 'wait' };
      // The system prompt numbers the non-blank skills whose trigger holds this tick; a SKILL line maps
      // back to ctx.skills.
      const numbered = ctx.skills.flatMap((t, i) => (t.trim() && skillTriggerHolds(ctx.skillTriggers?.[i], o) ? [i] : []));
      const r = await call('actor', systemPrompt(numbered.map((i) => ctx.skills[i]!), ctx.instructions, { text: ctx.playbook ?? null, short: true }), turnPrompt(o, ctx.plan, ctx.canSpeak, ctx.recent ?? [], ctx.command ?? null, numbered.length), V2_ACTOR_MAX_TOKENS, opts.deadlineMs ?? V2_ACTION_DEADLINE_MS, ctx.model);
      if (r.text === null) return { action: wait, reason: r.reason === 'timeout' ? 'timeout' : 'error', say: null, call: r.call };
      const parsed = parseReply(r.text, o.legal, ctx.canSpeak, numbered.length);
      const skill = parsed.action && parsed.skill ? numbered[parsed.skill - 1] : undefined;
      let say: V2Decision['say'] = null;
      let refusedSay: V2Decision['refusedSay'];
      if (parsed.say) {
        const f = filterSpeech(parsed.say.text, [...ctx.skills, ...(ctx.instructions ? [ctx.instructions] : []), ...(ctx.playbook ? [ctx.playbook] : [])]);
        if (f.ok) say = { channel: parsed.say.channel, text: f.text };
        else refusedSay = f.reason;
      }
      return {
        action: parsed.action ?? wait,
        reason: parsed.action ? 'chosen' : 'illegal',
        say,
        ...(refusedSay ? { refusedSay } : {}),
        ...(parsed.thought ? { thought: parsed.thought } : {}),
        ...(skill !== undefined ? { skill } : {}),
        call: r.call,
      };
    },
    async plan(o, ctx) {
      const r = await call('planner', systemPrompt(activeSkills(o, ctx), ctx.instructions, { text: ctx.playbook ?? null }), planPrompt(o, ctx.controlled ?? null), V2_PLANNER_MAX_TOKENS, V2_PLANNER_DEADLINE_MS);
      if (!r.text) return { text: null, why: null, call: r.call };
      const { plan, why } = parsePlan(r.text);
      return { text: plan, why, call: r.call };
    },
  };
}

export function createGreedyBrain(): V2Brain {
  return {
    kind: 'greedy',
    model: 'greedy',
    async act(o, ctx) {
      const action = greedyAct(o, ctx.command ?? null);
      const text = ctx.canSpeak ? greedySay(o, action) : null;
      return { action, reason: 'chosen', say: text ? { channel: 'team', text } : null, thought: greedyThought(o, action) };
    },
    async plan(o) {
      return greedyPlan(o);
    },
  };
}

export interface V2BrainOptions {
  /** See ModelBrainOptions.onUsage; the greedy brain makes no calls. */
  onUsage?: (c: V2Call) => void;
  /** See ModelBrainOptions.warn. */
  warn?: (msg: string) => void;
}

/**
 * The model brain when the environment selects it (v2BrainKind: LLM_API_KEY or OPENROUTER_API_KEY
 * set, or V2_BRAIN=model with a local LLM_BASE_URL; V2_BRAIN=greedy forces greedy), configured from
 * LLM_BASE_URL, LLM_MODEL, LLM_PLANNER_MODEL and the LLM_PRICE_* settings; else the offline greedy
 * brain. The second argument is a fetch (tests) or the options; `createV2Brain(env, fetch, opts)`
 * takes both.
 */
export function createV2Brain(env: LlmEnv, extra?: FetchLike | V2BrainOptions, opts: V2BrainOptions = {}): V2Brain {
  const fetch = typeof extra === 'function' ? extra : undefined;
  const o = typeof extra === 'object' ? { ...extra, ...opts } : opts;
  if (v2BrainKind(env) !== 'model') return createGreedyBrain();
  const s = llmSettings(env);
  return createModelBrain({
    apiKey: s.apiKey,
    baseUrl: s.baseUrl,
    model: s.model,
    plannerModel: s.plannerModel,
    prices: s.prices,
    ...(fetch ? { fetch } : {}),
    ...(o.onUsage ? { onUsage: o.onUsage } : {}),
    ...(o.warn ? { warn: o.warn } : {}),
  });
}
