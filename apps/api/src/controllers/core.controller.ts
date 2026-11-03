// /health, /auth/session, /me, /me/matches, /agents.
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AccountRow } from '@skirm/db';
import { verifyCredentials } from '@skirm/server';
import { premiumItemsIn, rankTitle } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, Public, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError } from '../errors';
import { agentId, agentPatch, intQuery, parse, sessionBody } from '../validation';
import { linkMessage, verifyNearSignature } from '../near-link';
import { accountView, myMatchView } from '../views';
import { idOr404 } from './util';

const myMatchesQuery = z.object({ limit: intQuery(1, 50, 20) });

const nearTaken = () =>
  new ApiError(409, 'near_account_taken', 'that NEAR account is linked to another player');

const sumYocto = (values: Iterable<bigint>) => {
  let total = 0n;
  for (const v of values) total += v;
  return total;
};

@Controller()
export class CoreController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }

  /** Signs in (dev: `x-dev-user`; privy: `{ token }` or a Bearer header), creating the account. */
  @Public()
  @Post('auth/session')
  @HttpCode(200)
  async session(
    @Body() body: unknown,
    @Headers('x-dev-user') devUser?: string,
    @Headers('authorization') authorization?: string,
  ) {
    const b = parse(sessionBody, body);
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const user = await verifyCredentials(this.deps.config, {
      token: b.token ?? bearer ?? null,
      devUser: devUser ?? null,
    });
    const { repos, vault } = this.deps;
    let { account, created } = await repos.accounts.getOrCreate(user, vault);
    if (account.system) throw new ApiError(403, 'forbidden', 'this handle is reserved');
    if (b.nearAccountId && b.nearAccountId !== account.nearAccountId) {
      const other = await repos.accounts.byNearAccount(b.nearAccountId);
      if (other && other.id !== account.id) throw nearTaken();
      await this.checkNearProof(account.id, b.nearAccountId, b.nearProof);
      // The unique index settles two players linking the same account at once.
      const linked = await repos.accounts.linkNearAccount(account.id, b.nearAccountId);
      if (!linked.ok) throw nearTaken();
      account = (await repos.accounts.get(account.id))!;
    }
    return { account: accountView(account), created };
  }

  /** Dev mode trusts the link; otherwise a full-access key of the NEAR account must sign it. */
  private async checkNearProof(
    accountId: string,
    nearAccountId: string,
    proof?: {
      publicKey: string;
      signature: string;
      nonce?: string;
      recipient?: string;
      callbackUrl?: string;
    },
  ): Promise<void> {
    if (this.deps.config.AUTH_MODE === 'dev') return;
    if (!proof)
      throw new ApiError(
        422,
        'near_proof_required',
        'sign the link message with your NEAR wallet',
        {
          message: linkMessage(accountId, nearAccountId),
        },
      );
    if (proof.nonce !== undefined && proof.recipient === undefined)
      throw new ApiError(422, 'near_proof_invalid', 'a NEP-413 proof needs its recipient');
    const nep413 =
      proof.nonce !== undefined
        ? {
            nonce: proof.nonce,
            recipient: proof.recipient!,
            ...(proof.callbackUrl !== undefined ? { callbackUrl: proof.callbackUrl } : {}),
          }
        : undefined;
    if (
      !verifyNearSignature(
        proof.publicKey,
        linkMessage(accountId, nearAccountId),
        proof.signature,
        nep413,
      )
    )
      throw new ApiError(
        422,
        'near_proof_invalid',
        'the signature does not match the link message',
      );
    const keys = this.deps.near.keys;
    if (!keys) throw new ApiError(503, 'near_unavailable', 'NEAR account linking is unavailable');
    let ok: boolean;
    try {
      ok = await keys.isFullAccessKey(nearAccountId, proof.publicKey);
    } catch {
      throw new ApiError(503, 'rpc_unavailable', 'NEAR RPC is unavailable, try again');
    }
    if (!ok)
      throw new ApiError(
        422,
        'near_proof_invalid',
        'that key is not a full-access key of the account',
      );
  }

  @Get('me')
  async me(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { repos } = this.deps;
    const [credits, agents, unlocks, royalties, ladderRow, cosmetics] = await Promise.all([
      repos.ledger.balance(account.id),
      repos.agents.listByOwner(account.id),
      repos.agents.unlocksOf(account.id),
      repos.market.royaltiesByCreator(account.id),
      repos.leaderboards.playerRowFor(account.id),
      repos.cosmetics.owned(account.id),
    ]);
    return {
      account: accountView(account),
      /** v2: the player's own Elo, ranked record, rank title and place on the player ladder. */
      rank: {
        elo: account.elo,
        rankedMatches: account.rankedMatches,
        wins: account.wins,
        losses: account.losses,
        draws: account.draws,
        title: rankTitle(account.elo).title,
        position: ladderRow?.rank ?? null,
      },
      credits,
      agents,
      unlocks,
      /** Credits one NEAR buys (config CREDITS_PER_NEAR). */
      creditsPerNear: this.deps.config.CREDITS_PER_NEAR,
      /** Creator royalties earned over all written skills, yoctoNEAR. */
      royaltiesYocto: sumYocto(royalties.values()).toString(),
      /** Premium cosmetic item ids the player owns (GET /cosmetics has the catalog). */
      cosmetics,
    };
  }

  /** The caller's latest v2 matches, newest first, from their side: result, score and Elo change. */
  @Get('me/matches')
  async myMatches(@Query() query: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { limit } = parse(myMatchesQuery, query);
    const rows = await this.deps.repos.v2Matches.listForAccount(account.id, limit);
    return rows.map((m) => myMatchView(m, account.id));
  }

  /**
   * What the player got back over all time: creator royalties, skill sales as the seller (after fee
   * and royalty), season prizes won, agent rentals earned (after the platform fee) and paid credits
   * spent on v2 matches.
   */
  @Get('me/earn-back')
  async earnBack(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { repos } = this.deps;
    const [royalties, salesNet, spentCredits, prizes, rentals] = await Promise.all([
      repos.market.royaltiesByCreator(account.id),
      repos.market.salesNetBySeller(account.id),
      repos.ledger.v2MatchSpend(account.id),
      repos.seasons.prizesFor(account.id),
      repos.rentals.proceedsFor(account.id),
    ]);
    return {
      royaltiesYocto: sumYocto(royalties.values()).toString(),
      salesNetYocto: salesNet.toString(),
      spentCredits,
      creditsPerNear: this.deps.config.CREDITS_PER_NEAR,
      prizesYocto: prizes.toString(),
      rentalsYocto: rentals.toString(),
    };
  }

  /**
   * Everything skirm holds about the caller as one JSON download (the privacy policy's export):
   * every table that references the account, with the caller's own skill prompts decrypted. Match
   * debriefs keep only the caller's side.
   */
  @Get('me/export')
  async exportData(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { repos, vault } = this.deps;
    const data = await repos.accounts.exportFor(account.id);
    const written = await repos.skills.listWritten(account.id);
    const skillPrompts = [];
    for (const v of written) {
      const sealed = await repos.skills.loadSealed(v.id, v.version);
      if (!sealed) continue;
      const text = await vault.decryptSkill(sealed);
      skillPrompts.push({ skillId: v.id, version: v.version, name: v.name, prompt: text.prompt, reflexes: text.reflexes ?? null });
    }
    return { exportedAt: new Date().toISOString(), accountId: account.id, ...data, skillPrompts };
  }

  /**
   * Deletes the caller's account (the privacy policy's delete). `{ confirm }` must be the current
   * handle. Refused while an agent plays a live match (409 `agent_busy`) or a market listing is open
   * (409 `listing_active`). The sign-in, NEAR link, system prompts and rental offers go; credits are
   * forfeited; agents, match history and sales stay for other players' records and paid passes.
   */
  @Delete('me')
  async deleteMe(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { confirm } = parse(z.object({ confirm: z.string().min(1).max(64) }), body);
    if (confirm !== account.handle) throw new ApiError(422, 'confirm_mismatch', 'type your handle to confirm');
    const { repos } = this.deps;
    const own = await repos.agents.listByOwner(account.id);
    if ((await repos.agents.busyAgents(own.map((a) => a.id))).length)
      throw new ApiError(409, 'agent_busy', 'an agent is in a match that has not ended');
    if (await repos.market.hasActiveListing(account.id))
      throw new ApiError(409, 'listing_active', 'cancel your market listings before deleting your account');
    await repos.accounts.deleteAccount(account.id);
    return { deleted: true };
  }

  /**
   * Unlinks the NEAR account. Refused (409 `listing_active`) while the player has an active market
   * listing: its approval and payout belong to the linked wallet.
   */
  @Delete('me/near')
  async unlinkNear(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { repos } = this.deps;
    if (!account.nearAccountId) return { account: accountView(account) };
    if (await repos.market.hasActiveListing(account.id))
      throw new ApiError(
        409,
        'listing_active',
        'cancel your market listings before unlinking your NEAR account',
      );
    const row = await repos.accounts.unlinkNearAccount(account.id);
    return { account: accountView(row ?? { ...account, nearAccountId: null }) };
  }

  @Get('agents')
  agents(@CurrentAccount() acc?: AccountRow) {
    return this.deps.repos.agents.listByOwner(mustAccount(acc).id);
  }

  /**
   * One of the caller's agents' record from its v2 matches (practice against the bot left out):
   * this season's, while a season is open, and all time. Matches, W–L–D, items delivered, bluffs
   * told and landed, and rival bluffs seen through.
   */
  @Get('agents/:id/record')
  async agentRecord(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const agent = idOr404(agentId, id, 'agent');
    const { agents, seasons, v2Matches } = this.deps.repos;
    const row = await agents.get(agent);
    if (!row || row.ownerId !== account.id) throw new ApiError(404, 'not_found', 'agent not found');
    const current = await seasons.current();
    const [allTime, season] = await Promise.all([
      v2Matches.agentRecord(agent),
      current ? v2Matches.agentRecord(agent, { since: current.startsAt, until: current.endsAt }) : null,
    ]);
    return { allTime, season: current && season ? { number: current.number, endsAt: current.endsAt.toISOString(), ...season } : null };
  }

  /**
   * Name, skills (≤3, owned), unlocks, the v2 role, vision, comms and talk tier, and the owner's
   * instructions (`systemPrompt`, ≤600 characters); refused (409 `agent_busy`) while the agent is in a live match.
   * Appearance is cosmetic and can change at any time, also mid-match; a premium colour needs the
   * cosmetic bought first (403 `cosmetic_not_owned`, checked before anything is written).
   */
  @Patch('agents/:id')
  async patchAgent(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAccount() acc?: AccountRow,
  ) {
    const account = mustAccount(acc);
    const patch = parse(agentPatch, body);
    const agent = idOr404(agentId, id, 'agent');
    const { agents, cosmetics } = this.deps.repos;
    if (patch.appearance) {
      const premium = premiumItemsIn(patch.appearance);
      if (premium.length) {
        const owned = new Set(await cosmetics.owned(account.id));
        const missing = premium.filter((c) => !owned.has(c));
        if (missing.length)
          throw new ApiError(403, 'cosmetic_not_owned', 'buy the premium colour before wearing it', {
            items: missing,
          });
      }
    }
    const gameplay = (['name', 'skills', 'unlocks', 'role', 'vision', 'comms', 'tier', 'systemPrompt'] as const).some((k) => patch[k] !== undefined);
    let view = gameplay
      ? await agents.update(account.id, agent, {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.skills !== undefined ? { skills: patch.skills } : {}),
          ...(patch.unlocks !== undefined ? { unlocks: patch.unlocks } : {}),
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.vision !== undefined ? { vision: patch.vision } : {}),
          ...(patch.comms !== undefined ? { comms: patch.comms } : {}),
          ...(patch.tier !== undefined ? { tier: patch.tier } : {}),
          ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        })
      : undefined;
    if (patch.appearance) view = await agents.setAppearance(account.id, agent, patch.appearance);
    return view ?? agents.update(account.id, agent, {});
  }
}
