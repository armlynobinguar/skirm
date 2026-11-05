// Writer backing (contracts/backing): a writer opens a round, players back it up front and get a
// capped share of the writer's future royalties.
//
//   GET  /backing/config                          mode, contract, limits
//   GET  /backing/rounds?writer=&skill=&status=   rounds, newest first (public)
//   GET  /backing/rounds/:id                      a round, its recent payouts and the caller's position
//   POST /backing/rounds                          open { skillId?, shareBps, capMultipleBps, maxRaiseYocto }
//   POST /backing/rounds/:id/back                 { amountYocto }
//   POST /backing/rounds/:id/close                the writer: stop backing, receive the raise
//   POST /backing/rounds/:id/cancel               the writer: call off an open round (stakes come back)
//   POST /backing/rounds/:id/claim                a backer: pull earnings (or the stake of a cancelled round)
//   POST /backing/rounds/:id/distribute           the writer: route owed royalties (near mode)
//   POST /backing/sync { txHash }                 near mode: mirror a signed backing-contract tx
//   GET  /backing/mine                            the caller's positions and own rounds
//
// Modes. `near` (BACKING_CONTRACT set): every write answers `{ wallet }`, the contract call for the
// player's wallet to sign; the web then posts the tx hash to /backing/sync, which reads the tx
// through RPC and mirrors the contract's events. `credits` (no contract, AUTH_MODE=dev: the keyless
// local stack): the same rules on paid credits, applied here at once; royalties come from mirrored
// skill resales. `off` otherwise: reads work, writes answer 503.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { RepoError, type AccountRow, type BackingRoundRow, type Repos } from '@skirm/db';
import { BackingTxError, type BackingTx, type BackingTxErrorCode } from '@skirm/server';
import { BACKING, YOCTO_PER_NEAR } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, Public, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { parse, skillId } from '../validation';
import { idOr404 } from './util';

export type BackingApiMode = 'near' | 'credits' | 'off';

const roundId = z.string().regex(/^brd_[0-9A-HJKMNP-TV-Z]{26}$/);
const yocto = z.string().regex(/^[1-9][0-9]{0,39}$/);
const openBody = z.object({
  skillId: skillId.nullish(),
  shareBps: z.number().int().min(1).max(BACKING.maxShareBps),
  capMultipleBps: z.number().int().min(BACKING.minCapMultipleBps).max(BACKING.maxCapMultipleBps),
  maxRaiseYocto: yocto,
});
const backBody = z.object({ amountYocto: yocto });
const syncBody = z.object({ txHash: z.string().min(1).max(128) });
const listQuery = z.object({
  writer: z.string().min(1).max(64).optional(),
  skill: skillId.optional(),
  status: z.enum(['open', 'closed', 'cancelled']).optional(),
});

/** Gas for each contract call (the web signs with these). */
const TGAS = 10n ** 12n;
const GAS = { write: (30n * TGAS).toString(), back: (50n * TGAS).toString() };
/** Attached to open_round for the round's storage; the contract refunds the excess. */
export const OPEN_ROUND_STORAGE_YOCTO = (10n ** 22n).toString(); // 0.01 NEAR

const SYNC_STATUS: Record<BackingTxErrorCode, number> = {
  invalid_hash: 422,
  signer_required: 422,
  not_found: 404,
  failed: 422,
  wrong_receiver: 422,
  wrong_sender: 422,
  no_events: 422,
  rpc_unavailable: 503,
};

const str = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
const amount = (v: unknown): bigint | null => {
  const s = str(v);
  return s !== null && /^[0-9]{1,40}$/.test(s) ? BigInt(s) : null;
};

export function backingMode(deps: Pick<ApiDeps, 'config' | 'near'>): BackingApiMode {
  if (deps.config.BACKING_CONTRACT && deps.near.backing) return 'near';
  return deps.config.AUTH_MODE === 'dev' ? 'credits' : 'off';
}

