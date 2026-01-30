/**
 * P4-2 UI — Playwright screenshot: Breakdown widgets on dashboard.
 * Saves: docs/WAR_ROOM/EVIDENCE/P4_2_UI/widgets.png
 *
 * Requires: app running (npm run start/dev), .env.local with Supabase + PROOF_*.
 * Env: SITE_ID or TEST_SITE_ID for path; PROOF_URL, PROOF_DASHBOARD_PATH override.
 * Usage: node scripts/smoke/p4-ui-screenshot.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const OUT_DIR = path.join(process.cwd(), 'docs', 'WAR_ROOM', 'EVIDENCE', 'P4_2_UI');
const BASE_URL = process.env.PROOF_URL || 'http://localhost:3000';
const SITE_ID = process.env.SITE_ID || process.env.TEST_SITE_ID || '01d24667-ca9a-44e3-ab7a-7cd171ae653f';
const DASHBOARD_PATH = process.env.PROOF_DASHBOARD_PATH || `/dashboard/site/${SITE_ID}`;
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

function getCookieDomain(url) {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' ? host : '.opsmantik.com';
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const session = await getSession();
const cookieName = 'supabase.auth.token';
const cookieValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;
const cookieDomain = getCookieDomain(BASE_URL);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 900 },
  baseURL: BASE_URL,
});
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
