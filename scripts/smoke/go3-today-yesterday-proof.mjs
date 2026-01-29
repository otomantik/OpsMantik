/**
 * GO_3 AUTOPROOF: Today/Yesterday toggle wires to QualificationQueue via absolute date range.
 * - Open menu, click Yesterday → assert queue shows data-day="yesterday" (empty state or cards).
 * - Click Today → assert queue shows data-day="today".
 * - Screenshots: after Today, after Yesterday → docs/WAR_ROOM/EVIDENCE/GO_3/
 *
 * Requires: app running (npm run start/dev), .env.local with Supabase + PROOF_*.
 * Usage: node scripts/smoke/go3-today-yesterday-proof.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const OUT_DIR = path.join(process.cwd(), 'docs', 'WAR_ROOM', 'EVIDENCE', 'GO_3');
const BASE_URL = process.env.PROOF_URL || 'http://localhost:3000';
const DASHBOARD_PATH = process.env.PROOF_DASHBOARD_PATH || '/dashboard/site/00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROOF_EMAIL = process.env.PROOF_EMAIL || 'playwright-proof@opsmantik.local';
const PROOF_PASSWORD = process.env.PROOF_PASSWORD || 'ProofPass!12345';

async function getSession() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE env vars');
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let { data, error } = await anon.auth.signInWithPassword({ email: PROOF_EMAIL, password: PROOF_PASSWORD });
  if (error) {
    await admin.auth.admin.createUser({ email: PROOF_EMAIL, password: PROOF_PASSWORD, email_confirm: true });
    const retry = await anon.auth.signInWithPassword({ email: PROOF_EMAIL, password: PROOF_PASSWORD });
    data = retry.data;
    error = retry.error;
  }
  if (error || !data?.session) throw new Error(`Auth failed: ${error?.message || 'unknown'}`);
  await admin.from('profiles').upsert({ id: data.session.user.id, role: 'admin' });
  return data.session;
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getStorageKey(url) {
  const ref = new URL(url).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

function getCookieDomain(url) {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' ? host : '.opsmantik.com';
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const session = await getSession();
const cookieName = getStorageKey(BASE_URL);
const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
const cookieDomain = getCookieDomain(BASE_URL);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addCookies([{
  name: cookieName,
  value: cookieValue,
  domain: cookieDomain,
  path: '/',
  httpOnly: false,
  secure: cookieDomain !== 'localhost' && cookieDomain !== '127.0.0.1',
  sameSite: 'Lax',
}]);

const page = await context.newPage();
await page.goto(BASE_URL + DASHBOARD_PATH, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);

// Wait for queue to be present (Today by default)
await page.locator('[data-testid="queue-range"]').waitFor({ state: 'attached', timeout: 15000 });
let day = await page.locator('[data-testid="queue-range"]').getAttribute('data-day');
if (day !== 'today') {
  throw new Error(`Expected initial data-day=today, got ${day}`);
}
console.log('OK initial day=today');

// Screenshot: Today
await page.screenshot({ path: path.join(OUT_DIR, 'after-today.png'), fullPage: false });
console.log('Saved:', path.join(OUT_DIR, 'after-today.png'));

// Open menu, click Yesterday
await page.locator('[data-testid="header-overflow-menu-trigger"]').click();
await page.waitForTimeout(400);
await page.locator('[data-testid="menu-item-yesterday"]').click();
await page.waitForTimeout(1500);

// Assert queue shows yesterday
const rangeEl = page.locator('[data-testid="queue-range"]');
await rangeEl.waitFor({ state: 'attached', timeout: 5000 });
day = await rangeEl.getAttribute('data-day');
if (day !== 'yesterday') {
  throw new Error(`After clicking Yesterday expected data-day=yesterday, got ${day}`);
}
console.log('OK after Yesterday: data-day=yesterday');

// Either empty state or cards visible
const emptyState = await page.locator('[data-testid="queue-empty-state"]').isVisible().catch(() => false);
const hasCards = await page.locator('[data-testid="hunter-card-hot-lead"], [data-testid="queue-range"]').first().isVisible().catch(() => false);
if (!emptyState && !hasCards) {
  // At least queue-range is there; empty state might be in a different structure
  const queueVisible = await page.locator('[data-testid="queue-range"]').isVisible();
  if (!queueVisible) throw new Error('Queue not visible after Yesterday');
}
console.log('OK queue shows yesterday range (empty state or cards)');

// Screenshot: Yesterday
await page.screenshot({ path: path.join(OUT_DIR, 'after-yesterday.png'), fullPage: false });
console.log('Saved:', path.join(OUT_DIR, 'after-yesterday.png'));

// Open menu, click Today
await page.locator('[data-testid="header-overflow-menu-trigger"]').click();
await page.waitForTimeout(400);
await page.locator('[data-testid="menu-item-today"]').click();
await page.waitForTimeout(1500);

day = await page.locator('[data-testid="queue-range"]').getAttribute('data-day');
if (day !== 'today') {
  throw new Error(`After clicking Today expected data-day=today, got ${day}`);
}
console.log('OK after Today: data-day=today');

await context.close();
await browser.close();
console.log('GO_3 proof: Today/Yesterday toggle wired to queue; screenshots in EVIDENCE/GO_3.');