// Dev mode (the e2e backend's AUTH_MODE=dev) must not download the Privy SDK or NEAR Connect: both
// are dynamic imports that only privy mode (Privy) or a wallet action outside dev mode (NEAR Connect)
// ever fetch. Markers: Privy's default api host and NEAR Connect's storage key.
import { expect, test } from '@playwright/test';

const MARKERS = ['auth.privy.io', 'selected-wallet'];

test('dev mode loads no Privy or NEAR Connect code', async ({ page }) => {
  const bodies: Array<Promise<{ url: string; text: string }>> = [];
  page.on('response', (res) => {
    if (res.request().resourceType() === 'script')
      bodies.push(
        res.text().then(
          (text) => ({ url: res.url(), text }),
          () => ({ url: res.url(), text: '' }),
        ),
      );
  });
  await page.goto('/');
  await expect(page.getByTestId('s01-signin')).toBeEnabled();
  await page.goto('/market');
  await page.waitForLoadState('networkidle');
  const scripts = await Promise.all(bodies);
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts)
    for (const m of MARKERS) expect(s.text.includes(m), `${s.url} contains ${m}`).toBe(false);
});
