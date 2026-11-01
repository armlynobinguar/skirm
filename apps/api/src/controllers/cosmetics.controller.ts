// /cosmetics*: premium palette entries (@skirm/shared COSMETICS), bought with paid credits only.
// Purely visual; PATCH /agents/:id refuses a premium look the owner has not bought.
import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { AccountRow } from '@skirm/db';
import { COSMETICS, cosmeticColor } from '@skirm/shared';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';

const ITEMS = COSMETICS.map((c) => ({ ...c, color: cosmeticColor(c) }));

@Controller('cosmetics')
export class CosmeticsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  @Get()
  async list(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    return { items: ITEMS, owned: await this.deps.repos.cosmetics.owned(account.id) };
  }

  /** Buying an item the player already owns is a no-op `200` (nothing is charged twice). */
  @Post(':id/buy')
  @HttpCode(200)
  async buy(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const res = await this.deps.repos.cosmetics.buy(account.id, id);
    if (res.ok) return { owned: res.owned };
    if (res.error === 'not_found') throw notFound('cosmetic');
    if (res.error === 'insufficient_credits')
      throw new ApiError(
        402,
        'insufficient_credits',
        'cosmetics are bought with paid credits; top up first',
        undefined,
        { need: res.need, have: res.have },
      );
    throw new ApiError(422, res.error, res.message);
  }
}
