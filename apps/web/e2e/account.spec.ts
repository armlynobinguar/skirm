// Account group (S15 Credits, S16 Profile) against the real backend (AUTH_MODE=dev).
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const SHOTS = process.env.ACCOUNT_SHOTS_DIR;

test('fresh account tops up with a dev deposit and links a NEAR account', async ({ page }) => {
  const handle = await signIn(page);

  // S15: a new account has 60 free credits and 0 paid.
  await page.goto('/account/credits');
  await expect(page.getByTestId('screen-s15')).toBeVisible();
  await expect(page.getByTestId('topbar-account')).toHaveText(handle);
  await expect(page.getByTestId('s15-balance-available')).toHaveText('0');
  await expect(page.getByTestId('s15-balance-held')).toHaveText('0');
  await expect(page.getByTestId('s15-allowance')).toHaveText('60 / 60');
  await expect(page.getByTestId('s15-allowance-reset')).toContainText(/Resets in \d+ h \d+ m|Resets in \d+ m/);
  await expect(page.getByTestId('s15-ledger')).toContainText('No transactions yet.');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s15-empty.png`, fullPage: true });

  // Top up 0.5 NEAR: pack → M02 → dev deposit.
  const topup = page.getByTestId('s15-topup');
  await topup.getByRole('radio', { name: /0\.5 NEAR/ }).click();
  await topup.getByRole('button', { name: 'Top up 0.5 NEAR' }).click();
  const m02 = page.getByTestId('m02-confirm-transaction');
  await expect(m02).toBeVisible();
  await expect(page.getByTestId('m02-item')).toHaveText('Top up 500 credits');
  await expect(page.getByTestId('m02-price')).toHaveText('0.5 NEAR');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s15-m02.png` });
  await page.getByTestId('m02-confirm').click();
  await expect(page.getByTestId('m02-done')).toBeVisible();
  await page.getByTestId('m02-done-close').click();
  await expect(m02).toBeHidden();

  await expect(page.getByTestId('s15-balance-available')).toHaveText('500');
  const row = page.locator('[data-testid^="s15-ledger-row-"][data-type="topup"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Top-up');
  await expect(row).toContainText('0.5 NEAR at 1,000 credits per NEAR');
  await expect(row).toContainText('+500');
  await expect(page.getByTestId('topbar-credits')).toContainText('500');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s15-after-topup.png`, fullPage: true });

  // S16: the starter agents and the account rank, then link a NEAR account through M01 (dev mode trusts the id).
  await page.getByTestId('account-badge').click();
  await page.getByTestId('topbar-account').click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('screen-s16')).toBeVisible();
  await expect(page.getByTestId('s16-agent-name')).toHaveText(['Rook', 'Wren', 'Moss']);
  await expect(page.getByTestId('s16-rank-elo')).toHaveText('1,200');
  await expect(page.getByTestId('s16-matches')).toContainText('No matches yet');
  await expect(page.getByTestId('s16-handle')).toHaveText(handle);
  await expect(page.getByTestId('s16-near-none')).toBeVisible();
  await expect(page.getByTestId('s16-credits')).toContainText('500');

  const nearId = `${handle.replace(/[^a-z\d_-]/g, '')}.testnet`;
  await page.getByTestId('s16-connect-wallet').click();
  await expect(page.getByTestId('m01-connect-wallet')).toBeVisible();
  await page.getByTestId('m01-wallet-mynearwallet').click();
  await page.getByTestId('m01-account-input').fill(nearId);
  await page.getByTestId('m01-connect').click();
  await expect(page.getByTestId('m01-connect-wallet')).toBeHidden();
  await expect(page.getByTestId('s16-near-account')).toHaveText(nearId);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s16-linked.png`, fullPage: true });

  // The linked account shows on S15 too.
  await page.getByTestId('s16-credits').click();
  await expect(page.getByTestId('s15-wallet-account')).toHaveText(nearId);

  // S16 profile facts from /me, Settings (usePreferences) and Disconnect (DELETE /me/near).
  await page.goto('/account');
  await expect(page.getByTestId('s16-joined')).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  await expect(page.getByTestId('s16-royalties')).toHaveText('0 NEAR');
  await page.getByTestId('s16-sfx').uncheck();
  await page.getByTestId('s16-replay-speed').selectOption('2');
  await page.getByTestId('s16-save-settings').click();
  await expect(page.getByTestId('topbar-sfx')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.getByTestId('s16-replay-speed')).toHaveValue('2');
  await expect(page.getByTestId('s16-sfx')).not.toBeChecked();
  await page.getByTestId('s16-disconnect-wallet').click();
  await expect(page.getByTestId('s16-near-none')).toBeVisible();

  // Sign out returns to S01.
  await page.getByTestId('s16-sign-out').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('topbar-account')).toHaveCount(0);
});

test('S15 and S16 fit a 360 px phone; amounts must buy whole credits; Esc closes M02', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page);
  const noSideScroll = async () =>
    expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0);

  await page.goto('/account/credits');
  await expect(page.getByTestId('s15-balance-available')).toHaveText('0');
  await noSideScroll();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s15-phone.png`, fullPage: true });

  // A remainder below one credit would be paid and never credited (the api floors).
  const field = page.getByLabel('Other amount');
  await field.fill('2.34567');
  await page.getByTestId('s15-custom-submit').click();
  await expect(page.getByTestId('s15-custom-amount')).toContainText('2.345 NEAR buys 2,345 credits');
  await expect(page.getByTestId('m02-confirm-transaction')).toHaveCount(0);

  // Keyboard: Enter submits, M02 opens, Esc closes it and focus returns to the form.
  await field.fill('2.345');
  await field.press('Enter');
  await expect(page.getByTestId('m02-price')).toHaveText('2.345 NEAR');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('m02-confirm-transaction')).toHaveCount(0);
  await expect(page.getByTestId('s15-custom-amount').locator(':focus')).toHaveCount(1);

  await page.goto('/account');
  await expect(page.getByTestId('s16-agent-name')).toHaveCount(3);
  await noSideScroll();
  // Regression: the empty-list primary button painted ink text on the chalk fill (unreadable).
  const start = page.getByTestId('s16-matches-start');
  await expect(start).toHaveText('Start playing');
  const [fg, bg] = await start.evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.color, cs.backgroundColor];
  });
  expect(fg).not.toBe(bg);
  const lum = (c: string) => {
    const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  expect(Math.abs(lum(fg) - lum(bg))).toBeGreaterThan(100);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s16-phone.png`, fullPage: true });
});