@Controller('backing')
export class BackingController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  private get mode(): BackingApiMode {
    return backingMode(this.deps);
  }

  /** yoctoNEAR per paid credit (credits mode). */
  private get yoctoPerCredit(): bigint {
    return YOCTO_PER_NEAR / BigInt(this.deps.config.CREDITS_PER_NEAR);
  }

  private wallet(methodName: string, args: Record<string, unknown>, depositYocto = '0', gas = GAS.write) {
    return { wallet: { contractId: this.deps.config.BACKING_CONTRACT!, methodName, args, depositYocto, gas } };
  }

  private writable(): void {
    if (this.mode === 'off')
      throw new ApiError(503, 'backing_disabled', 'writer backing is not set up on this server');
  }

  @Public()
  @Get('config')
  config() {
    return {
      mode: this.mode,
      contractId: this.mode === 'near' ? this.deps.config.BACKING_CONTRACT : null,
      creditsPerNear: this.deps.config.CREDITS_PER_NEAR,
      maxShareBps: BACKING.maxShareBps,
      minCapMultipleBps: BACKING.minCapMultipleBps,
      maxCapMultipleBps: BACKING.maxCapMultipleBps,
      minStakeYocto: BACKING.minStakeYocto.toString(),
      maxRaiseYocto: BACKING.maxRaiseYocto.toString(),
      openRoundStorageYocto: OPEN_ROUND_STORAGE_YOCTO,
    };
  }

  @Public()
  @Get('rounds')
  async rounds(@Query() query: unknown) {
    const q = parse(listQuery, query);
    const { repos } = this.deps;
    let writerId: string | undefined;
    if (q.writer) {
      const w = (await repos.accounts.byHandle(q.writer)) ?? (await repos.accounts.get(q.writer));
      if (!w) return { rounds: [] };
      writerId = w.id;
    }
    if (this.mode === 'credits' && writerId) await repos.backing.settleFromSales(writerId);
    const rounds = await repos.backing.rounds({
      ...(writerId ? { writerId } : {}),
      ...(q.skill ? { skillId: q.skill } : {}),
      ...(q.status ? { status: q.status } : {}),
    });
    return { rounds };
  }

  @Public()
  @Get('rounds/:id')
  async round(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const rid = idOr404(roundId, id, 'backing round');
    const { repos } = this.deps;
    const row = await repos.backing.getRound(rid);
    if (!row) throw notFound('backing round');
    if (row.mode === 'credits') await repos.backing.settleFromSales(row.writerId);
    const [round, payouts, position] = await Promise.all([
      repos.backing.roundView(rid),
      repos.backing.payouts(rid, 20),
      acc ? repos.backing.position(rid, acc.id) : Promise.resolve(undefined),
    ]);
    const owedYocto = row.mode === 'near' && acc?.id === row.writerId ? await repos.backing.owedYocto(row) : 0n;
    return {
      round,
      payouts: payouts.map((p) => ({
        payoutId: p.id,
        royaltyYocto: String(p.royaltyYocto),
        toBackersYocto: String(p.toBackersYocto),
        toWriterYocto: String(p.toWriterYocto),
        saleId: p.saleId,
        txHash: p.txHash,
        createdAt: p.createdAt.toISOString(),
      })),
      position: position ?? null,
      owedYocto: owedYocto.toString(),
    };
  }

  @Get('mine')
  async mine(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { repos } = this.deps;
    if (this.mode === 'credits') {
      // Settle the writers this player backs (and their own rounds) before reading.
      const before = await repos.backing.positions(account.id);
      const writers = new Set([account.id, ...before.map((p) => p.round.writerId)]);
      for (const w of writers) await repos.backing.settleFromSales(w);
    }
    const [positions, rounds] = await Promise.all([
      repos.backing.positions(account.id),
      repos.backing.rounds({ writerId: account.id }),
    ]);
    const own = await Promise.all(
      rounds.map(async (r) => {
        const row = r.mode === 'near' ? await repos.backing.getRound(r.id) : undefined;
        return { ...r, owedYocto: (row ? await repos.backing.owedYocto(row) : 0n).toString() };
      }),
    );
    return { mode: this.mode, positions, rounds: own };
  }

  @Post('rounds')
  async open(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    this.writable();
    const b = parse(openBody, body);
    const maxRaise = BigInt(b.maxRaiseYocto);
    if (maxRaise < BACKING.minStakeYocto || maxRaise > BACKING.maxRaiseYocto)
      throw new ApiError(422, 'invalid_raise', 'the raise must be between 0.1 and 1,000,000 NEAR');
    if (b.skillId) {
      const skill = await this.deps.repos.skills.get(b.skillId);
      if (!skill) throw notFound('skill');
      if (skill.creatorId !== account.id) throw new ApiError(403, 'forbidden', 'only the skill’s writer can open a round for it');
    }
    if (this.mode === 'near') {
      if (!account.nearAccountId) throw new ApiError(422, 'near_account_required', 'link a NEAR account to open a round');
      return this.wallet(
        'open_round',
        { skill_id: b.skillId ?? null, share_bps: b.shareBps, cap_multiple_bps: b.capMultipleBps, max_raise: b.maxRaiseYocto },
        OPEN_ROUND_STORAGE_YOCTO,
      );
    }
    try {
      const row = await this.deps.repos.backing.openRound({
        writerId: account.id,
        skillId: b.skillId ?? null,
        shareBps: b.shareBps,
        capMultipleBps: b.capMultipleBps,
        maxRaiseYocto: b.maxRaiseYocto,
        mode: 'credits',
      });
      return { round: await this.deps.repos.backing.roundView(row.id) };
    } catch (err) {
      throw repoError(err);
    }
  }

  @Post('rounds/:id/back')
  @HttpCode(200)
  async back(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    this.writable();
    const rid = idOr404(roundId, id, 'backing round');
    const want = BigInt(parse(backBody, body).amountYocto);
    const round = await this.expectRound(rid);
    if (round.status !== 'open') throw new ApiError(409, 'round_not_open', 'this round is not open');
    if (round.writerId === account.id) throw new ApiError(409, 'own_round', 'you cannot back your own round');
    if (round.mode === 'near') {
      if (!account.nearAccountId) throw new ApiError(422, 'near_account_required', 'link a NEAR account to back a writer');
      // The contract keeps a new backer's record storage (well under 0.01 NEAR) from the attachment.
      return this.wallet('back', { round_id: round.chainRoundId }, want.toString(), GAS.back);
    }
    const ypc = this.yoctoPerCredit;
    return this.deps.repos.transaction(async (r) => {
      const locked = (await r.backing.lockRound(rid))!;
      if (locked.status !== 'open') throw new ApiError(409, 'round_not_open', 'this round is not open');
      const left = BigInt(locked.maxRaiseYocto) - BigInt(locked.raisedYocto);
      if (left <= 0n) throw new ApiError(409, 'round_full', 'this round has raised all it asked for');
      const existing = await r.backing.backingOf(rid, account.id);
      if (!existing && locked.backers >= BACKING.maxBackers)
        throw new ApiError(409, 'round_full', 'this round has the most backers it can take');
      // Whole credits only; the stake is cut to what is left of the raise.
      const capped = want < left ? want : left;
      const credits = capped / ypc;
      const stake = credits * ypc;
      if (credits <= 0n || (stake < BACKING.minStakeYocto && stake !== left))
        throw new ApiError(422, 'stake_too_small', 'the smallest stake is 0.1 NEAR');
      const spent = await r.ledger.spend({ accountId: account.id, amount: Number(credits), ref: `backing:${rid}`, kind: 'backing' });
      if (!spent.ok) {
        if (spent.error === 'insufficient_credits')
          throw new ApiError(402, 'insufficient_credits', 'backing uses paid credits; top up first', undefined, { need: spent.need, have: spent.have });
        throw new ApiError(422, spent.error, spent.message);
      }
      await r.backing.addStake(rid, account.id, stake);
      return { position: await r.backing.position(rid, account.id), stakedYocto: stake.toString() };
    });
  }

  @Post('rounds/:id/close')
  @HttpCode(200)
  async close(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    return this.end(id, 'closed', mustAccount(acc));
  }

  @Post('rounds/:id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    return this.end(id, 'cancelled', mustAccount(acc));
  }

  private async end(id: string, to: 'closed' | 'cancelled', account: AccountRow) {
    this.writable();
    const rid = idOr404(roundId, id, 'backing round');
    const round = await this.expectRound(rid);
    if (round.writerId !== account.id) throw new ApiError(403, 'forbidden', 'only the writer can end this round');
    if (round.status !== 'open') throw new ApiError(409, 'round_not_open', 'this round is not open');
    if (round.mode === 'near') return this.wallet(to === 'closed' ? 'close_round' : 'cancel_round', { round_id: round.chainRoundId });
    const ypc = this.yoctoPerCredit;
    await this.deps.repos.transaction(async (r) => {
      const locked = (await r.backing.lockRound(rid))!;
      if (locked.status !== 'open') throw new ApiError(409, 'round_not_open', 'this round is not open');
      await r.backing.setStatus(rid, to);
      if (to === 'closed') {
        // The raise goes to the writer (whole credits: every stake is a whole number of credits).
        const credits = BigInt(locked.raisedYocto) / ypc;
        if (credits > 0n) await credit(r, account.id, credits, `backing:raise:${rid}`);
      } else {
        for (const b of await r.backing.backingsOf(rid)) {
          const credits = BigInt(b.stakeYocto) / ypc;
          if (credits > 0n) await credit(r, b.backerId, credits, `backing:refund:${b.id}`);
          await r.backing.markRefunded(b.id);
        }
      }
    });
    return { round: await this.deps.repos.backing.roundView(rid) };
  }

  @Post('rounds/:id/claim')
  @HttpCode(200)
  async claim(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    this.writable();
    const rid = idOr404(roundId, id, 'backing round');
    const round = await this.expectRound(rid);
    const { repos } = this.deps;
    if (round.mode === 'near') {
      const b = await repos.backing.backingOf(rid, account.id);
      if (!b) throw new ApiError(404, 'not_found', 'you have not backed this round');
      return this.wallet(round.status === 'cancelled' ? 'refund' : 'claim', { round_id: round.chainRoundId });
    }
    if (round.status !== 'closed') throw new ApiError(409, 'round_not_closed', 'earnings are paid once the round closes');
    await repos.backing.settleFromSales(round.writerId);
    const ypc = this.yoctoPerCredit;
    return repos.transaction(async (r) => {
      const b = await r.backing.lockBacking(rid, account.id);
      if (!b) throw new ApiError(404, 'not_found', 'you have not backed this round');
      const fresh = (await r.backing.getRound(rid))!;
      const entitled = BigInt(fresh.raisedYocto) > 0n ? (BigInt(b.stakeYocto) * BigInt(fresh.backersEarnedYocto)) / BigInt(fresh.raisedYocto) : 0n;
      const credits = (entitled - BigInt(b.claimedYocto)) / ypc;
      if (credits <= 0n) throw new ApiError(409, 'nothing_to_claim', 'nothing to claim yet (whole credits only)');
      const claimed = BigInt(b.claimedYocto) + credits * ypc;
      await credit(r, account.id, credits, `backing:claim:${b.id}:${claimed}`);
      await r.backing.setClaimed(b.id, claimed);
      return { position: await r.backing.position(rid, account.id), claimedCredits: Number(credits) };
    });
  }

  /** near mode: the writer forwards the royalties a round is owed (the contract splits them). */
  @Post('rounds/:id/distribute')
  @HttpCode(200)
  async distribute(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    this.writable();
    const rid = idOr404(roundId, id, 'backing round');
    const round = await this.expectRound(rid);
    if (round.writerId !== account.id) throw new ApiError(403, 'forbidden', 'only the writer routes royalties from here');
    if (round.mode !== 'near') throw new ApiError(409, 'not_onchain', 'credits rounds are paid from resales automatically');
    if (round.status !== 'closed') throw new ApiError(409, 'round_not_closed', 'royalties are routed to closed rounds');
    const given = (body as { amountYocto?: unknown } | undefined)?.amountYocto;
    const amt = given === undefined ? await this.deps.repos.backing.owedYocto(round) : BigInt(parse(backBody, { amountYocto: given }).amountYocto);
    if (amt <= 0n) throw new ApiError(409, 'nothing_owed', 'no royalties to route yet');
    return this.wallet('distribute', { round_id: round.chainRoundId }, amt.toString());
  }

  /** near mode: mirrors the backing-contract events of a tx the caller signed. */
  @Post('sync')
  @HttpCode(200)
  async sync(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const reader = this.deps.near.backing;
    if (this.mode !== 'near' || !reader) throw new ApiError(409, 'not_onchain', 'backing is not on NEAR on this server');
    const { txHash } = parse(syncBody, body);
    let tx: BackingTx;
    try {
      tx = await reader.read(txHash, account.nearAccountId);
    } catch (err) {
      if (err instanceof BackingTxError) throw new ApiError(SYNC_STATUS[err.code], err.code, err.message);
      throw err;
    }
    const touched = await mirror(this.deps.repos, tx, account);
    const rounds = await Promise.all([...touched].map((r) => this.deps.repos.backing.roundView(r)));
    return { rounds: rounds.filter(Boolean) };
  }

  private async expectRound(rid: string): Promise<BackingRoundRow> {
    const round = await this.deps.repos.backing.getRound(rid);
    if (!round) throw notFound('backing round');
    return round;
  }
}

