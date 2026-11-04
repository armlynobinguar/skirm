// Bring your own agent: the brain of an agent its player's own program plays (docs/external-agents.md).
// Each tick it builds the `skirm.agent/v1` turn (the fogged Observation with its legal actions and
// the context the built-in brain gets, never skill text) and asks the program: a signed POST to its
// webhook (SSRF-safe, size-limited), or a turn on the relay that the program pulls through the api.
// No answer within the timeout (DEFAULTS.external.timeoutMs, under the 1.5 s action deadline), an
// error or an answer that is not one of the legal actions is a miss: the greedy brain plays that tick
// and the miss is logged and counted. Lines it says pass the same leak and abuse filter as a model's.
import { createGreedyBrain, filterSpeech, greedyPlan, type V2AgentContext, type V2Brain, type V2Decision } from '@skirm/decision-engine/v2';
import type { Observation } from '@skirm/engine/v2';
import {
  EXTERNAL_CONTRACT,
  ExternalHttpError,
  SIGNATURE_HEADER,
  parseExternalReply,
  safePostJson,
  signExternalBody,
  type ExternalTurn,
  type ExternalTurnStore,
} from '@skirm/server';
import { DEFAULTS } from '@skirm/shared';
import type { Logger } from '../deps';
import type { Scheduler } from '../timing';

/** POSTs a signed JSON body to a webhook and resolves with the reply text (safePostJson in production). */
export type WebhookPost = (url: string, body: string, headers: Record<string, string>, opts: { timeoutMs: number; maxBytes: number }) => Promise<string>;

export const defaultWebhookPost: WebhookPost = async (url, body, headers, opts) => (await safePostJson(url, body, { ...opts, headers })).body;

export interface ExternalBrainOptions {
  /** The external agent's id and webhook (null: it pulls turns from the api). */
  agent: { id: string; webhookUrl: string | null };
  /** Its signing secret (webhook requests are HMAC-signed with it). */
  secret: string;
  matchId: string;
  timeoutMs?: number;
  /** The pull relay; without one a pull agent misses every tick. */
  turns?: ExternalTurnStore;
  post?: WebhookPost;
  scheduler: Scheduler;
  log: Logger;
  /** How often a pull answer is looked for (default 50 ms). */
  pollMs?: number;
  /** The crew runs a bought skill: its plan is withheld from the turn like from the crew's frames. */
  hidePlan?: boolean;
}

/** One match's numbers for this external agent (ExternalAgentsRepo.recordUsage). */
export interface ExternalUsage {
  calls: number;
  misses: number;
  lastError: string | null;
  seen: boolean;
}

/** Miss lines logged per match before only every 25th is (a pull agent that never comes would log 150). */
const LOG_FIRST_MISSES = 3;

export class ExternalBrain implements V2Brain {
  readonly kind = 'external' as const;
  readonly model: string;
  readonly usage: ExternalUsage = { calls: 0, misses: 0, lastError: null, seen: false };
  private readonly greedy = createGreedyBrain();
  private readonly timeoutMs: number;

  constructor(private readonly opts: ExternalBrainOptions) {
    this.model = `external:${opts.agent.id}`;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.external.timeoutMs;
  }

  get id(): string {
    return this.opts.agent.id;
  }

  async act(o: Observation, ctx: V2AgentContext): Promise<V2Decision> {
    const turn = this.turn(o, ctx);
    this.usage.calls++;
    let raw: unknown;
    try {
      raw = await this.within(this.opts.agent.webhookUrl ? this.webhook(turn) : this.pull(turn), this.timeoutMs);
    } catch (err) {
      return this.miss(o, ctx, err instanceof ExternalHttpError ? (err.code === 'timeout' ? 'timeout' : `error: ${err.code}`) : err instanceof Timeout ? 'timeout' : 'error');
    }
    const parsed = parseExternalReply(raw, o.legal, ctx.canSpeak);
    if (!parsed.ok) return this.miss(o, ctx, `invalid: ${parsed.error}`);
    this.usage.seen = true;
    const { reply } = parsed;
    let say: V2Decision['say'] = null;
    let refusedSay: V2Decision['refusedSay'];
    if (reply.say) {
      const secrets = ctx.instructions ? [...ctx.skills, ctx.instructions] : ctx.skills;
      const f = filterSpeech(reply.say.text, secrets);
      if (f.ok) say = { channel: reply.say.channel, text: f.text };
      else refusedSay = f.reason;
    }
    return { action: reply.action, reason: 'chosen', say, ...(refusedSay ? { refusedSay } : {}), ...(reply.thought ? { thought: reply.thought } : {}) };
  }

