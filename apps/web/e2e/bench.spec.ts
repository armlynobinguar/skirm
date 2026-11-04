// Skill test bench against the real backend (AUTH_MODE=dev, V2_BRAIN=greedy: runs are free and the
// worker plays them headless, so no tick length matters).
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const PROMPT = 'Find the one gap a spreading liquid needs and block it first. Then collect the gems, nearest first.';

test('bench a draft, edit the prompt, re-run the seed, compare and open the debrief', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  await page.goto('/skills/new');
  await page.getByTestId('s08-name').fill('Bench Sealer');
  await page.getByTestId('s08-prompt').fill(PROMPT);
  await page.getByTestId('s08-unlock-builder').check();
  await page.getByTestId('s08-tag-liquid').check();
  await page.getByTestId('s08-save').click();
  await expect(page).toHaveURL(/\/skills\/skl_[0-9A-Z]{26}\/edit$/);
  const skillId = page.url().match(/skl_[0-9A-Z]{26}/)![0];

  // My skills links the draft to the bench.
  await page.goto('/skills');
  await page.getByTestId(`s07-bench-${skillId}`).click();
  await expect(page).toHaveURL(new RegExp(`/skills/bench\\?skill=${skillId}`));
  await expect(page.getByTestId('screen-bench')).toBeVisible();
  await expect(page.getByTestId('bench-cost')).toContainText('Free here');
  await expect(page.getByTestId('bench-prompt')).toHaveValue(PROMPT);

  // First run: the version's own prompt.
  await page.getByTestId('bench-run').click();
  const runs = page.getByTestId('bench-runs');
  await expect(runs.locator('li')).toHaveCount(1);
  await expect(runs.locator('[data-testid^="bench-debrief-"]')).toHaveCount(1, { timeout: 90_000 });

  // Edit the prompt and re-run the same seed.
  await page.getByTestId('bench-prompt').fill(`${PROMPT} Never stop to talk.`);
  await runs.locator('[data-testid^="bench-rerun-"]').first().click();
  await expect(runs.locator('li')).toHaveCount(2);
  await expect(runs.locator('[data-testid^="bench-debrief-"]')).toHaveCount(2, { timeout: 90_000 });
  await expect(runs).toContainText('edited prompt');

  // Side by side, with the word diff of the two prompts.
  const picks = runs.locator('[data-testid^="bench-pick-"]');
  await picks.nth(0).check();
  await picks.nth(1).check();
  const compare = page.getByTestId('bench-compare');
  await expect(compare.getByTestId('bench-compare-a')).toBeVisible();
  await expect(compare.getByTestId('bench-compare-b')).toBeVisible();
  await expect(compare.getByTestId('bench-diff')).toContainText('Never stop to talk.');

  // The debrief page.
  await runs.locator('[data-testid^="bench-debrief-"]').first().click();
  await expect(page).toHaveURL(/\/skills\/bench\/bnr_[0-9A-Z]{26}$/);
  await expect(page.getByTestId('screen-bench-run')).toBeVisible();
  await expect(page.getByTestId('bench-debrief')).toBeVisible();
  await expect(page.getByTestId('bench-run-prompt')).toContainText('Never stop to talk.');
});
