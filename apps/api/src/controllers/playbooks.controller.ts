// /playbooks*: crew playbooks, one crew-level strategy per player (who hauls, who scouts, when to
// regroup, goal or deny), picked at lock-in. The text goes straight into the vault and comes back
// out only in GET /playbooks/:id, only to its owner; every other response carries the name alone.
// A text the speech filter calls abusive is refused (the same guard agent speech passes).
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { AccountRow, PlaybookView } from '@skirm/db';
import { filterSpeech } from '@skirm/decision-engine/v2';
import { DEFAULTS } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { parse } from '../validation';
import { idOr404 } from './util';

const { maxChars, nameMaxChars, maxSaved } = DEFAULTS.playbooks;
const chars = (v: string) => [...v].length;

export const playbookId = z.string().regex(/^pbk_[0-9A-HJKMNP-TV-Z]{26}$/);
const name = z
  .string()
  .trim()
  .min(1, 'name: at least 1 character')
  .refine((v) => chars(v) <= nameMaxChars, `name: at most ${nameMaxChars} characters`);
/** Counted in characters (code points), like the agents' instructions. */
const text = z
  .string()
  .trim()
  .min(1, 'text: at least 1 character')
  .refine((v) => chars(v) <= maxChars, `text: at most ${maxChars} characters`);

const createBody = z.object({ name, text }).strict();
const updateBody = z
  .object({ name: name.optional(), text: text.optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.text !== undefined, 'send a name or a text');
const selectBody = z.object({ id: playbookId.nullable() }).strict();

/** What every response shows of a playbook: never its text. */
export function playbookPublic(p: PlaybookView) {
  return { id: p.id, name: p.name, selected: p.selected, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

function screened(t: string): string {
  const f = filterSpeech(t, []);
  if (!f.ok && f.reason === 'abuse') throw new ApiError(422, 'playbook_refused', 'the playbook was refused by the filter');
  return t;
}

@Controller('playbooks')
export class PlaybooksController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  /** The caller's playbooks (names only), with the cap. */
  @Get()
  async list(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const rows = await this.deps.repos.playbooks.list(account.id);
    return { playbooks: rows.map(playbookPublic), max: maxSaved, maxChars };
  }

  @Post()
  async create(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(createBody, body);
    const sealed = await this.deps.vault.encryptPlaybook(screened(b.text));
    return playbookPublic(await this.deps.repos.playbooks.create(account.id, b.name, sealed));
  }

  /** The owner alone reads the text back. */
  @Get(':id')
  async get(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const pid = idOr404(playbookId, id, 'playbook');
    const [view, sealed] = await Promise.all([this.deps.repos.playbooks.get(account.id, pid), this.deps.repos.playbooks.loadSealed(account.id, pid)]);
    if (!view || !sealed) throw notFound('playbook');
    return { ...playbookPublic(view), text: await this.deps.vault.decryptPlaybook(sealed) };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const pid = idOr404(playbookId, id, 'playbook');
    const b = parse(updateBody, body);
    const sealed = b.text !== undefined ? await this.deps.vault.encryptPlaybook(screened(b.text)) : undefined;
    const v = await this.deps.repos.playbooks.update(account.id, pid, { ...(b.name !== undefined ? { name: b.name } : {}), ...(sealed ? { sealed } : {}) });
    if (!v) throw notFound('playbook');
    return playbookPublic(v);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const pid = idOr404(playbookId, id, 'playbook');
    if (!(await this.deps.repos.playbooks.delete(account.id, pid))) throw notFound('playbook');
    return { deleted: true };
  }

  /** `{ id }`: the playbook lock-in starts with (null: none). Lock-in may still pick another. */
  @Post('select')
  @HttpCode(200)
  async select(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { id } = parse(selectBody, body);
    if (!(await this.deps.repos.playbooks.select(account.id, id))) throw notFound('playbook');
    return { selected: id };
  }
}
