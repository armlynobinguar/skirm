// Bring your own agent: the versioned JSON contract between skirm and a player's own program
// (docs/external-agents.md, `skirm.agent/v1`), its tokens and HMAC signatures, reply validation and
// the turn relay the pull api and realtime share.
//
// Each tick realtime builds one turn per external agent: the same fogged Observation (with its
// legal actions) and context the built-in brain gets. A webhook agent gets it as a signed POST; a
// pull agent finds it through the api (GET /agent/v1/turn) and answers with POST /agent/v1/action.
// The relay keeps the latest turn per external agent and the first answer per turn in Redis, so any
// api instance serves any realtime instance.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Action, Channel, CommandPreset, Observation } from '@skirm/engine/v2';
import type { Redis } from 'ioredis';
import { promptSha256 } from './vault';

/** The contract version every turn, ping and reply carries. A breaking change gets a new version. */
export const EXTERNAL_CONTRACT = 'skirm.agent/v1';

/** Context the built-in brain also gets, minus anything secret (skill text never leaves the vault). */
export interface ExternalTurnContext {
  /** Whether this agent's talk tier lets it speak this tick (a `say` is ignored otherwise). */
  canSpeak: boolean;
  /** The crew plan; null when there is none or the crew runs a bought skill (its plan stays hidden). */
  plan: string | null;
  /** Its last few actions with where it stood, oldest first. */
  recent: string[];
  /** A live command from its player still in force. */
  command: { preset: CommandPreset | null; order: string; ticksLeft: number } | null;
}

export interface ExternalTurn {
  contract: typeof EXTERNAL_CONTRACT;
  type: 'turn';
  /** Answer with this id (pull) or in reply to this request (webhook). */
  turnId: string;
  externalAgentId: string;
  matchId: string;
  /** The tick the action is for (observation.tick). */
  tick: number;
  agentId: string;
  /** How long the agent has to answer; after that the greedy brain plays the tick. */
  deadlineMs: number;
  /** ISO time the answer must arrive by. */
  expiresAt: string;
  observation: Observation;
  context: ExternalTurnContext;
}

export interface ExternalPing {
  contract: typeof EXTERNAL_CONTRACT;
  type: 'ping';
  externalAgentId: string;
  nonce: string;
  sentAt: string;
}

/** What the program answers: one of `observation.legal`, and optionally a line and its inner voice. */
export interface ExternalReply {
  action: Action;
  say?: { channel: Channel; text: string } | null;
  thought?: string | null;
}

/** The reply as JSON Schema (draft 2020-12), shipped in the docs and the MCP tool. */
export const EXTERNAL_REPLY_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://skirm.dev/schemas/skirm.agent/v1/reply.json',
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: {
    turnId: { type: 'string', description: 'pull api only: the turn being answered' },
    action: {
      description: 'exactly one entry of observation.legal',
      oneOf: [
        { type: 'object', required: ['type'], additionalProperties: false, properties: { type: { const: 'wait' } } },
        { type: 'object', required: ['type', 'dir'], additionalProperties: false, properties: { type: { const: 'move' }, dir: { enum: ['N', 'E', 'S', 'W'] } } },
        { type: 'object', required: ['type', 'verb'], additionalProperties: false, properties: { type: { const: 'verb' }, verb: { type: 'string' }, dir: { enum: ['N', 'E', 'S', 'W'] } } },
        { type: 'object', required: ['type'], additionalProperties: false, properties: { type: { const: 'switch' } } },
        {
          type: 'object',
          required: ['type', 'tool', 'dir'],
          additionalProperties: false,
          properties: { type: { const: 'use' }, tool: { enum: ['sandbag', 'pump', 'bridge'] }, dir: { enum: ['N', 'E', 'S', 'W'] } },
        },
      ],
    },
    say: {
      type: ['object', 'null'],
      required: ['channel', 'text'],
      additionalProperties: false,
      properties: { channel: { enum: ['team', 'say'] }, text: { type: 'string', minLength: 1, maxLength: 160 } },
    },
    thought: { type: ['string', 'null'], maxLength: 80 },
  },
} as const;

