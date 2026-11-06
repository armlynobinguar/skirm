// /credits*: the caller's balance and ledger, and NEAR deposits.
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { AccountRow } from '@skirm/db';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError } from '../errors';
import { depositBody, parse } from '../validation';
import { ledgerRowView } from '../views';

@Controller('credits')
export class CreditsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  @Get()
  async credits(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const [b, rows] = await Promise.all([
      this.deps.repos.ledger.balance(account.id),
      this.deps.repos.ledger.rows(account.id, 100),
    ]);
    return {
      ...b,
      creditsPerNear: this.deps.config.CREDITS_PER_NEAR,
      rows: rows.map(ledgerRowView),
    };
  }

  /**
   * Verifies a `deposits.deposit()` tx (dev mode: `dev:<yocto>`) and credits it once. A batched tx
   * with several deposit() actions credits each one once (its own receipt key); a replay credits
   * only the actions not yet credited, and 409s when there are none.
   */
  @Post('deposits')
  @HttpCode(200)
  async deposit(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { txHash } = parse(depositBody, body);
    const { ledger } = this.deps.repos;
    // A dev hash is its own single receipt: skip the verifier for a replay.
    if (txHash.startsWith('dev:') && (await ledger.receiptCredited(txHash)))
      throw new ApiError(409, 'duplicate_receipt', 'this deposit was already credited');
    const v = await this.deps.near.deposits.verify(txHash, { senderId: account.nearAccountId });
    const parts = (v.parts ?? [{ receipt: v.receipt, credits: v.credits, amountYocto: v.amountYocto }]).filter(
      (p) => p.credits >= 1,
    );
    let credited = 0;
    let amountYocto = 0n;
    for (const p of parts) {
      const res = await ledger.topUp({ accountId: account.id, credits: p.credits, receipt: p.receipt });
      if (res.ok) {
        credited += p.credits;
        amountYocto += p.amountYocto;
        continue;
      }
      if (res.error === 'duplicate_topup') continue;
      if (credited > 0) break; // keep what was credited; the rest is retried by a replay
      throw new ApiError(422, res.error, res.message);
    }
    if (credited === 0)
      throw new ApiError(409, 'duplicate_receipt', 'this deposit was already credited');
    const b = await ledger.balance(account.id);
    return { credited, balance: b.balance, amountYocto: amountYocto.toString() };
  }
}