async function credit(r: Repos, accountId: string, credits: bigint, receipt: string): Promise<void> {
  const res = await r.ledger.topUp({ accountId, credits: Number(credits), receipt, note: 'backing' });
  if (!res.ok && res.error !== 'duplicate_topup') throw new ApiError(422, res.error, res.message);
}

function repoError(err: unknown): unknown {
  if (err instanceof RepoError) {
    if (err.code === 'not_found') return notFound('skill');
    if (err.code === 'forbidden') return new ApiError(403, err.code, err.message);
    return new ApiError(409, err.code, err.message);
  }
  return err;
}

/**
 * Applies a backing tx's events to the mirror. The events carry absolute totals (stake, raised,
 * backers_earned, claimed), so a replayed tx changes nothing; a payout is recorded once per tx.
 * Returns the round ids touched.
 */
async function mirror(repos: Repos, tx: BackingTx, account: AccountRow): Promise<Set<string>> {
  const touched = new Set<string>();
  for (const { event, data } of tx.events) {
    if (event === 'round_opened') {
      const chainId = str(data.id);
      const maxRaise = amount(data.max_raise);
      if (!chainId || maxRaise === null || str(data.writer) !== account.nearAccountId) continue;
      const existing = await repos.backing.roundByChainId(chainId);
      if (existing) {
        touched.add(existing.id);
        continue;
      }
      const skill = str(data.skill_id);
      const known = skill ? await repos.skills.get(skill) : undefined;
      try {
        const row = await repos.backing.openRound({
          writerId: account.id,
          skillId: known && known.creatorId === account.id ? skill : null,
          shareBps: Number(data.share_bps),
          capMultipleBps: Number(data.cap_multiple_bps),
          maxRaiseYocto: maxRaise.toString(),
          mode: 'near',
          chainRoundId: chainId,
        });
        touched.add(row.id);
      } catch (err) {
        if (!(err instanceof RepoError && err.code === 'duplicate_round')) throw err;
      }
      continue;
    }
    const chainId = str(data.round_id);
    const round = chainId ? await repos.backing.roundByChainId(chainId) : undefined;
    if (!round) continue;
    touched.add(round.id);
    switch (event) {
      case 'backed': {
        const backer = str(data.backer);
        const stake = amount(data.stake);
        const who = backer ? await repos.accounts.byNearAccount(backer) : undefined;
        if (who && stake !== null) await repos.backing.setStake(round.id, who.id, stake);
        break;
      }
      case 'round_closed':
      case 'round_cancelled':
        await repos.backing.setStatus(round.id, event === 'round_closed' ? 'closed' : 'cancelled');
        break;
      case 'royalty_distributed': {
        const amt = amount(data.amount);
        const toBackers = amount(data.to_backers);
        const toWriter = amount(data.to_writer);
        const earned = amount(data.backers_earned);
        if (amt === null || toBackers === null || toWriter === null || earned === null) break;
        await repos.backing.recordPayout({
          roundId: round.id,
          txHash: tx.hash,
          royaltyYocto: amt,
          toBackersYocto: toBackers,
          toWriterYocto: toWriter,
          backersEarnedYocto: earned,
        });
        break;
      }
      case 'claimed': {
        const backer = str(data.backer);
        const claimed = amount(data.claimed);
        const who = backer ? await repos.accounts.byNearAccount(backer) : undefined;
        const b = who ? await repos.backing.backingOf(round.id, who.id) : undefined;
        if (b && claimed !== null && claimed > BigInt(b.claimedYocto)) await repos.backing.setClaimed(b.id, claimed);
        break;
      }
      case 'refunded': {
        const backer = str(data.backer);
        const who = backer ? await repos.accounts.byNearAccount(backer) : undefined;
        const b = who ? await repos.backing.backingOf(round.id, who.id) : undefined;
        if (b) await repos.backing.markRefunded(b.id);
        break;
      }
    }
  }
  return touched;
}
