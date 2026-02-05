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
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const siteId = process.env.E2E_SITE_ID || process.env.PLAYWRIGHT_SITE_ID || '00000000-0000-0000-0000-000000000000';
const sitePublicId = process.env.E2E_SITE_PUBLIC_ID || process.env.PLAYWRIGHT_SITE_PUBLIC_ID || '';
const callEventSecret = process.env.E2E_CALL_EVENT_SECRET || process.env.PLAYWRIGHT_CALL_EVENT_SECRET || '';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const origin = new URL(baseUrl).origin;

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

  test('4) call-event signed request: happy path', async ({ request }) => {
    if (!sitePublicId || !callEventSecret || !supabaseUrl || !serviceRoleKey) {
      test.skip(true, 'Missing E2E_SITE_PUBLIC_ID / E2E_CALL_EVENT_SECRET / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL');
      return;
    }

    // Provision secret (service-role only). If migrations not applied in the env, skip.
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const rotate = await admin.rpc('rotate_site_secret_v1', {
      p_site_public_id: sitePublicId,
      p_current_secret: callEventSecret,
      p_next_secret: null,
    });
    if (rotate.error) {
      test.skip(true, `rotate_site_secret_v1 unavailable: ${rotate.error.message}`);
      return;
    }

    const ts = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({
      site_id: sitePublicId,
      fingerprint: `e2e_fp_${ts}`,
      phone_number: 'tel:+900000000000',
    });
    const sig = createHmac('sha256', callEventSecret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');

    const res = await request.post(`${origin}/api/call-event`, {
      data: rawBody,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'x-ops-site-id': sitePublicId,
        'x-ops-ts': String(ts),
        'x-ops-signature': sig,
      },
    });

    expect(res.status(), await res.text()).toBe(200);
    const json = await res.json().catch(() => ({}));
    expect(json).toMatchObject({ status: 'matched' });
    expect(typeof json.call_id).toBe('string');
  });

  test('5) call-event signed request: replay rejected (old ts)', async ({ request }) => {
    const ts = Math.floor(Date.now() / 1000) - 1000; // > 300s old
    const rawBody = JSON.stringify({ site_id: sitePublicId || '0'.repeat(32), fingerprint: `e2e_fp_${ts}` });
    const sig = createHmac('sha256', callEventSecret || 'dummy').update(`${ts}.${rawBody}`, 'utf8').digest('hex');

    const res = await request.post(`${origin}/api/call-event`, {
      data: rawBody,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'x-ops-site-id': sitePublicId || '0'.repeat(32),
        'x-ops-ts': String(ts),
        'x-ops-signature': sig,
      },
    });

    expect(res.status()).toBe(401);
  });

  test('6) queue: undo or cancel button works when present', async ({ page }) => {
    await page.goto(`/dashboard/site/${siteId}`, { waitUntil: 'networkidle' });
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth required for undo/cancel flow');
      return;
    }

    const undo = page.getByTitle('Undo last action');
    const cancel = page.getByTitle('Cancel deal');

    if ((await undo.count()) === 0 && (await cancel.count()) === 0) {
      test.skip(true, 'No undo/cancel actions available in current dataset');
      return;
    }

    if ((await undo.count()) > 0) {
      await undo.first().click();
      await expect(page.getByText(/Undone\./)).toBeVisible({ timeout: 5000 });
      return;
    }

    await cancel.first().click();
    await expect(page.getByText(/Deal cancelled\./)).toBeVisible({ timeout: 5000 });
  });
});
