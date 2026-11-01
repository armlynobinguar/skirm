// Browser e2e against the real backend. Start it first:
//   apps/web/scripts/dev-backend.sh start
//   npm run e2e -w @skirm/web            (builds and serves the web app on :3000, or reuses one)
// Chromium comes preinstalled (PLAYWRIGHT_BROWSERS_PATH); never run `playwright install` here.
// PW_CHROMIUM=/path/to/chrome overrides the browser binary.
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.WEB_PORT ?? 3000);
const baseURL = process.env.WEB_URL ?? `http://localhost:${PORT}`;
const fallbackChromium = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? undefined : existsSync(fallbackChromium) ? fallbackChromium : undefined);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chromium' }],
  webServer: process.env.WEB_URL
    ? undefined
    : {
        command: process.env.E2E_SKIP_BUILD ? `npx next start -p ${PORT}` : `npx next build && npx next start -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
