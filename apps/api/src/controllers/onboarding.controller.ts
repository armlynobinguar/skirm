// /onboarding*: the guided first match's progress, the "first steps" checklist on home and the
// starter skill templates (@skirm/shared TUTORIAL_STEPS, FIRST_STEPS, SKILL_TEMPLATES). The tips
// themselves are static and live in @skirm/shared; only how far each player got is stored.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { AccountRow, OnboardingFacts, OnboardingRow } from '@skirm/db';
import {
  FIRST_STEPS,
  SKILL_TEMPLATES,
  TUTORIAL_MATCH,
  TUTORIAL_STEPS,
  skillTemplateById,
  type FirstStepId,
  type SkillTemplate,
} from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { notFound } from '../errors';
import { parse } from '../validation';
import { skillPublic } from '../views';

const tutorialBody = z
  .object({
    /** Tips seen so far (it only grows). */
    step: z.number().int().min(0).max(TUTORIAL_STEPS.length).optional(),
    /** `done`: finished; `skipped`; `restart`: from the first tip again. */
    status: z.enum(['done', 'skipped', 'restart']).optional(),
  })
  .refine((b) => b.step !== undefined || b.status !== undefined, 'step or status is required');

export type TutorialStatus = 'new' | 'in_progress' | 'done' | 'skipped';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** GET /onboarding's body: the tutorial, the checklist and whether home shows it. */
export function onboardingView(row: OnboardingRow, facts: OnboardingFacts) {
  const status: TutorialStatus = row.tutorialCompletedAt
    ? 'done'
    : row.tutorialSkippedAt
      ? 'skipped'
      : row.tutorialStep > 0
        ? 'in_progress'
        : 'new';
  const done: Record<FirstStepId, boolean> = {
    tutorial: status === 'done' || status === 'skipped',
    practice: facts.practiced,
    skill: facts.wroteSkill,
    equip: facts.equippedOwnSkill,
    pvp: facts.playedPvp,
  };
  const items = FIRST_STEPS.map((s) => ({ id: s.id, done: done[s.id] }));
  const allDone = items.every((i) => i.done);
  const dismissed = !!row.checklistDismissedAt;
  return {
    tutorial: {
      status,
      step: Math.min(row.tutorialStep, TUTORIAL_STEPS.length),
      steps: TUTORIAL_STEPS.length,
      match: TUTORIAL_MATCH,
      completedAt: iso(row.tutorialCompletedAt),
      skippedAt: iso(row.tutorialSkippedAt),
    },
    checklist: { items, done: allDone, dismissed },
    /** Home shows the checklist until every item is done or the player dismissed it. */
    showChecklist: !allDone && !dismissed,
  };
}

const templateView = (t: SkillTemplate) => ({
  id: t.id,
  name: t.name,
  summary: t.summary,
  bestFor: t.bestFor,
  lesson: t.lesson,
  prompt: t.prompt,
  reflexes: t.reflexes,
  requires_actions: t.requiresActions,
  handles_tags: t.handlesTags,
});

@Controller('onboarding')
export class OnboardingController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  private async view(accountId: string, row?: OnboardingRow) {
    const { onboarding } = this.deps.repos;
    const [r, facts] = await Promise.all([row ?? onboarding.get(accountId), onboarding.facts(accountId)]);
    return onboardingView(r, facts);
  }

  @Get()
  async get(@CurrentAccount() acc?: AccountRow) {
    return this.view(mustAccount(acc).id);
  }

  /** Tips seen, or the tutorial's end. A `step` and a `status` in one call: the step lands first. */
  @Put('tutorial')
  async tutorial(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(tutorialBody, body);
    const { onboarding } = this.deps.repos;
    let row: OnboardingRow | undefined;
    if (b.step !== undefined) row = await onboarding.seen(account.id, b.step);
    if (b.status === 'done' || b.status === 'skipped')
      row = await onboarding.end(account.id, b.status, TUTORIAL_STEPS.length);
    else if (b.status === 'restart') row = await onboarding.restart(account.id);
    return this.view(account.id, row);
  }

  @Post('checklist/dismiss')
  @HttpCode(200)
  async dismiss(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    return this.view(account.id, await this.deps.repos.onboarding.dismissChecklist(account.id));
  }

  /** The starter strategies with their full text: they are examples, not secret. */
  @Get('templates')
  templates(@CurrentAccount() acc?: AccountRow) {
    mustAccount(acc);
    return SKILL_TEMPLATES.map(templateView);
  }

  /**
   * Copies a template into a new draft skill of the caller's (version 1, sealed into the vault like
   * any POST /skills). The draft is theirs to edit, mint and sell; copying again makes another.
   */
  @Post('templates/:id/copy')
  async copy(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const t = skillTemplateById(id);
    if (!t) throw notFound('template');
    const sealed = await this.deps.vault.encryptSkill(t.prompt, t.reflexes);
    const v = await this.deps.repos.skills.create(
      account.id,
      {
        name: t.name,
        summary: t.summary,
        requiresActions: t.requiresActions,
        handlesTags: t.handlesTags,
        royaltyBps: 500,
      },
      sealed,
    );
    return skillPublic(v);
  }
}