  /** External agents do not plan: the crew plan comes from the crew's own brain. */
  async plan(o: Observation) {
    return greedyPlan(o);
  }

  /** The turn as the contract defines it. */
  turn(o: Observation, ctx: V2AgentContext): ExternalTurn {
    const { agent, matchId } = this.opts;
    const c = ctx.command ?? null;
    return {
      contract: EXTERNAL_CONTRACT,
      type: 'turn',
      turnId: `${matchId}.${o.tick}.${o.me.id}`,
      externalAgentId: agent.id,
      matchId,
      tick: o.tick,
      agentId: o.me.id,
      deadlineMs: this.timeoutMs,
      expiresAt: new Date(this.opts.scheduler.now() + this.timeoutMs).toISOString(),
      observation: o,
      context: {
        canSpeak: ctx.canSpeak,
        plan: this.opts.hidePlan ? null : ctx.plan,
        recent: [...(ctx.recent ?? [])],
        command: c ? { preset: c.preset, order: c.order, ticksLeft: c.ticksLeft } : null,
      },
    };
  }

  private async webhook(turn: ExternalTurn): Promise<unknown> {
    const body = JSON.stringify(turn);
    const post = this.opts.post ?? defaultWebhookPost;
    const text = await post(
      this.opts.agent.webhookUrl!,
      body,
      { [SIGNATURE_HEADER]: signExternalBody(this.opts.secret, body, this.opts.scheduler.now()), 'x-skirm-agent': this.opts.agent.id, 'x-skirm-contract': EXTERNAL_CONTRACT },
      { timeoutMs: this.timeoutMs, maxBytes: DEFAULTS.external.maxResponseBytes },
    );
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  private async pull(turn: ExternalTurn): Promise<unknown> {
    const { turns, scheduler } = this.opts;
    if (!turns) throw new Error('no turn relay');
    // The turn stays readable a little past its deadline so a slow program still sees it went by.
    await turns.publish(turn, this.timeoutMs + 1000);
    const stopAt = scheduler.now() + this.timeoutMs;
    const every = this.opts.pollMs ?? 50;
    for (;;) {
      const r = await turns.reply(turn.turnId);
      if (r) return r;
      if (scheduler.now() >= stopAt) throw new Timeout();
      await new Promise<void>((res) => scheduler.setTimeout(res, every));
    }
  }

  private within<T>(p: Promise<T>, ms: number): Promise<T> {
    const s = this.opts.scheduler;
    return new Promise<T>((resolve, reject) => {
      const h = s.setTimeout(() => reject(new Timeout()), ms);
      p.then(
        (v) => (s.clearTimeout(h), resolve(v)),
        (e: unknown) => (s.clearTimeout(h), reject(e)),
      );
    });
  }

  private async miss(o: Observation, ctx: V2AgentContext, reason: string): Promise<V2Decision> {
    const n = ++this.usage.misses;
    this.usage.lastError = reason;
    if (n <= LOG_FIRST_MISSES || n % 25 === 0)
      this.opts.log.warn(`v2 match ${this.opts.matchId}: external agent ${this.opts.agent.id} missed tick ${o.tick} (${reason}); greedy played it [miss ${n}]`);
    return this.greedy.act(o, ctx);
  }
}

class Timeout extends Error {
  constructor() {
    super('timeout');
  }
}

export const isExternalBrain = (b: V2Brain | null | undefined): b is ExternalBrain => b instanceof ExternalBrain;
