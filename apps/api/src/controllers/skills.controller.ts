// /skills* (S07, S08). Hidden-prompt rule (Spec §9): prompt and reflexes go straight into the vault
// and come back out only in GET /skills/:id, only for the skill's creator. Every other response is
// built by skillPublic(), which has no access to the text.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import type { AccountRow, SkillBenchmarkRow, SkillVersionView } from '@skirm/db';
import { NearCallError, skillTokenId, type SkillMintInput } from '@skirm/server';
import { UNLOCK_ACTION, type Unlock } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { optIntQuery, parse, skillBody, skillId } from '../validation';
import { skillPublic } from '../views';
import { idOr404 } from './util';

const tabQuery = z.object({ tab: z.enum(['written', 'owned']).default('written') });
const versionQuery = z.object({ version: optIntQuery(1, 1_000_000) });
const mintBody = z.object({ version: z.number().int().min(1).optional() });

const ACTION_UNLOCK = Object.fromEntries(
  Object.entries(UNLOCK_ACTION).map(([u, a]) => [a, u as Unlock]),
) as Record<string, Unlock>;

@Controller('skills')
export class SkillsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  /** A version the caller may see: public (minted/listed), or a draft they wrote or hold. */
  private async visible(account: AccountRow, id: string, version?: number) {
    const { skills } = this.deps.repos;
    const sid = idOr404(skillId, id, 'skill');
    const v = await skills.get(sid, version);
    if (!v) throw notFound('skill');
    if (
      v.status === 'draft' &&
      v.creatorId !== account.id &&
      !(await skills.owns(account.id, v.id, v.version))
    ) {
      // No version asked for and the newest is someone else's draft (PUT after a mint): the
      // newest version this caller may see, public or held.
      if (version !== undefined) throw notFound('skill');
      const [pub, owned] = await Promise.all([skills.listPublic(), skills.listOwned(account.id)]);
      const best = [...pub, ...owned]
        .filter((x) => x.id === sid)
        .sort((a, b) => b.version - a.version)[0];
      if (!best) throw notFound('skill');
      return best;
    }
    return v;
  }

  private row(v: SkillVersionView, owner?: string) {
    return {
      ...skillPublic(v, owner),
      requiredUnlocks: v.requiresActions.map((a) => ACTION_UNLOCK[a]).filter(Boolean),
    };
  }

  @Get()
  async list(@Query() query: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { tab } = parse(tabQuery, query);
    const { skills } = this.deps.repos;
    if (tab === 'written') {
      const [written, royalties] = await Promise.all([
        skills.listWritten(account.id),
        this.deps.repos.market.royaltiesByCreator(account.id),
      ]);
      return written.map((v) => ({
        ...this.row(v),
        royaltiesYocto: (royalties.get(v.id) ?? 0n).toString(),
      }));
    }
    const me = account.nearAccountId ?? account.handle;
    return (await skills.listOwned(account.id)).map((v) => this.row(v, me));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(skillBody, body);
    const sealed = await this.deps.vault.encryptSkill(b.prompt, b.reflexes ?? undefined);
    const v = await this.deps.repos.skills.create(account.id, meta(b), sealed);
    return skillPublic(v);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const sid = idOr404(skillId, id, 'skill');
    const b = parse(skillBody, body);
    const existing = await this.deps.repos.skills.get(sid);
    if (!existing) throw notFound('skill');
    if (existing.creatorId !== account.id)
      throw new ApiError(403, 'forbidden', 'only the creator can edit a skill');
    const sealed = await this.deps.vault.encryptSkill(b.prompt, b.reflexes ?? undefined);
    const v = await this.deps.repos.skills.createVersion(sid, account.id, meta(b), sealed);
    return skillPublic(v);
  }

  /** Public fields; the creator alone also gets `{ prompt, reflexes }` (S08 read-back). */
  @Get(':id')
  async get(@Param('id') id: string, @Query() query: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { version } = parse(versionQuery, query);
    const v = await this.visible(account, id, version);
    const out = this.row(v);
    if (v.creatorId !== account.id) return out;
    const sealed = await this.deps.repos.skills.loadSealed(v.id, v.version);
    if (!sealed) throw notFound('skill');
    const text = await this.deps.vault.decryptSkill(sealed);
    return { ...out, prompt: text.prompt, reflexes: text.reflexes ?? null };
  }

  /**
   * nft_mint through the ops key (Noop without NEAR_OPS_*). Never gated on a test: the version's
   * hidden benchmark is queued first (the worker plays it; offline it ends `needs_model`) and the
   * response carries its status. One request at a time mints a draft (409 `mint_in_progress` for
   * the others). When the chain call errors but the token exists onchain (the call landed, the
   * answer was lost), the version is recorded as minted.
   */
  @Post(':id/mint')
  @HttpCode(200)
  async mint(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(mintBody, body);
    const { repos, near } = this.deps;
    const v = await this.visible(account, id, b.version);
    if (v.creatorId !== account.id)
      throw new ApiError(403, 'forbidden', 'only the creator can mint a skill');
    if (v.accountBound)
      throw new ApiError(403, 'forbidden', 'account-bound skills are never minted');
    const minted = async (tokenId: string | null) => ({
      tokenId,
      status: 'minted' as const,
      benchmark: { status: (await repos.proof.benchmark(v.id, v.version))?.status ?? null },
    });
    if (v.status !== 'draft') return minted(v.tokenId);
    if (near.minter.kind === 'near' && !account.nearAccountId)
      throw new ApiError(422, 'near_account_required', 'link a NEAR account to mint');
    if (!(await repos.skills.claimMint(v.id, v.version))) {
      const now = await repos.skills.get(v.id, v.version);
      if (now && now.status !== 'draft') return minted(now.tokenId);
      throw new ApiError(409, 'mint_in_progress', 'this version is being minted, try again shortly');
    }
    // Queued before the chain call, so no version is ever minted without its benchmark job.
    let benchmark: SkillBenchmarkRow | undefined;
    try {
      benchmark = await repos.proof.enqueueBenchmark(v.id, v.version);
      await this.deps.benchmarkQueue.enqueue({ kind: 'mint', skillId: v.id, version: v.version });
    } catch (err) {
      await repos.skills.releaseMint(v.id, v.version);
      if (benchmark)
        throw new ApiError(503, 'queue_unavailable', 'minting is paused, try again shortly');
      throw err;
    }
    const bench = { status: benchmark.status };
    const input: SkillMintInput = {
      id: v.id,
      version: v.version,
      name: v.name,
      summary: v.summary,
      creator: account.nearAccountId ?? account.handle,
      royaltyBps: v.royaltyBps,
      requiresActions: v.requiresActions,
      handlesTags: v.handlesTags,
      promptSha256: v.promptSha256,
      createdAt: new Date(v.createdAt).toISOString(),
    };
    let res;
    try {
      res = await near.minter.mint(input);
    } catch (err) {
      if (err instanceof NearCallError && near.minter.kind === 'near') {
        const tokenId = skillTokenId(v.id, v.version);
        const owner = await near.ownership.ownerOf(tokenId).catch(() => null);
        if (owner) {
          await repos.skills.markMinted(v.id, v.version, tokenId);
          return {
            tokenId,
            status: 'minted' as const,
            ...(err.txHash ? { txHash: err.txHash } : {}),
            benchmark: bench,
          };
        }
      }
      await repos.skills.releaseMint(v.id, v.version);
      if (err instanceof NearCallError)
        throw new ApiError(502, 'mint_failed', 'minting on NEAR failed, try again');
      throw err;
    }
    await repos.skills.markMinted(v.id, v.version, res.tokenId);
    return {
      tokenId: res.tokenId,
      status: res.status,
      ...(res.txHash ? { txHash: res.txHash } : {}),
      benchmark: bench,
    };
  }
}

function meta(b: z.output<typeof skillBody>) {
  return {
    name: b.name,
    summary: b.summary ?? null,
    requiresActions: b.requires_actions,
    handlesTags: b.handles_tags as SkillVersionView['handlesTags'],
    roles: b.roles,
    royaltyBps: b.royalty_bps,
  };
}
