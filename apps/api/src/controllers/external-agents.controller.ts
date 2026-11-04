// Bring your own agent (docs/external-agents.md).
// /external-agents*: a player registers their own program, binds it to one of their agents, rotates
// its secret and test-pings its webhook. The secret (and the `<id>.<secret>` token built from it) is
// shown once, at creation and at each rotation; skirm keeps it sealed by the vault, because realtime
// signs every webhook request with it.
// /agent/v1/*: the pull api a program without a webhook (or the MCP server) plays through, signed in
// with its token: read the current turn, answer it, list its player's matches.
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { sealedSecretOf, type AccountRow, type ExternalAgentRow } from '@skirm/db';
import {
  EXTERNAL_CONTRACT,
  ExternalHttpError,
  SIGNATURE_HEADER,
  checkWebhookUrl,
  externalAgentToken,
  externalSecretMatches,
  newExternalSecret,
  parseExternalAgentToken,
  parseExternalReply,
  safePostJson,
  signExternalBody,
  type ExternalPing,
  type ExternalTurn,
} from '@skirm/server';
import { DEFAULTS } from '@skirm/shared';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CurrentAccount, Public, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { agentId, intQuery, parse } from '../validation';
import { myMatchView } from '../views';
import { idOr404 } from './util';

const externalId = z.string().regex(/^ext_[0-9A-HJKMNP-TV-Z]{26}$/);
const name = z.string().trim().min(1).max(40);
const webhookUrl = z.string().trim().max(2048).nullable();

const createBody = z.object({ name, agentId: agentId.nullable().optional(), webhookUrl: webhookUrl.optional() });
const patchBody = z
  .object({ name: name.optional(), agentId: agentId.nullable().optional(), webhookUrl: webhookUrl.optional() })
  .refine((b) => b.name !== undefined || b.agentId !== undefined || b.webhookUrl !== undefined, 'nothing to change');

const turnQuery = z.object({
  /** Long poll: wait up to this long for a turn (0: answer at once). */
  waitMs: intQuery(0, 25_000, 0),
  /** Wait for a turn other than this one (the one already answered). */
  after: z.string().max(200).optional(),
});

const actionBody = z.object({ turnId: z.string().min(1).max(200) }).passthrough();
const matchesQuery = z.object({ limit: intQuery(1, 50, 10) });

/** How long a ping waits for the webhook. */
export const PING_TIMEOUT_MS = 5000;
/** How often a long poll looks at the relay. */
const POLL_MS = 100;
/** How long an answer is kept for realtime to pick up. */
const REPLY_TTL_MS = 10_000;

/** A stored webhook URL: https to a public host (the addresses are checked again on every call). */
function webhookOrNull(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  if (!raw) return null;
  try {
    return checkWebhookUrl(raw).toString();
  } catch (err) {
    throw new ApiError(422, 'invalid_webhook', err instanceof ExternalHttpError ? err.message : 'the webhook URL is not valid');
  }
}

