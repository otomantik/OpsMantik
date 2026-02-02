/**
 * P4-3 Charts — Playwright screenshots: Source + Location breakdown cards.
 * Saves: source-donut.png, location-bars.png (or fallback source-card.png, location-card.png + full.png on failure).
 *
 * Requires: auth state from auth-login-save-state.mjs (no addCookies).
 * Env: PROOF_STORAGE_STATE (default: docs/_archive/2026-02-02/WAR_ROOM/EVIDENCE/auth/auth-state.json),
 *      SITE_ID or TEST_SITE_ID, PROOF_URL, PROOF_DASHBOARD_PATH override.
 * Usage: 1) node scripts/smoke/auth-login-save-state.mjs
 *        2) node scripts/smoke/p4-3-screenshot.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const OUT_DIR = path.join(process.cwd(), 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'P4_3_CHARTS');
const AUTH_STATE_DIR = path.join(process.cwd(), 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'auth');
const PROOF_STORAGE_STATE = process.env.PROOF_STORAGE_STATE || path.join(AUTH_STATE_DIR, 'auth-state.json');
const TIMEOUT_MS = 30000;
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
const url = BASE_URL + DASHBOARD_PATH;

await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });

const currentUrl = page.url();
if (currentUrl.includes('/login') && !currentUrl.includes('/auth/callback')) {
  console.error('Redirected to login; auth state may be expired. Re-run auth-login-save-state.mjs');
  await context.close();
  await browser.close();
  process.exit(1);
}

let foundContainer = false;
try {
  await page.waitForSelector('[data-testid="p4-breakdown"]', { timeout: TIMEOUT_MS });
  foundContainer = true;
} catch {
  // continue
}

if (foundContainer) {
  await page.locator('[data-testid="p4-breakdown"]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
}

let sourceVisible = false;
let locationVisible = false;
try {
  await page.waitForSelector('[data-testid="p4-source-card"]', { timeout: TIMEOUT_MS });
  sourceVisible = true;
} catch {
  // continue
}
try {
  await page.waitForSelector('[data-testid="p4-location-card"]', { timeout: TIMEOUT_MS });
  locationVisible = true;
} catch {
  // continue
}

if (sourceVisible && locationVisible) {
  const sourceCard = page.locator('[data-testid="p4-source-card"]').first();
  const locationCard = page.locator('[data-testid="p4-location-card"]').first();
  await sourceCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await sourceCard.screenshot({ path: path.join(OUT_DIR, 'source-donut.png') });
  console.log('Saved:', path.join(OUT_DIR, 'source-donut.png'));
  await locationCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await locationCard.screenshot({ path: path.join(OUT_DIR, 'location-bars.png') });
  console.log('Saved:', path.join(OUT_DIR, 'location-bars.png'));
} else {
  if (sourceVisible) {
    await page.locator('[data-testid="p4-source-card"]').first().screenshot({ path: path.join(OUT_DIR, 'source-card.png') });
    console.log('Saved (fallback):', path.join(OUT_DIR, 'source-card.png'));
  }
  if (locationVisible) {
    await page.locator('[data-testid="p4-location-card"]').first().screenshot({ path: path.join(OUT_DIR, 'location-card.png') });
    console.log('Saved (fallback):', path.join(OUT_DIR, 'location-card.png'));
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'full.png'), fullPage: true });
  console.log('Saved (debug):', path.join(OUT_DIR, 'full.png'));
  const html = await page.content();
  const lines = html.split(/\n/).slice(0, 50).join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'debug-html-snippet.txt'), lines);
  const note = `Fallback: one or both breakdown cards were not visible within timeout (${TIMEOUT_MS}ms).\n` +
    `found breakdown container? ${foundContainer ? 'yes' : 'no'}\n` +
    `p4-source-card visible? ${sourceVisible ? 'yes' : 'no'}\n` +
    `p4-location-card visible? ${locationVisible ? 'yes' : 'no'}\n` +
    `Card screenshots saved as source-card.png / location-card.png when visible. Re-run after auth-login-save-state and ensure app has breakdown data.`;
  fs.writeFileSync(path.join(OUT_DIR, 'NOTE.txt'), note);
  console.log('found breakdown container?', foundContainer ? 'yes' : 'no');
  console.log('p4-source-card visible?', sourceVisible ? 'yes' : 'no');
  console.log('p4-location-card visible?', locationVisible ? 'yes' : 'no');
}

await context.close();
await browser.close();

const created = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.png') || f.endsWith('.txt')).sort();
console.log('P4-3 screenshot done. Files under', OUT_DIR, ':', created.join(', '));
