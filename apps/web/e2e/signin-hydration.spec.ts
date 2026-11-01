// Regression: a handle typed into S01 before the page has hydrated must not be lost (judges and
// agents often type the moment the field appears). The page's scripts are held back so the typing
// lands on the server-rendered form, then released.
import { expect, test, type Route } from '@playwright/test';
import { uniqueHandle } from './helpers';

async function holdScripts(page: import('@playwright/test').Page) {
  const held: Route[] = [];
  let release = false;
  await page.route('**/_next/static/**/*.js', async (route) => {
    if (release) return route.continue();
    held.push(route);
  });
  return async () => {
    release = true;
    await Promise.all(held.splice(0).map((r) => r.continue()));
  };
}

test('a handle typed before hydration survives and signs in', async ({ page }) => {
  const release = await holdScripts(page);
  const handle = uniqueHandle('early');
  await page.goto('/', { waitUntil: 'commit' });
  const field = page.getByLabel('Handle');
  await field.pressSequentially(handle);
  await release();
  // Hydrated: the typed text is still there and Sign in works.
  await expect(page.getByTestId('s01-signin')).toBeEnabled();
  await expect(field).toHaveValue(handle);
  await page.getByTestId('s01-signin').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('topbar-account')).toHaveText(handle);
});

test('Enter pressed before hydration still signs in', async ({ page }) => {
  const release = await holdScripts(page);
  const handle = uniqueHandle('enter');
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByLabel('Handle').pressSequentially(handle);
  await page.getByLabel('Handle').press('Enter');
  await release();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('topbar-account')).toHaveText(handle);
});

test('typing immediately after navigation keeps every character', async ({ page }) => {
  const handle = uniqueHandle('fast');
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByLabel('Handle').fill(handle);
  await page.getByTestId('s01-signin').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('topbar-account')).toHaveText(handle);
});
