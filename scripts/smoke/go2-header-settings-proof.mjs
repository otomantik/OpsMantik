/**
 * GO_2 AUTOPROOF: Mobile header overflow fix + Settings via DropdownMenu.
 * - Open overflow menu, click Settings, assert dialog opens (run twice).
 * - Screenshots: mobile header + menu open → docs/_archive/2026-02-02/WAR_ROOM/EVIDENCE/GO_2/
 *
 * Requires: app running (npm run start/dev), .env.local with Supabase + PROOF_*.
 * Usage: node scripts/smoke/go2-header-settings-proof.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const OUT_DIR = path.join(process.cwd(), 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'GO_2');
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

// Mobile viewport for header + menu screenshots
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

// Screenshot 1: mobile header
await page.screenshot({ path: path.join(OUT_DIR, 'mobile-header.png'), fullPage: false });
console.log('Saved:', path.join(OUT_DIR, 'mobile-header.png'));

// Open overflow menu
const menuTrigger = page.locator('[data-testid="header-overflow-menu-trigger"]');
await menuTrigger.waitFor({ state: 'visible', timeout: 10000 });
await menuTrigger.click();
await page.waitForTimeout(500);

// Screenshot 2: menu open
await page.screenshot({ path: path.join(OUT_DIR, 'mobile-menu-open.png'), fullPage: false });
console.log('Saved:', path.join(OUT_DIR, 'mobile-menu-open.png'));

async function openMenuClickSettingsAssertDialog() {
  const trigger = page.locator('[data-testid="header-overflow-menu-trigger"]');
  await trigger.click();
  await page.waitForTimeout(300);
  const settingsItem = page.locator('[data-testid="menu-item-settings"]');
  await settingsItem.click();
  await page.waitForTimeout(500);
  const dialog = page.locator('[data-testid="settings-dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  // Close dialog for next run (click backdrop or escape)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// Run twice: open menu -> click Settings -> assert dialog opens
await openMenuClickSettingsAssertDialog();
console.log('Run 1: menu -> Settings -> dialog OK');
await openMenuClickSettingsAssertDialog();
console.log('Run 2: menu -> Settings -> dialog OK');

await context.close();
await browser.close();
console.log('GO_2 proof: mobile header + menu open screenshots + 2x Settings dialog assert done.');
