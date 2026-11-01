// Skills + Market (S07-S10) against the real backend (AUTH_MODE=dev).
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const PROMPT = 'Find the one gap a spreading liquid needs and block it first. Then collect the gems, nearest first.';

test('write a skill, see it as a draft, edit it into v2, read back the prompt, browse the market', async ({ page }) => {
  await signIn(page);

  // S08: new skill
  await page.goto('/skills/new');
  await expect(page.getByTestId('screen-s08')).toBeVisible();
  await page.getByTestId('s08-name').fill('Gap Sealer');
  await page.getByTestId('s08-summary').fill('Seals the gap, then collects.');
  await page.getByTestId('s08-prompt').fill(PROMPT);
  await page.getByTestId('s08-unlock-builder').check();
  await page.getByTestId('s08-tag-spreads').check();
  await page.getByTestId('s08-tag-liquid').check();
  await page.getByTestId('s08-save').click();
  await expect(page).toHaveURL(/\/skills\/skl_[0-9A-Z]{26}\/edit$/);
  const skillId = page.url().match(/skl_[0-9A-Z]{26}/)![0];
  await expect(page.getByTestId('s08-version-label')).toHaveText('v1');

  // S07: it is listed as a Draft
  await page.goto('/skills');
  const row = page.getByTestId(`s07-skill-row-${skillId}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId('s07-status')).toHaveText('Draft');

  // S08: read-back of the creator's own prompt, then an edit writes v2
  await row.getByTestId(`s07-edit-${skillId}`).click();
  await expect(page).toHaveURL(new RegExp(`/skills/${skillId}/edit$`));
  await expect(page.getByTestId('s08-prompt')).toHaveValue(PROMPT);
  await page.getByTestId('s08-reflexes').fill('Place a block toward water two tiles away or less.');
  await expect(page.getByTestId('s08-save')).toHaveText('Save as v2');
  await page.getByTestId('s08-save').click();
  await expect(page.getByTestId('s08-version-label')).toHaveText('v2');
  await expect(page.getByTestId('s08-save-state')).toContainText('Saved');

  await page.reload();
  await expect(page.getByTestId('s08-version-label')).toHaveText('v2');
  await expect(page.getByTestId('s08-prompt')).toHaveValue(PROMPT);
  await expect(page.getByTestId('s08-reflexes')).toHaveValue('Place a block toward water two tiles away or less.');
  // No private test run and no test gate: Mint is open on a saved version (it needs a wallet).
  await expect(page.getByTestId('s08-test')).toHaveCount(0);
  await expect(page.getByTestId('s08-mint')).toBeEnabled();
  await expect(page.getByTestId('s08-benchmark')).toHaveText('Runs at mint');

  // S09: the market loads with its filters; drafts are not on it
  await page.goto('/market');
  await expect(page.getByTestId('screen-s09')).toBeVisible();
  await expect(page.getByTestId('s09-filters')).toBeVisible();
  await expect(page.getByTestId('s09-result-line')).toBeVisible();
  await page.getByTestId('s09-tag-filter-spreads').click();
  await expect(page.getByTestId('s09-tag-filter-spreads')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('s09-result-line')).toContainText(/handles? spreads/);
  await expect(page.getByTestId(`s09-card-${skillId}`)).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(PROMPT);
});