// ---------- Secrets and tokens ----------

/** A fresh signing secret: `sks_` + 32 random bytes, base64url. */
export function newExternalSecret(): string {
  return `sks_${randomBytes(32).toString('base64url')}`;
}

/** The bearer token a pull agent (and the MCP server) sends: `<externalAgentId>.<secret>`. */
export const externalAgentToken = (id: string, secret: string) => `${id}.${secret}`;

const TOKEN_RE = /^(ext_[0-9A-HJKMNP-TV-Z]{26})\.(sks_[A-Za-z0-9_-]{43})$/;

export function parseExternalAgentToken(token: string): { id: string; secret: string } | null {
  const m = TOKEN_RE.exec(token.trim());
  return m ? { id: m[1]!, secret: m[2]! } : null;
}

/** The stored hash of a secret: the vault's sha256 of `secret + "\n"` (it seals the secret with it). */
export const externalSecretSha256 = (secret: string) => promptSha256(secret);

/** Constant-time check of a presented secret against the stored hash. */
export function externalSecretMatches(secret: string, sha256Hex: string): boolean {
  const a = Buffer.from(externalSecretSha256(secret), 'hex');
  const b = Buffer.from(sha256Hex, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

// ---------- Signatures ----------

export const SIGNATURE_HEADER = 'x-skirm-signature';
/** A signature older or newer than this is refused (replay window). */
export const SIGNATURE_TOLERANCE_S = 300;

/** HMAC-SHA256 of `<unix seconds>.<raw body>` with the secret, as `t=<seconds>,v1=<hex>`. */
export function signExternalBody(secret: string, body: string, nowMs = Date.now()): string {
  const t = Math.floor(nowMs / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

/**
 * What an agent runs on every webhook request: the header must carry a v1 signature of this exact
 * raw body, made with its secret, within the tolerance. Constant-time.
 */
export function verifyExternalSignature(secret: string, header: string | null | undefined, body: string, opts: { nowMs?: number; toleranceS?: number } = {}): boolean {
  if (!header) return false;
  const parts = new Map<string, string>();
  for (const p of header.split(',')) {
    const i = p.indexOf('=');
    if (i > 0) parts.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1');
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - t) > (opts.toleranceS ?? SIGNATURE_TOLERANCE_S)) return false;
  const want = createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest();
  return timingSafeEqual(want, Buffer.from(v1, 'hex'));
}

// ---------- Replies ----------

export type ParsedReply = { ok: true; reply: ExternalReply } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Two actions are the same move (key order and absent fields aside). */
export function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'move' && b.type === 'move') return a.dir === b.dir;
  if (a.type === 'verb' && b.type === 'verb') return a.verb === b.verb && (a.dir ?? null) === (b.dir ?? null);
  if (a.type === 'use' && b.type === 'use') return a.tool === b.tool && a.dir === b.dir;
  return true;
}

/**
 * Checks a reply against the turn: the action must be one of `legal` (the legal entry is returned,
 * never the program's object), a line needs `canSpeak` (otherwise it is dropped, not an error) and
 * stays within 160 characters, the inner voice is cut to 80.
 */
export function parseExternalReply(v: unknown, legal: readonly Action[], canSpeak: boolean): ParsedReply {
  if (!isObj(v)) return { ok: false, error: 'reply must be a JSON object' };
  const a = v.action;
  if (!isObj(a) || typeof a.type !== 'string') return { ok: false, error: 'reply.action must be an action object' };
  const wanted = { ...a } as Action;
  const action = legal.find((l) => sameAction(l, wanted));
  if (!action) return { ok: false, error: 'reply.action is not one of observation.legal' };
  const reply: ExternalReply = { action };
  if (v.say !== undefined && v.say !== null) {
    const s = v.say;
    if (!isObj(s) || (s.channel !== 'team' && s.channel !== 'say') || typeof s.text !== 'string') return { ok: false, error: "reply.say must be {channel: 'team'|'say', text}" };
    const text = s.text.replace(/\s+/g, ' ').trim();
    if ([...text].length > 160) return { ok: false, error: 'reply.say.text is at most 160 characters' };
    if (canSpeak && text) reply.say = { channel: s.channel, text };
  }
  if (typeof v.thought === 'string' && v.thought.trim()) reply.thought = [...v.thought.replace(/\s+/g, ' ').trim()].slice(0, 80).join('');
  return { ok: true, reply };
}

// ---------- Turn relay (pull) ----------

/** Redis keys of the relay. */
export const externalTurnKey = (externalAgentId: string) => `ext:turn:${externalAgentId}`;
export const externalReplyKey = (turnId: string) => `ext:reply:${turnId}`;

export type SubmitResult = 'ok' | 'stale' | 'duplicate';

export interface ExternalTurnStore {
  /** Makes `turn` the agent's current turn for `ttlMs`. */
  publish(turn: ExternalTurn, ttlMs: number): Promise<void>;
  /** The agent's current turn, if one is open. */
  current(externalAgentId: string): Promise<ExternalTurn | null>;
  /** Stores the first answer to the agent's current turn; a later turn makes it `stale`. */
  submit(externalAgentId: string, turnId: string, reply: ExternalReply, ttlMs: number): Promise<SubmitResult>;
  /** The answer to a turn, once there is one. */
  reply(turnId: string): Promise<ExternalReply | null>;
}

/** The relay in memory (tests, and a single-process dev run). TTLs are kept against `now`. */
export class MemoryExternalTurnStore implements ExternalTurnStore {
  private readonly turns = new Map<string, { turn: ExternalTurn; until: number }>();
  private readonly replies = new Map<string, { reply: ExternalReply; until: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  async publish(turn: ExternalTurn, ttlMs: number): Promise<void> {
    this.turns.set(turn.externalAgentId, { turn, until: this.now() + ttlMs });
  }

  async current(id: string): Promise<ExternalTurn | null> {
    const t = this.turns.get(id);
    return t && t.until > this.now() ? t.turn : null;
  }

  async submit(id: string, turnId: string, reply: ExternalReply, ttlMs: number): Promise<SubmitResult> {
    const cur = await this.current(id);
    if (!cur || cur.turnId !== turnId) return 'stale';
    const prev = this.replies.get(turnId);
    if (prev && prev.until > this.now()) return 'duplicate';
    this.replies.set(turnId, { reply, until: this.now() + ttlMs });
    return 'ok';
  }

  async reply(turnId: string): Promise<ExternalReply | null> {
    const r = this.replies.get(turnId);
    return r && r.until > this.now() ? r.reply : null;
  }
}

type RelayRedis = Pick<Redis, 'get' | 'set'>;

/** The relay in Redis: `ext:turn:<id>` (latest turn) and `ext:reply:<turnId>` (first answer, SET NX). */
export class RedisExternalTurnStore implements ExternalTurnStore {
  constructor(private readonly redis: RelayRedis) {}

  async publish(turn: ExternalTurn, ttlMs: number): Promise<void> {
    await this.redis.set(externalTurnKey(turn.externalAgentId), JSON.stringify(turn), 'PX', Math.max(1, Math.round(ttlMs)));
  }

  async current(id: string): Promise<ExternalTurn | null> {
    const raw = await this.redis.get(externalTurnKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ExternalTurn;
    } catch {
      return null;
    }
  }

  async submit(id: string, turnId: string, reply: ExternalReply, ttlMs: number): Promise<SubmitResult> {
    const cur = await this.current(id);
    if (!cur || cur.turnId !== turnId) return 'stale';
    const r = await this.redis.set(externalReplyKey(turnId), JSON.stringify(reply), 'PX', Math.max(1, Math.round(ttlMs)), 'NX');
    return r === 'OK' ? 'ok' : 'duplicate';
  }

  async reply(turnId: string): Promise<ExternalReply | null> {
    const raw = await this.redis.get(externalReplyKey(turnId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ExternalReply;
    } catch {
      return null;
    }
  }
}
