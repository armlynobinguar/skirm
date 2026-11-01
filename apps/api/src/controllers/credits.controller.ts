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

  /** Verifies a `deposits.deposit()` tx (dev mode: `dev:<yocto>`) and credits it once. */
  @Post('deposits')
  @HttpCode(200)
  async deposit(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { txHash } = parse(depositBody, body);
    const { ledger } = this.deps.repos;
    if (await ledger.receiptCredited(txHash))
      throw new ApiError(409, 'duplicate_receipt', 'this deposit was already credited');
    const v = await this.deps.near.deposits.verify(txHash, { senderId: account.nearAccountId });
    const res = await ledger.topUp({
      accountId: account.id,
      credits: v.credits,
      receipt: v.receipt,
    });
    if (!res.ok) {
      if (res.error === 'duplicate_topup')
        throw new ApiError(409, 'duplicate_receipt', 'this deposit was already credited');
      throw new ApiError(422, res.error, res.message);
    }
    const b = await ledger.balance(account.id);
    return { credited: v.credits, balance: b.balance, amountYocto: v.amountYocto.toString() };
  }
}
