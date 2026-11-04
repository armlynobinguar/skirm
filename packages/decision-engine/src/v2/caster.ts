// The replay caster: one short, punchy commentary line per highlight (engine detectHighlights).
// - template: deterministic and offline, from the highlight's kind and public facts.
// - model: Haiku 5.5 through OpenRouter writes every line of a match in one call, given only the
//   public facts (map, crew names, what happened). Any line it misses, or that the filter refuses,
//   falls back to the template line, and so does the whole match when the call fails.
// The caller caches the result per match, so a match is cast at most once. Nobody is charged for it:
// it is platform spend, reported through onUsage like the brain's calls.
import type { ReplayHighlight, Team } from '@skirm/engine/v2';
import { HAIKU_OPENROUTER_MODEL, OPENROUTER_BASE_URL, PRICES } from '../config';
import { defaultFetch, dig, num, postJson, type FetchLike } from '../http';
import { runWithPolicy } from '../policy';
import { nowMs } from '../usage';
import type { V2Call } from './brain';
import { filterSpeech } from './filter';

/** A caster line is at most this long. */
export const CASTER_LINE_MAX = 110;
export const CASTER_MAX_TOKENS = 400;
export const CASTER_DEADLINE_MS = 8000;

export interface CastInput {
  mapName: string;
  crews: Record<Team, string>;
  highlights: readonly ReplayHighlight[];
}

export interface CastResult {
  /** A line per highlight id. */
  lines: Record<string, string>;
  /** Who wrote the lines: 'model' when the model's call answered, else 'template'. */
  caster: 'model' | 'template';
  model: string | null;
  costUsd: number;
}

export interface Caster {
  readonly kind: 'model' | 'template';
  cast(input: CastInput): Promise<CastResult>;
}

const PICK: Record<ReplayHighlight['kind'], ((h: ReplayHighlight, c: Record<Team, string>) => string)[]> = {
  goal: [
    (h) => `${h.title}! ${h.score.A} to ${h.score.B}, and the crowd knows it.`,
    (h) => `There it is: ${h.title}. ${h.score.A}–${h.score.B}.`,
    (h) => `${h.title}, clean as you like. ${h.score.A}–${h.score.B} on the board.`,
  ],
  switch_flood: [
    (h) => `${h.title}! Somebody bring a bucket.`,
    (h) => `Lever down, water up: ${h.title.toLowerCase()}.`,
    (h) => `${h.title}. That is cold, calculated plumbing.`,
  ],
  drop_fight: [
    (h) => `${h.title}! Elbows out over that crate.`,
    (h) => `Supply drop scramble, and ${h.title.toLowerCase()}.`,
    (h) => `Everyone wanted that drop. ${h.title}.`,
  ],
  lead_change: [
    (h) => `${h.title}! ${h.score.A}–${h.score.B} and the map flips.`,
    (h) => `Swing! ${h.title}, ${h.score.A}–${h.score.B}.`,
    (h) => `${h.title}. Nobody saw that coming at ${h.score.A}–${h.score.B}.`,
  ],
};

/** A stable small hash, so the same highlight always gets the same template line. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const clip = (s: string) => (s.length <= CASTER_LINE_MAX ? s : `${s.slice(0, CASTER_LINE_MAX - 1).trimEnd()}…`);

/** The template caster's line for one highlight: deterministic per highlight. */
export function templateLine(h: ReplayHighlight, crews: Record<Team, string>): string {
  const opts = PICK[h.kind];
  return clip(opts[hash(h.id) % opts.length]!(h, crews));
}

function templateLines(input: CastInput): Record<string, string> {
  return Object.fromEntries(input.highlights.map((h) => [h.id, templateLine(h, input.crews)]));
}

export function createTemplateCaster(): Caster {
  return {
    kind: 'template',
    async cast(input) {
      return { lines: templateLines(input), caster: 'template', model: null, costUsd: 0 };
    },
  };
}

