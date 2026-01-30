/**
 * P4-3 Charts — Playwright screenshots: Source + Location breakdown cards.
 * Saves: source-donut.png, location-bars.png (or fallback source-card.png, location-card.png + full.png on failure).
 *
 * Robust flow: wait for p4-breakdown container → scroll into view → wait for cards → screenshot.
 * Requires: app running (npm run start/dev), .env.local with Supabase + PROOF_*.
 * Usage: node scripts/smoke/p4-3-screenshot.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const OUT_DIR = path.join(process.cwd(), 'docs', 'WAR_ROOM', 'EVIDENCE', 'P4_3_CHARTS');
const TIMEOUT_MS = 30000;
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
const url = BASE_URL + DASHBOARD_PATH;

await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });

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
  console.log('found breakdown container?', foundContainer ? 'yes' : 'no');
  console.log('p4-source-card visible?', sourceVisible ? 'yes' : 'no');
  console.log('p4-location-card visible?', locationVisible ? 'yes' : 'no');
}

await context.close();
await browser.close();

const created = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.png') || f.endsWith('.txt'));
console.log('P4-3 screenshot done. Files under', OUT_DIR, ':', created.join(', '));
