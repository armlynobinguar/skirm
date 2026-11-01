// v2 PvP against the real backend: two fresh players top up (dev deposit), queue a ranked v2 match
// from the hub, accept on the hub's VS takeover, lock in and watch it play out on one shared map to a
// result. The agents are played by whatever brain realtime booted: Haiku 5.5 when OPENROUTER_API_KEY
// is set (up to 150 ticks of 2 s, about 5 minutes), else the offline greedy brain (usually under 2
// minutes).
import { expect, test, type Page } from '@playwright/test';
import { uniqueHandle } from './helpers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Dev-mode deposit (a trusted `dev:<yocto>` hash): 1 NEAR of credits, enough for a match hold. */
async function topUp(page: Page, handle: string) {
  const res = await page.request.post(`${API_URL}/credits/deposits`, {
    headers: { 'x-dev-user': handle },
    data: { txHash: `dev:1000000000000000000000000:${handle}` },
  });
  expect(res.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('s11-credits-chip')).toHaveText(/1,060 credits to spend/);
}

const SCREENS = process.env.PVP_SCREENS_DIR;

/** S01 dev sign-in, then S11. Like helpers.signIn, but it checks the header on /pvp, not on Home,
 * so this spec does not depend on the Play screens. */
async function signIn(page: Page, handle = uniqueHandle('pvp')): Promise<string> {
  await page.goto('/');
  // A fill before hydration is lost (the button stays disabled), so fill until it takes.
  await expect(async () => {
    await page.getByLabel('Handle').fill(handle);
    await expect(page.getByTestId('s01-signin')).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId('s01-signin').click();
  await expect(page).toHaveURL(/\/play$/);
  await page.goto('/pvp');
  await expect(page.getByTestId('topbar-account')).toHaveText(handle);
  return handle;
}

/** Phones from 360 px: the page never scrolls sideways (wide parts scroll inside their own box). */
async function expectNoSideScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string) {
  if (SCREENS) await page.screenshot({ path: `${SCREENS}/${name}.png`, fullPage: true });
}

test('two players play a v2 match: queue, accept, lock in, live arena with comms, result and Elo', async ({ browser }) => {
  test.setTimeout(480_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const handleA = await signIn(a, uniqueHandle('pvpa'));
  const handleB = await signIn(b, uniqueHandle('pvpb'));
  await topUp(a, handleA);
  await topUp(b, handleB);

  // Hub: ranked by default, Rook picked, the hold is shown before queueing.
  await expect(a.getByTestId('screen-s11')).toBeVisible();
  await expect(a.getByTestId('topbar').getByTestId('nav-pvp')).toHaveAttribute('aria-current', 'page');
  await expect(a.getByTestId('s11-agent-rook')).toHaveAttribute('aria-checked', 'true');
  await expect(a.getByTestId('s11-elo')).toHaveText('1,200');
  await expect(a.getByTestId('s11-cost')).toContainText('Holds 30 credits');
  await shot(a, 'v2-hub');
  await a.getByTestId('s11-find-match').click();
  await expect(a.getByRole('heading', { name: 'Finding a match' })).toBeVisible();
  await b.getByTestId('s11-find-match').click();

  // Found: the hub shows the VS takeover (rival hidden); accepting there opens the v2 match screen.
  for (const p of [a, b]) await expect(p.getByTestId('s11-vs')).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId('s11-vs')).not.toContainText(handleB);
  await shot(a, 'v2-found');
  await a.getByTestId('s11-vs-accept').click();
  await b.getByTestId('s11-vs-accept').click();
  await expect(a).toHaveURL(/\/matches\/mat_[^/?]+$/, { timeout: 15_000 });
  await expect(b).toHaveURL(a.url(), { timeout: 15_000 });

  // Lock-in: ranked plays Standard; the rival is still hidden.
  for (const p of [a, b]) await expect(p.getByTestId('v2-lockin')).toBeVisible();
  await expect(a.getByTestId('v2-lockin')).toContainText('Ranked plays every agent at Standard');
  await expect(a.getByTestId('v2-lockin')).not.toContainText(handleB);
  await shot(a, 'v2-lockin');
  await a.getByTestId('v2-lock').click();
  await b.getByTestId('v2-lock').click();

  // Live: the intro plays once at the start (about 9 s); Enter skips it (and does nothing without it).
  for (const p of [a, b]) await expect(p.getByTestId('v2-live')).toBeVisible({ timeout: 20_000 });
  for (const p of [a, b]) {
    await p.keyboard.press('Enter');
    await expect(p.getByTestId('v2-intro')).toHaveCount(0, { timeout: 15_000 });
  }
  // The rival is named, the clock runs, the arena draws this crew's view.
  await expect(a.getByTestId('v2-live')).toContainText(handleB);
  await expect(b.getByTestId('v2-live')).toContainText(handleA);
  await expect(a.getByTestId('v2-clock')).not.toHaveText('5:00', { timeout: 15_000 });
  await a.waitForTimeout(20_000);
  await shot(a, 'v2-live');
  await a.setViewportSize({ width: 360, height: 800 });
  await expectNoSideScroll(a);
  await shot(a, 'v2-live-phone');
  await a.setViewportSize({ width: 1280, height: 720 });

  // Result: the banner, then the debrief at /matches/[id]/result: one victory and one defeat, or a
  // draw on both sides, with the log hash.
  await expect(a.getByTestId('v2-ended')).toBeVisible({ timeout: 360_000 });
  await expect(b.getByTestId('v2-ended')).toBeVisible({ timeout: 15_000 });
  const va = await a.getByTestId('v2-verdict').innerText();
  const vb = await b.getByTestId('v2-verdict').innerText();
  expect([va, vb].sort().join('/')).toMatch(/^(Defeat\/Victory|Draw\/Draw)$/i);
  await expect(a.getByTestId('v2-hash')).toHaveText(/^[0-9a-f]{64}$/);
  await shot(a, 'v2-result');

  // Back on the hub (ranked "Queue again"), a decided ranked match moved the player's own Elo.
  await a.getByTestId('v2-again').click();
  await expect(a.getByTestId('screen-s11')).toBeVisible();
  if (/draw/i.test(va)) await expect(a.getByTestId('s11-elo')).toHaveText('1,200');
  else await expect(a.getByTestId('s11-elo')).toHaveText(/victory/i.test(va) ? '1,216' : '1,184');

  await ctxA.close();
  await ctxB.close();
});

test('queue and cancel with Esc', async ({ page }) => {
  const handle = await signIn(page);
  await topUp(page, handle);
  await page.getByTestId('s11-find-match').click();
  await expect(page.getByTestId('s11-cancel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('s11-find-match')).toBeVisible();
});

test('a new player without credits is sent to top up', async ({ page }) => {
  await signIn(page);
  // 60 free credits cover a 2-agent ranked match (60); a third agent makes the hold 90.
  await page.getByTestId('s11-agent-wren').click();
  await page.getByTestId('s11-agent-moss').click();
  await expect(page.getByTestId('s11-cost')).toContainText('Holds 90 credits');
  await expect(page.getByTestId('s11-topup')).toHaveAttribute('href', '/account/credits');
});
