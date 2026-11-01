// Shared e2e helpers. Every test signs in as a fresh handle, so tests never share account state.
import { expect, type Page } from '@playwright/test';

export const uniqueHandle = (prefix = 'e2e') => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** S01 dev sign-in; resolves on Home (S02) with the header showing the handle. */
export async function signIn(page: Page, handle = uniqueHandle()): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Handle').fill(handle);
  await page.getByTestId('s01-signin').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('topbar-account')).toHaveText(handle);
  return handle;
}
