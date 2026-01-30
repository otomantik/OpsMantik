/**
 * GO W3 — E2E-lite for 3 fragile flows:
 * 1) Dashboard (or login) loads without console errors
 * 2) Settings opens from overflow menu (mobile viewport)
 * 3) Seal modal -> seal API -> UI updates
 *
 * Env: BASE_URL / PLAYWRIGHT_BASE_URL, E2E_SITE_ID / PLAYWRIGHT_SITE_ID.
 * Auth: App uses Google OAuth; when redirected to login, tests still run (no console errors).
 */
import { test, expect } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const siteId = process.env.E2E_SITE_ID || process.env.PLAYWRIGHT_SITE_ID || '00000000-0000-0000-0000-000000000000';

test.describe('Dashboard Watchtower E2E-lite', () => {
  test('1) dashboard/site/[siteId] or login loads without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error') {
        const text = msg.text();
        consoleErrors.push(text);
      }
    });

    await page.goto(`/dashboard/site/${siteId}`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/(dashboard\/site\/|login)/);

    expect(consoleErrors, `Expected no console errors, got: ${consoleErrors.join('; ')}`).toHaveLength(0);
  });

  test('2) settings opens from overflow menu (mobile viewport)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`/dashboard/site/${siteId}`, { waitUntil: 'networkidle' });
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth required; run with session or skip');
      return;
    }

    await page.getByTestId('header-overflow-menu-trigger').click();
    await page.getByTestId('menu-item-settings').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
  });

  test('3) seal modal -> seal API -> UI updates', async ({ page }) => {
    await page.goto(`/dashboard/site/${siteId}`, { waitUntil: 'networkidle' });
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth required for seal flow');
      return;
    }

    const sealDeal = page.getByTestId('hunter-card-seal-deal');
    const count = await sealDeal.count();
    if (count === 0) {
      test.skip(true, 'No intent in queue; seal deal button not present');
      return;
    }

    await sealDeal.first().click();
    await expect(page.getByTestId('seal-modal')).toBeVisible();

    const chip = page.locator('[data-testid="seal-modal"] button').filter({ hasText: /TRY/ }).first();
    await chip.click();
    await page.getByTestId('seal-modal-confirm').click();

    await expect(page.getByTestId('seal-modal')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Deal sealed.', { exact: false })).toBeVisible({ timeout: 5000 });
  });
});