export function externalAgentView(r: ExternalAgentRow) {
  return {
    id: r.id,
    name: r.name,
    agentId: r.agentId,
    mode: r.webhookUrl ? ('webhook' as const) : ('pull' as const),
    webhookUrl: r.webhookUrl,
    calls: r.calls,
    misses: r.misses,
    lastError: r.lastError,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    rotatedAt: r.rotatedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

@Controller('external-agents')
export class ExternalAgentsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  @Get()
  async list(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    return (await this.deps.repos.externalAgents.listFor(account.id)).map(externalAgentView);
  }

  /** `201 { externalAgent, secret, token }`: the secret and the token are never shown again. */
  @Post()
  async create(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(createBody, body);
    const url = webhookOrNull(b.webhookUrl) ?? null;
    const { repos, vault } = this.deps;
    if ((await repos.externalAgents.countFor(account.id)) >= DEFAULTS.external.perAccount)
      throw new ApiError(409, 'external_limit', `at most ${DEFAULTS.external.perAccount} external agents`);
    const secret = newExternalSecret();
    const row = await repos.externalAgents.create(account.id, { name: b.name, agentId: b.agentId ?? null, webhookUrl: url }, await vault.encryptSkill(secret));
    return { externalAgent: externalAgentView(row), secret, token: externalAgentToken(row.id, secret) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(patchBody, body);
    const url = webhookOrNull(b.webhookUrl);
    const row = await this.deps.repos.externalAgents.update(account.id, idOr404(externalId, id, 'external agent'), {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.agentId !== undefined ? { agentId: b.agentId } : {}),
      ...(url !== undefined ? { webhookUrl: url } : {}),
    });
    return externalAgentView(row);
  }

  /** A new secret; the old one and its token stop working at once (a live match keeps signing with the old one until it ends). */
  @Post(':id/rotate')
  @HttpCode(200)
  async rotate(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const secret = newExternalSecret();
    const row = await this.deps.repos.externalAgents.rotate(account.id, idOr404(externalId, id, 'external agent'), await this.deps.vault.encryptSkill(secret));
    return { externalAgent: externalAgentView(row), secret, token: externalAgentToken(row.id, secret) };
  }

  /**
   * Webhook: a signed `ping` POST, answered `{ ok, status, latencyMs }` or `{ ok: false, error, message }`
   * (always 200: the result is the ping's, not the request's). Pull: whether the program has been seen.
   */
  @Post(':id/ping')
  @HttpCode(200)
  async ping(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { repos, vault } = this.deps;
    const row = await repos.externalAgents.get(idOr404(externalId, id, 'external agent'));
    if (!row || row.accountId !== account.id) throw notFound('external agent');
    if (!row.webhookUrl) return { ok: row.lastSeenAt !== null, mode: 'pull' as const, lastSeenAt: row.lastSeenAt?.toISOString() ?? null };
    const secret = (await vault.decryptSkill(sealedSecretOf(row))).prompt;
    const ping: ExternalPing = { contract: EXTERNAL_CONTRACT, type: 'ping', externalAgentId: row.id, nonce: randomBytes(12).toString('base64url'), sentAt: new Date().toISOString() };
    const payload = JSON.stringify(ping);
    const headers = { [SIGNATURE_HEADER]: signExternalBody(secret, payload), 'x-skirm-agent': row.id, 'x-skirm-contract': EXTERNAL_CONTRACT };
    const post = this.deps.externalPost ?? ((url, b, opts) => safePostJson(url, b, opts));
    try {
      const r = await post(row.webhookUrl, payload, { timeoutMs: PING_TIMEOUT_MS, maxBytes: DEFAULTS.external.maxResponseBytes, headers });
      await repos.externalAgents.touch(row.id);
      return { ok: true, mode: 'webhook' as const, status: r.status, latencyMs: r.latencyMs };
    } catch (err) {
      const e = err instanceof ExternalHttpError ? err : new ExternalHttpError('network', 'the webhook could not be reached');
      return { ok: false, mode: 'webhook' as const, error: e.code, message: e.message };
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    await this.deps.repos.externalAgents.remove(account.id, idOr404(externalId, id, 'external agent'));
    return { deleted: true };
  }
}

const badToken = () => new ApiError(401, 'invalid_agent_token', 'send Authorization: Bearer <external agent token>');

@Controller('agent/v1')
@Public()
export class AgentApiController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  /** The external agent behind `Authorization: Bearer <id>.<secret>`, and its (live) player. */
  private async agent(authorization: string | undefined): Promise<{ row: ExternalAgentRow; account: AccountRow }> {
    const raw = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    const t = raw ? parseExternalAgentToken(raw) : null;
    if (!t) throw badToken();
    const { repos } = this.deps;
    const row = await repos.externalAgents.get(t.id);
    if (!row || !externalSecretMatches(t.secret, row.secretSha256)) throw badToken();
    const account = await repos.accounts.get(row.accountId);
    if (!account || account.system || account.deletedAt) throw badToken();
    return { row, account };
  }

  private relay() {
    const t = this.deps.externalTurns;
    if (!t) throw new ApiError(503, 'relay_unavailable', 'the turn relay is not configured');
    return t;
  }

  /** The external agent, its player and the agent it plays. */
  @Get('me')
  async me(@Headers('authorization') auth?: string) {
    const { row, account } = await this.agent(auth);
    const agent = row.agentId ? await this.deps.repos.agents.view(row.agentId) : null;
    return {
      contract: EXTERNAL_CONTRACT,
      externalAgent: externalAgentView(row),
      account: { id: account.id, handle: account.handle },
      agent: agent ? { id: agent.id, name: agent.name, role: agent.role, vision: agent.vision, comms: agent.comms, tier: agent.tier } : null,
    };
  }

  /** `{ turn }`: the open turn (null when none). `waitMs` long-polls; `after` skips the turn already answered. */
  @Get('turn')
  async turn(@Query() query: unknown, @Headers('authorization') auth?: string) {
    const { row } = await this.agent(auth);
    const { waitMs, after } = parse(turnQuery, query);
    const relay = this.relay();
    const until = Date.now() + waitMs;
    let turn: ExternalTurn | null;
    for (;;) {
      turn = await relay.current(row.id);
      if (turn && turn.turnId !== after) break;
      if (Date.now() + POLL_MS > until) {
        turn = turn && turn.turnId !== after ? turn : null;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return { contract: EXTERNAL_CONTRACT, turn };
  }

  /** Answers the open turn: `{ turnId, action, say?, thought? }` (EXTERNAL_REPLY_SCHEMA). The first answer counts. */
  @Post('action')
  @HttpCode(200)
  async action(@Body() body: unknown, @Headers('authorization') auth?: string) {
    const { row } = await this.agent(auth);
    const b = parse(actionBody, body);
    const relay = this.relay();
    const turn = await relay.current(row.id);
    if (!turn || turn.turnId !== b.turnId) throw new ApiError(409, 'stale_turn', 'that turn is no longer open; fetch the current one');
    if (Date.parse(turn.expiresAt) < Date.now()) throw new ApiError(409, 'too_late', 'the deadline passed; the greedy brain played that tick');
    const parsed = parseExternalReply(body, turn.observation.legal, turn.context.canSpeak);
    if (!parsed.ok) throw new ApiError(422, 'invalid_action', parsed.error);
    const r = await relay.submit(row.id, turn.turnId, parsed.reply, REPLY_TTL_MS);
    if (r === 'stale') throw new ApiError(409, 'stale_turn', 'that turn is no longer open; fetch the current one');
    if (r === 'duplicate') throw new ApiError(409, 'already_answered', 'this turn was already answered');
    void this.deps.repos.externalAgents.touch(row.id).catch(() => undefined);
    return { accepted: true, turnId: turn.turnId, action: parsed.reply.action };
  }

  /** The player's latest matches (casual, practice and ranked), newest first. */
  @Get('matches')
  async matches(@Query() query: unknown, @Headers('authorization') auth?: string) {
    const { account } = await this.agent(auth);
    const { limit } = parse(matchesQuery, query);
    const rows = await this.deps.repos.v2Matches.listForAccount(account.id, limit);
    return { matches: rows.map((m) => myMatchView(m, account.id)) };
  }
}