/** The model's prompt: public facts only. Exported for tests. */
export function casterPrompt(input: CastInput): { system: string; user: string } {
  const system =
    'You are the play-by-play caster for skirm, a game where two crews of AI agents race to deliver items on a shared map with spreading water, fire and lava. ' +
    `Write one short, punchy, family-friendly commentary line per highlight, at most ${CASTER_LINE_MAX - 20} characters, present tense, no emojis, no hashtags, no quotes. ` +
    'Use only the facts given; never invent names, numbers or strategies. ' +
    'Answer with exactly one line per highlight in the form `<id>: <line>` and nothing else.';
  const user = [
    `Map: ${input.mapName}. Crew A: ${input.crews.A}. Crew B: ${input.crews.B}.`,
    'Highlights:',
    ...input.highlights.map((h) => `${h.id} (tick ${h.tick}): ${h.facts}`),
  ].join('\n');
  return { system, user };
}

/** `<id>: <line>` replies, by id; lines for unknown ids are ignored. */
export function parseCasterReply(text: string, ids: readonly string[]): Record<string, string> {
  const want = new Set(ids);
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const m = /^\s*[-*]?\s*`?([a-z_]+-\d+)`?\s*[:\-–]\s*(.+)$/.exec(raw);
    if (!m || !want.has(m[1]!) || out[m[1]!]) continue;
    const line = m[2]!.trim().replace(/^["'“]+|["'”]+$/g, '').trim();
    if (line) out[m[1]!] = clip(line);
  }
  return out;
}

export interface ModelCasterOptions {
  apiKey: string;
  fetch?: FetchLike;
  model?: string;
  baseUrl?: string;
  deadlineMs?: number;
  /** Hears the call once it completes, ok or not (platform spend). Errors it throws are swallowed. */
  onUsage?: (c: V2Call) => void;
}

export function createModelCaster(opts: ModelCasterOptions): Caster {
  const fetch = opts.fetch ?? defaultFetch();
  const model = opts.model ?? HAIKU_OPENROUTER_MODEL;
  const url = `${opts.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`;
  const report = (c: V2Call) => {
    try {
      opts.onUsage?.(c);
    } catch {
      // usage reporting must never break a cast
    }
  };
  return {
    kind: 'model',
    async cast(input) {
      const fallback = templateLines(input);
      if (!input.highlights.length) return { lines: {}, caster: 'template', model: null, costUsd: 0 };
      const { system, user } = casterPrompt(input);
      const started = nowMs();
      const out = await runWithPolicy(
        (signal) =>
          postJson({
            fetch,
            url,
            headers: { Authorization: `Bearer ${opts.apiKey}`, 'X-Title': 'skirm' },
            signal,
            body: { model, max_tokens: CASTER_MAX_TOKENS, temperature: 0.8, reasoning: { enabled: false }, usage: { include: true }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
          }),
        { timeLimitMs: opts.deadlineMs ?? CASTER_DEADLINE_MS },
      );
      const latencyMs = nowMs() - started;
      if (!out.ok) {
        report({ role: 'planner', model, ok: false, latencyMs, inputTokens: 0, outputTokens: 0, costUsd: 0, error: out.reason });
        return { lines: fallback, caster: 'template', model: null, costUsd: 0 };
      }
      const inputTokens = num(dig(out.value, 'usage', 'prompt_tokens'));
      const outputTokens = num(dig(out.value, 'usage', 'completion_tokens'));
      const billed = dig(out.value, 'usage', 'cost');
      const costUsd = typeof billed === 'number' && Number.isFinite(billed) ? billed : (inputTokens * PRICES.haiku.input + outputTokens * PRICES.haiku.output) / 1e6;
      report({ role: 'planner', model, ok: true, latencyMs, inputTokens, outputTokens, costUsd, ...(typeof billed === 'number' ? { billed: true } : {}) });
      const said = parseCasterReply(String(dig(out.value, 'choices', 0, 'message', 'content') ?? ''), input.highlights.map((h) => h.id));
      const lines: Record<string, string> = {};
      for (const h of input.highlights) {
        const t = said[h.id];
        const f = t ? filterSpeech(t, []) : null;
        lines[h.id] = f?.ok ? clip(f.text) : fallback[h.id]!;
      }
      return { lines, caster: Object.keys(said).length ? 'model' : 'template', model: Object.keys(said).length ? model : null, costUsd };
    },
  };
}
