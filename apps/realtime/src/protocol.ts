// WebSocket protocol on /ws (docs/backend-contract.md, WebSocket). Every client message is checked
// here before the hub acts on it; anything else gets `{type:'error', code, message}`.
import { isCommandPreset, isDifficulty } from '@skirm/engine/v2';
import { DEFAULTS } from '@skirm/shared';
import {
  isV2Opponent,
  type V2ClientMessage,
  type V2CrewEntry,
  type V2ServerMessage,
  type WsClientMessage as ServerWsClientMessage,
  type WsServerMessage as ServerWsServerMessage,
} from '@skirm/server';

/** What a client may send: sign in, then the v2_* messages. */
export type WsClientMessage = Extract<ServerWsClientMessage, { type: 'auth' }> | V2ClientMessage;
/** What realtime sends: queue_status while searching, errors, and the v2_* messages. */
export type WsServerMessage = Extract<ServerWsServerMessage, { type: 'queue_status' | 'error' }> | V2ServerMessage;

/** Largest frame a client may send (a v2_queue with 3 agents is well under 1 KB). */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;

export type ErrorCode =
  | 'bad_json'
  | 'rate_limited'
  | 'bad_message'
  | 'unknown_type'
  | 'too_large'
  | 'unauthenticated'
  | 'auth_failed'
  | 'already_authenticated'
  | 'already_queued'
  | 'not_queued'
  | 'in_match'
  | 'invalid_crew'
  | 'not_in_lockin'
  | 'practice_unranked'
  | 'external_unranked'
  | 'draft_casual'
  | 'not_your_turn'
  | 'invalid_ban'
  | 'agent_busy'
  | 'not_found'
  | 'lobby_closed'
  | 'not_live'
  | 'no_commands'
  | 'invalid_command'
  | 'command_refused'
  | 'too_many_subscriptions'
  | 'unavailable'
  | 'internal';

export class ProtocolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export type ParseResult =
  { ok: true; msg: WsClientMessage } | { ok: false; code: ErrorCode; message: string };

