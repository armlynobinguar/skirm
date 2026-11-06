// /market* (S09, S10). Cards and proof are public metadata, ranked records and the benchmark only;
// a bought skill grants use, never its text. Purchases are verified through the NEAR
// owner (dev mode: `dev:` hashes). Buyers can trial a version with one of their agents first.
// GET /market and GET /market/:skillId are public (signed-out visitors browse the Exchange): they
// return the same public metadata, with the caller-only fields (owned, trials) at their signed-out
// defaults and drafts hidden. Every write and the trial routes still need a session.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  TRIAL_LIMIT,
  versionKey,
  type AccountRow,
  type ListingRow,
  type SkillVersionView,
} from '@skirm/db';
import { AGENT_ROLES, TAGS, normalizeSkillRoles, skillFitsRole, skillRolesLabel, type Tag } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, Public, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { agentId, listingBody, optIntQuery, parse, purchaseBody, skillId } from '../validation';
import { benchmarkView, listingView, saleView, skillPublic, trialView } from '../views';
import { idOr404 } from './util';

const empty = (v: unknown) => (v === '' ? undefined : v);
const marketQuery = z.object({
  tag: z.preprocess(empty, z.enum(TAGS as unknown as [Tag, ...Tag[]]).optional()),
  sort: z.preprocess(empty, z.enum(['winrate', 'benchmark', 'price', 'new']).default('winrate')),
  /** Only versions an agent of this role may equip (its role or any). */
  role: z.preprocess(empty, z.enum(AGENT_ROLES).optional()),
});
const versionQuery = z.object({ version: optIntQuery(1, 1_000_000) });
const trialBody = z.object({ version: z.number().int().min(1).optional(), agentId });
const DEV_PURCHASE_RE = /^dev:([0-9]{1,40})(?::[A-Za-z0-9_-]{1,64})?$/;

const key = (v: { id: string; version: number }) => versionKey(v.id, v.version);
/** Descending with nulls last (cards with no ranked match or no benchmark score). */
const desc = (a: number | null, b: number | null) =>
  a === null || b === null ? (a === b ? 0 : a === null ? 1 : -1) : b - a;

