// Practice against the greedy bot on the real backend, the judge path: a fresh account with no
// credits topped up, Quick practice from the Command deck, "Vs Greedy bot" already on, Start
// practice, Accept, Lock in, and the verdict with the match log hash. Start the backend with the
// offline brain and fast ticks so the match plays out in seconds:
//   V2_BRAIN=greedy V2_TICK_MS=200 apps/web/scripts/dev-backend.sh start
import { expect, test } from '@playwright/test';
import { signIn, uniqueHandle } from './helpers';

test('practice vs the greedy bot: accept, lock in, play out, verdict with the log hash', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueHandle('prac'));

  // Command deck → the crew screen on DEFAULT_PRACTICE with the bot on.
  await page.getByTestId('s02-tile-practice').click();
  await expect(page).toHaveURL(/\/maps\/copper-hollow\/crew\?d=easy&opponent=bot$/);
  await expect(page.getByTestId('s04-opponent').getByRole('radio', { name: 'Vs Greedy bot' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('s04-quick')).toBeVisible();
  await page.getByTestId('s04-queue').click();

  // No matchmaking: the match screen opens at once, marked as practice.
  await expect(page).toHaveURL(/\/matches\/mat_[^/?]+$/, { timeout: 15_000 });
  await expect(page.getByTestId('v2-practice')).toContainText('vs Greedy bot');
  await page.getByTestId('v2-accept').click();

  // The bot accepts and locks in by itself; on the greedy brain this crew holds nothing.
  await expect(page.getByTestId('v2-lockin')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('v2-hold')).toContainText('Free practice');
  await page.getByTestId('v2-lock').click();
  await expect(page.getByTestId('v2-live')).toBeVisible({ timeout: 15_000 });

  // Copper Hollow on Easy ends inside 60 ticks of 200 ms; then the banner and the debrief.
  await expect(page.getByTestId('v2-verdict')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('v2-verdict')).toHaveText(/Victory|Defeat|Draw/);
  await expect(page.getByTestId('v2-hash')).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId('v2-transcript')).toBeVisible();
});