/** Agent, match and map ids: server ids (`agt_…`, `mat_…`) or anything id-shaped, ≤ 64 chars. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function parseV2Crew(v: unknown): V2CrewEntry[] | string {
  if (!Array.isArray(v) || v.length < 1 || v.length > 3) return 'crew must have 1 to 3 agents';
  const out: V2CrewEntry[] = [];
  for (const [i, e] of v.entries()) {
    if (!isObj(e) || extraKeys(e, ['agentId', 'tier'])) return `crew[${i}] is {agentId, tier}`;
    if (typeof e.agentId !== 'string' || !ID_RE.test(e.agentId)) return `crew[${i}].agentId must be an id`;
    if (!TIERS.includes(e.tier as never)) return `crew[${i}].tier must be quiet, standard or open`;
    if (out.some((x) => x.agentId === e.agentId)) return 'an agent is listed twice';
    out.push({ agentId: e.agentId, tier: e.tier as V2CrewEntry['tier'] });
  }
  return out;
}

const TYPES = [
  'auth',
  'v2_queue',
  'v2_cancel_queue',
  'v2_accept',
  'v2_decline',
  'v2_lock_in',
  'v2_watch',
  'v2_unwatch',
  'v2_replay',
  'v2_lobby_ready',
  'v2_command',
  'v2_ban',
] as const;
const TIERS = ['quiet', 'standard', 'open'] as const;

const bad = (message: string): ParseResult => ({ ok: false, code: 'bad_message', message });
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function extraKeys(o: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(o).find((k) => !allowed.includes(k));
}

/** Parses one text frame from a client. Never throws. */
export function parseClientMessage(raw: unknown): ParseResult {
  let text: string;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof Buffer) text = raw.toString('utf8');
  else if (Array.isArray(raw)) text = Buffer.concat(raw as Buffer[]).toString('utf8');
  else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString('utf8');
  else return bad('message must be a JSON text frame');
  if (Buffer.byteLength(text) > MAX_CLIENT_MESSAGE_BYTES)
    return { ok: false, code: 'too_large', message: 'message is too large' };

  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, code: 'bad_json', message: 'message is not JSON' };
  }
  if (!isObj(v)) return bad('message must be a JSON object');
  const type = v.type;
  if (typeof type !== 'string') return bad('message needs a string "type"');
  if (!(TYPES as readonly string[]).includes(type))
    return { ok: false, code: 'unknown_type', message: `unknown message type` };

  switch (type as (typeof TYPES)[number]) {
    case 'auth': {
      const extra = extraKeys(v, ['type', 'token', 'devUser', 'agentToken']);
      if (extra) return bad('auth takes {token?, devUser?, agentToken?}');
      const msg: WsClientMessage = { type: 'auth' };
      if (v.token !== undefined && v.token !== null) {
        if (typeof v.token !== 'string' || !v.token || v.token.length > 8192)
          return bad('auth.token must be a non-empty string');
        msg.token = v.token;
      }
      if (v.devUser !== undefined && v.devUser !== null) {
        if (typeof v.devUser !== 'string' || !v.devUser || v.devUser.length > 64)
          return bad('auth.devUser must be a non-empty string');
        msg.devUser = v.devUser;
      }
      if (v.agentToken !== undefined && v.agentToken !== null) {
        if (typeof v.agentToken !== 'string' || !v.agentToken || v.agentToken.length > 256)
          return bad('auth.agentToken must be a non-empty string');
        if (msg.token || msg.devUser) return bad('auth.agentToken signs in on its own');
        msg.agentToken = v.agentToken;
      }
      if (!msg.token && !msg.devUser && !msg.agentToken) return bad('auth needs token, devUser or agentToken');
      return { ok: true, msg };
    }
    case 'v2_queue': {
      if (extraKeys(v, ['type', 'crew', 'ranked', 'mapId', 'difficulty', 'opponent', 'draft']))
        return bad('v2_queue takes {crew, ranked, mapId?, difficulty?, opponent?, draft?}');
      if (typeof v.ranked !== 'boolean') return bad('v2_queue.ranked must be a boolean');
      const practice = v.opponent !== undefined && v.opponent !== null;
      if (practice && !isV2Opponent(v.opponent)) return bad("v2_queue.opponent must be 'bot'");
      if (practice && v.ranked) return { ok: false, code: 'practice_unranked', message: 'practice against the bot is casual only' };
      if (v.draft !== undefined && v.draft !== null && typeof v.draft !== 'boolean') return bad('v2_queue.draft must be a boolean');
      const draft = v.draft === true;
      if (draft && (v.ranked || practice)) return { ok: false, code: 'draft_casual', message: 'draft mode is a casual queue against another player' };
      const crew = parseV2Crew(v.crew);
      if (typeof crew === 'string') return bad(crew);
      const msg: Extract<WsClientMessage, { type: 'v2_queue' }> = { type: 'v2_queue', crew, ranked: v.ranked };
      if (v.mapId !== undefined && v.mapId !== null) {
        if (typeof v.mapId !== 'string' || !ID_RE.test(v.mapId)) return bad('v2_queue.mapId must be a map id');
        msg.mapId = v.mapId;
      }
      if (v.difficulty !== undefined && v.difficulty !== null) {
        if (!isDifficulty(v.difficulty)) return bad('v2_queue.difficulty must be easy, normal, hard, agentic or mega');
        msg.difficulty = v.difficulty;
      }
      if (practice) msg.opponent = 'bot';
      if (draft) msg.draft = true;
      return { ok: true, msg };
    }
    case 'v2_cancel_queue': {
      if (extraKeys(v, ['type'])) return bad('v2_cancel_queue takes no fields');
      return { ok: true, msg: { type: 'v2_cancel_queue' } };
    }
    case 'v2_accept':
    case 'v2_decline':
    case 'v2_watch':
    case 'v2_unwatch':
    case 'v2_replay': {
      const t = type as 'v2_accept' | 'v2_decline' | 'v2_watch' | 'v2_unwatch' | 'v2_replay';
      if (extraKeys(v, ['type', 'matchId'])) return bad(`${t} takes {matchId}`);
      if (typeof v.matchId !== 'string' || !ID_RE.test(v.matchId)) return bad(`${t}.matchId must be an id`);
      return { ok: true, msg: { type: t, matchId: v.matchId } };
    }
    case 'v2_command': {
      if (extraKeys(v, ['type', 'matchId', 'agentId', 'preset', 'text'])) return bad('v2_command takes {matchId, agentId?, preset?, text?}');
      if (typeof v.matchId !== 'string' || !ID_RE.test(v.matchId)) return bad('v2_command.matchId must be an id');
      const msg: Extract<WsClientMessage, { type: 'v2_command' }> = { type: 'v2_command', matchId: v.matchId };
      if (v.agentId !== undefined && v.agentId !== null) {
        if (typeof v.agentId !== 'string' || !ID_RE.test(v.agentId)) return bad('v2_command.agentId must be an id');
        msg.agentId = v.agentId;
      }
      if (v.preset !== undefined && v.preset !== null) {
        if (!isCommandPreset(v.preset)) return bad('v2_command.preset must be hold_gate, go_drop, regroup or block_flow');
        msg.preset = v.preset;
      }
      if (v.text !== undefined && v.text !== null) {
        const max = DEFAULTS.commands.maxChars;
        if (typeof v.text !== 'string' || [...v.text].length > max) return bad(`v2_command.text must be a string of at most ${max} characters`);
        if (v.text.trim()) msg.text = v.text;
      }
      if (!msg.preset && !msg.text) return bad('v2_command needs a preset or text');
      return { ok: true, msg };
    }
    case 'v2_ban': {
      if (extraKeys(v, ['type', 'matchId', 'skillId'])) return bad('v2_ban takes {matchId, skillId}');
      if (typeof v.matchId !== 'string' || !ID_RE.test(v.matchId)) return bad('v2_ban.matchId must be an id');
      if (v.skillId !== null && (typeof v.skillId !== 'string' || !ID_RE.test(v.skillId))) return bad('v2_ban.skillId must be a skill id, or null to pass');
      return { ok: true, msg: { type: 'v2_ban', matchId: v.matchId, skillId: v.skillId } };
    }
    case 'v2_lock_in': {
      if (extraKeys(v, ['type', 'matchId', 'tiers', 'crew', 'playbookId'])) return bad('v2_lock_in takes {matchId, tiers, crew?, playbookId?}');
      if (typeof v.matchId !== 'string' || !ID_RE.test(v.matchId)) return bad('v2_lock_in.matchId must be an id');
      if (!Array.isArray(v.tiers) || v.tiers.length > 3 || !v.tiers.every((t) => TIERS.includes(t as never)))
        return bad('v2_lock_in.tiers must list at most 3 talk tiers');
      const msg: Extract<WsClientMessage, { type: 'v2_lock_in' }> = { type: 'v2_lock_in', matchId: v.matchId, tiers: v.tiers as V2CrewEntry['tier'][] };
      if (v.crew !== undefined && v.crew !== null) {
        const crew = parseV2Crew(v.crew);
        if (typeof crew === 'string') return bad(`v2_lock_in.${crew}`);
        msg.crew = crew;
      }
      if (v.playbookId !== undefined) {
        if (v.playbookId !== null && (typeof v.playbookId !== 'string' || !ID_RE.test(v.playbookId))) return bad('v2_lock_in.playbookId must be a playbook id, or null for none');
        msg.playbookId = v.playbookId;
      }
      return { ok: true, msg };
    }
    case 'v2_lobby_ready': {
      if (extraKeys(v, ['type', 'lobbyId', 'crew'])) return bad('v2_lobby_ready takes {lobbyId, crew}');
      if (typeof v.lobbyId !== 'string' || !ID_RE.test(v.lobbyId)) return bad('v2_lobby_ready.lobbyId must be an id');
      const crew = parseV2Crew(v.crew);
      if (typeof crew === 'string') return bad(`v2_lobby_ready.${crew}`);
      return { ok: true, msg: { type: 'v2_lobby_ready', lobbyId: v.lobbyId, crew } };
    }
  }
}

export function errorMessage(code: ErrorCode | string, message: string): WsServerMessage {
  return { type: 'error', code, message };
}