@Controller('market')
export class MarketController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  @Get()
  @Public()
  async list(@Query() query: unknown, @CurrentAccount() account?: AccountRow) {
    const q = parse(marketQuery, query);
    const { repos } = this.deps;
    let versions = await repos.skills.listPublic();
    if (q.tag) versions = versions.filter((v) => v.handlesTags.includes(q.tag!));
    if (q.role) versions = versions.filter((v) => skillFitsRole(v.roles, q.role!));
    const [listings, owned, proof] = await Promise.all([
      repos.market.activeListings(),
      account ? repos.skills.listOwned(account.id) : Promise.resolve([]),
      repos.proof.marketRates(versions.map((v) => ({ skillId: v.id, version: v.version }))),
    ]);
    const listingBy = new Map<string, ListingRow>();
    for (const l of listings)
      if (!listingBy.has(key({ id: l.skillId, version: l.version })))
        listingBy.set(key({ id: l.skillId, version: l.version }), l);
    const ownedKeys = new Set(owned.map(key));


    const cards = versions.map((v) => {
      const listing = listingBy.get(key(v));
      const p = proof.get(key(v));
      return {
        skill: skillPublic(v),
        creator: { id: v.creatorId, handle: v.creatorHandle, nearAccountId: v.creatorNear },
        priceYocto: listing?.priceYocto ?? null,
        ...(listing ? { listing: listingView(listing, v) } : {}),
        /** Ranked v2 record of this version; win rate null before its first ranked match. */
        rankedWinRate: p?.rankedWinRate ?? null,
        rankedMatches: p?.rankedMatches ?? 0,
        /** null when not benchmarked, offline (needs a model key) or not finished. */
        benchmarkScore: p?.benchmarkScore ?? null,
        owned: ownedKeys.has(key(v)),
      };
    });
    const price = (c: (typeof cards)[number]) =>
      c.priceYocto === null ? null : BigInt(c.priceYocto);
    cards.sort((a, b) => {
      switch (q.sort) {
        case 'price': {
          const pa = price(a);
          const pb = price(b);
          if (pa === null || pb === null) return pa === pb ? 0 : pa === null ? 1 : -1;
          return pa < pb ? -1 : pa > pb ? 1 : 0;
        }
        case 'new':
          return b.skill.created_at.localeCompare(a.skill.created_at);
        case 'benchmark':
          return desc(a.benchmarkScore, b.benchmarkScore);
        default:
          return desc(a.rankedWinRate, b.rankedWinRate) || b.rankedMatches - a.rankedMatches;
      }
    });
    return cards;
  }

  /** The newest public version (or `?version=`); drafts only for their creator or holder (never signed out). */
  private async version(
    account: AccountRow | undefined,
    id: string,
    version?: number,
  ): Promise<SkillVersionView> {
    const { skills } = this.deps.repos;
    const sid = idOr404(skillId, id, 'skill');
    let v: SkillVersionView | undefined;
    if (version !== undefined) v = await skills.get(sid, version);
    else {
      const pub = (await skills.listPublic()).filter((p) => p.id === sid);
      v = pub.sort((a, b) => b.version - a.version)[0] ?? (await skills.get(sid));
    }
    if (!v) throw notFound('skill');
    if (
      v.status === 'draft' &&
      (!account ||
        (v.creatorId !== account.id && !(await skills.owns(account.id, v.id, v.version))))
    )
      throw notFound('skill');
    return v;
  }

  @Get(':skillId')
  @Public()
  async detail(
    @Param('skillId') id: string,
    @Query() query: unknown,
    @CurrentAccount() account?: AccountRow,
  ) {
    const { version } = parse(versionQuery, query);
    const v = await this.version(account, id, version);
    const { repos } = this.deps;
    const [sales, listing, owned, benchmark, ranked, counters, trialsUsed] =
      await Promise.all([
        repos.market.salesOf(v.id),
        repos.market.activeListing(v.id, v.version),
        account ? repos.skills.owns(account.id, v.id, v.version) : Promise.resolve(false),
        repos.proof.benchmark(v.id, v.version),
        repos.proof.rankedRecord(v.id, v.version),
        repos.proof.counters(v.id, v.version),
        account ? repos.proof.trialsUsed(account.id, v.id, v.version) : Promise.resolve(0),
      ]);
    const lastSale = sales.find((s) => s.version === v.version);
    const owner = lastSale ? await repos.accounts.get(lastSale.buyerId) : undefined;
    return {
      skill: skillPublic(v, owner ? (owner.nearAccountId ?? owner.handle) : undefined),
      /** v2 proof: the hidden benchmark (null before one is queued), the ranked record, counters. */
      benchmark: benchmarkView(benchmark),
      ranked,
      /** Opponent skill versions this version lost to most, with its record against each. */
      counters: { vs: counters },
      /** The caller's trials of this version: used counts every trial that played (not needs_model). */
      trials: { used: trialsUsed, left: Math.max(0, TRIAL_LIMIT - trialsUsed) },
      sales: sales.map(saleView),
      ...(listing ? { listing: listingView(listing, v) } : {}),
      owned,
      /** The version shown, pinned by its prompt hash: what a buyer gets is exactly this. */
      pinned: {
        version: v.version,
        promptSha256: v.promptSha256,
        tokenId: v.tokenId,
        mintedAt: v.mintedAt ? new Date(v.mintedAt).toISOString() : null,
      },
    };
  }

  /**
   * Try before you buy: queues a trial of a version (`version` or the newest public one) with one of
   * the caller's agents, who must not own that version. At most TRIAL_LIMIT per version (429
   * `trial_limit`; offline needs_model trials do not count).
   */
  @Post(':skillId/trial')
  @HttpCode(202)
  async trial(
    @Param('skillId') id: string,
    @Body() body: unknown,
    @CurrentAccount() acc?: AccountRow,
  ) {
    const account = mustAccount(acc);
    const b = parse(trialBody, body);
    const v = await this.version(account, id, b.version);
    const { repos, benchmarkQueue } = this.deps;
    const agent = await repos.agents.get(b.agentId);
    if (!agent || agent.ownerId !== account.id) throw notFound('agent');
    if (await repos.skills.owns(account.id, v.id, v.version))
      throw new ApiError(409, 'skill_owned', 'you already own this version');
    if (!skillFitsRole(v.roles, agent.role))
      throw new ApiError(422, 'skill_role_mismatch', `this skill is for ${skillRolesLabel(v.roles)}, not a ${agent.role}`, {
        roles: normalizeSkillRoles(v.roles),
        role: agent.role,
      });
    const trial = await repos.proof.createTrial({
      accountId: account.id,
      skillId: v.id,
      version: v.version,
      agentId: agent.id,
    });
    try {
      await benchmarkQueue.enqueue({ kind: 'trial', trialId: trial.id });
    } catch {
      await repos.proof.finishTrial(trial.id, {
        status: 'failed',
        results: { error: 'queue_unavailable' },
      });
      throw new ApiError(503, 'queue_unavailable', 'trials are paused, try again shortly');
    }
    return { trialId: trial.id, status: trial.status };
  }

  /** The caller's trials of a skill (one `version`, or all), newest first. */
  @Get(':skillId/trials')
  async trials(
    @Param('skillId') id: string,
    @Query() query: unknown,
    @CurrentAccount() acc?: AccountRow,
  ) {
    const account = mustAccount(acc);
    const { version } = parse(versionQuery, query);
    const sid = idOr404(skillId, id, 'skill');
    const rows = await this.deps.repos.proof.trials(account.id, sid, version);
    return rows.map(trialView);
  }

  /** Records the seller's listing (the onchain `nft_approve` is signed by their wallet). */
  @Post(':skillId/listing')
  @HttpCode(200)
  async listing(
    @Param('skillId') id: string,
    @Body() body: unknown,
    @CurrentAccount() acc?: AccountRow,
  ) {
    const account = mustAccount(acc);
    const b = parse(listingBody, body);
    const sid = idOr404(skillId, id, 'skill');
    let version = b.version;
    if (version === undefined) {
      const mine = (await this.deps.repos.skills.listOwned(account.id))
        .filter((v) => v.id === sid && v.status !== 'draft')
        .sort((a, c) => c.version - a.version);
      if (!mine[0]) {
        if (!(await this.deps.repos.skills.get(sid))) throw notFound('skill');
        throw new ApiError(422, 'not_minted', 'you hold no minted version of this skill');
      }
      version = mine[0].version;
    }
    const row = await this.deps.repos.market.list({
      skillId: sid,
      version,
      sellerId: account.id,
      priceYocto: b.priceYocto,
      txHash: b.txHash ?? null,
    });
    return listingView(row, await this.deps.repos.skills.get(sid, version));
  }

  /** `{ owned: true }` once the purchase is verified (dev mode: a `dev:<yocto>` hash is trusted). */
  @Post(':skillId/purchase')
  @HttpCode(200)
  async purchase(
    @Param('skillId') id: string,
    @Body() body: unknown,
    @CurrentAccount() acc?: AccountRow,
  ) {
    const account = mustAccount(acc);
    const b = parse(purchaseBody, body);
    const { repos, near, config } = this.deps;
    const sid = idOr404(skillId, id, 'skill');
    // A replayed purchase is answered from the sale it already recorded.
    const done = await repos.market.saleByTx(b.txHash);
    if (done) {
      if (done.buyerId !== account.id || done.skillId !== sid)
        throw new ApiError(409, 'duplicate_tx', 'this transaction was already used');
      return { owned: true, sale: saleView(done) };
    }
    const listing = await repos.market.activeListing(sid, b.version);
    const version = b.version ?? listing?.version;
    if (version === undefined) {
      if (!(await repos.skills.get(sid))) throw notFound('skill');
      throw new ApiError(409, 'not_listed', 'this skill is not for sale');
    }
    const v = await repos.skills.get(sid, version);
    if (!v) throw notFound('skill');

    if (listing?.sellerId === account.id)
      throw new ApiError(409, 'own_listing', 'you are the seller of this listing');

    if (b.txHash.startsWith('dev:')) {
      if (config.AUTH_MODE !== 'dev')
        throw new ApiError(403, 'dev_disabled', 'dev purchases are disabled');
      const m = DEV_PURCHASE_RE.exec(b.txHash);
      if (!m)
        throw new ApiError(422, 'invalid_hash', 'dev purchases look like dev:<yocto>[:<nonce>]');
      if (listing && BigInt(m[1]!) < BigInt(listing.priceYocto))
        throw new ApiError(422, 'underpaid', 'the amount is below the listed price');
    } else {
      if (near.ownership.kind !== 'near' || !v.tokenId)
        throw new ApiError(503, 'ownership_unavailable', 'NEAR ownership cannot be checked now');
      if (!account.nearAccountId)
        throw new ApiError(422, 'near_account_required', 'link a NEAR account to buy');
      let owner: string | null | undefined;
      try {
        owner = await near.ownership.ownerOf(v.tokenId);
      } catch {
        throw new ApiError(503, 'rpc_unavailable', 'NEAR RPC is unavailable, try again');
      }
      if (owner !== account.nearAccountId)
        throw new ApiError(
          422,
          'purchase_unverified',
          'the token is not owned by your NEAR account',
        );
    }

    const { sale } = await repos.market.recordSale({
      skillId: sid,
      version,
      buyerId: account.id,
      txHash: b.txHash,
      ...(listing ? { priceYocto: listing.priceYocto } : {}),
    });
    return { owned: true, sale: saleView(sale) };
  }
}
