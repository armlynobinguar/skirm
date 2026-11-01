import { expect, test } from '@playwright/test';
import { signIn, uniqueHandle } from './helpers';

test('dev sign-in lands on Home with the shared header', async ({ page }) => {
  const handle = uniqueHandle();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your crew plays the match. You write how.' })).toBeVisible();
  await expect(page.getByTestId('s01-practice')).toContainText('Play a practice match against a bot crew: free, no keys needed');
  await signIn(page, handle);

  const header = page.getByTestId('topbar');
  const dock = page.getByTestId('account-dock');
  await expect(page.getByTestId('screen-s02')).toBeVisible();
  await expect(header.getByTestId('nav-play')).toHaveAttribute('aria-current', 'page');
  // The network, handle, credits, wallet and Elo sit in the account card, not the top bar.
  await expect(dock.getByText('Testnet', { exact: true })).toBeVisible();
  // A new account has 60 free credits and the starter crew (Rook leads on the Command deck).
  await expect(dock.getByTestId('topbar-allowance')).toHaveText(/60 free/);
  await expect(page.getByTestId('s02-deck')).toContainText('Rook');
  await expect(page.getByTestId('s02-tile-ranked')).toHaveAttribute('href', '/pvp');

  // The session survives a reload (handle kept in localStorage).
  await page.reload();
  await expect(dock.getByTestId('topbar-account')).toHaveText(handle);

  // Every nav group is one click away.
  await header.getByTestId('nav-market').click();
  await expect(page).toHaveURL(/\/market$/);
  await expect(page.getByTestId('screen-s09')).toBeVisible();
});
