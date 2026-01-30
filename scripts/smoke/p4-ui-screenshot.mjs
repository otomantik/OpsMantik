/**
 * P4-2 UI — Playwright screenshot: Breakdown widgets on dashboard.
 * Saves: docs/WAR_ROOM/EVIDENCE/P4_2_UI/widgets.png
 *
 * Requires: auth state from auth-login-save-state.mjs (no addCookies).
 * Env: PROOF_STORAGE_STATE (default: docs/WAR_ROOM/EVIDENCE/auth/auth-state.json),
 *      SITE_ID or TEST_SITE_ID, PROOF_URL, PROOF_DASHBOARD_PATH override.
 * Usage: 1) node scripts/smoke/auth-login-save-state.mjs
 *        2) node scripts/smoke/p4-ui-screenshot.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const OUT_DIR = path.join(process.cwd(), 'docs', 'WAR_ROOM', 'EVIDENCE', 'P4_2_UI');
const AUTH_STATE_DIR = path.join(process.cwd(), 'docs', 'WAR_ROOM', 'EVIDENCE', 'auth');
const PROOF_STORAGE_STATE = process.env.PROOF_STORAGE_STATE || path.join(AUTH_STATE_DIR, 'auth-state.json');
const BASE_URL = process.env.PROOF_URL || 'http://localhost:3000';
const SITE_ID = process.env.SITE_ID || process.env.TEST_SITE_ID || '01d24667-ca9a-44e3-ab7a-7cd171ae653f';
const DASHBOARD_PATH = process.env.PROOF_DASHBOARD_PATH || `/dashboard/site/${SITE_ID}`;

if (!fs.existsSync(PROOF_STORAGE_STATE)) {
  console.error('NO STORAGE STATE; run node scripts/smoke/auth-login-save-state.mjs');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 900 },
  baseURL: BASE_URL,
  storageState: PROOF_STORAGE_STATE,
});

const page = await context.newPage();
await page.goto(BASE_URL + DASHBOARD_PATH, { waitUntil: 'networkidle', timeout: 20000 });

const url = page.url();
if (url.includes('/login') && !url.includes('/auth/callback')) {
  console.error('Redirected to login; auth state may be expired. Re-run auth-login-save-state.mjs');
  await context.close();
  await browser.close();
  process.exit(1);
}

await page.waitForTimeout(2000);

const widgets = page.locator('[data-testid="p4-breakdown"]');
const visible = await widgets.first().isVisible().catch(() => false);
if (visible) {
  await widgets.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: path.join(OUT_DIR, 'widgets.png'), fullPage: true });
console.log('P4-2 UI screenshot saved:', path.join(OUT_DIR, 'widgets.png'));

await context.close();
await browser.close();
